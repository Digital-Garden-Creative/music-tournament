-- Song Tournament: limits for a public site, and fewer realtime messages.
--   * room creation is rate limited, per network and overall
--   * a room holds at most 30 players (the TV seat does not count)
--   * room settings are clamped to the ranges the app offers
--   * voting writes each match row once per change instead of twice, so every phone
--     gets one realtime message per vote rather than two
--   * online status now comes from Realtime Presence in the app, so heartbeats stop
--     being sent; the heartbeat function stays only for pages loaded before this change
--
-- Apply by hand in the Supabase SQL Editor after 0007. Keep quote marks out of comments:
-- the editor splits statements on them.

-- a hash of the network a room was created from, for the rate limit (never the raw address)
alter table room_secrets add column if not exists creator text;

-- ──────────────────────────────────────────────────────────── helpers ──

-- Hash of the caller network address, from the headers PostgREST passes through. Null when
-- there are no headers (for example in the SQL Editor), which skips the per-network limit.
create or replace function _client_hash() returns text
language sql stable as $$
  select md5(ip)
  from (
    select nullif(btrim(coalesce(
      h->>'cf-connecting-ip',
      split_part(h->>'x-forwarded-for', ',', 1)
    )), '') as ip
    from (select nullif(current_setting('request.headers', true), '')::json as h) hdr
  ) x
  where ip is not null;
$$;

-- ────────────────────────────────────────────────────── rooms & players ──

create or replace function create_room(p_host_name text, p_params jsonb default null, p_live boolean default false)
returns json language plpgsql security definer set search_path = public as $$
declare r rooms; pl players; v_host uuid; v_session uuid; v_name text; v_creator text;
begin
  -- the TV seat needs no name; a phone host does
  v_name := case when p_live then 'TV' else _clean_name(p_host_name) end;
  v_creator := _client_hash();
  if v_creator is not null and (
    select count(*) from room_secrets s join rooms rm on rm.id = s.room_id
    where s.creator = v_creator and rm.created_at > now() - interval '10 minutes'
  ) >= 10 then
    raise exception 'too many rooms from this network, try again in a few minutes';
  end if;
  if (select count(*) from rooms where created_at > now() - interval '10 minutes') >= 100 then
    raise exception 'lots of rooms are being made right now, try again in a few minutes';
  end if;

  insert into rooms(code, live) values (gen_room_code(), coalesce(p_live, false)) returning * into r;
  insert into room_secrets(room_id, creator) values (r.id, v_creator) returning host_token into v_host;
  if p_params is not null then
    perform update_room_params(v_host, p_params);
    select * into r from rooms where id = r.id;
  end if;
  insert into players(room_id, display_name, is_host, is_presenter)
    values (r.id, v_name, true, r.live) returning * into pl;
  insert into player_secrets(player_id, room_id) values (pl.id, r.id)
    returning session_token into v_session;
  return json_build_object(
    'room_id', r.id, 'code', r.code, 'status', r.status, 'params', r.params, 'live', r.live,
    'host_token', v_host,
    'player_id', pl.id, 'session_token', v_session, 'is_host', true
  );
end $$;

create or replace function join_room(p_code text, p_display_name text)
returns json language plpgsql security definer set search_path = public as $$
declare r rooms; pl players; v_session uuid; v_name text;
begin
  v_name := _clean_name(p_display_name);
  select * into r from rooms where code = upper(btrim(p_code)) for update;
  if not found then raise exception 'no such room'; end if;
  if (select count(*) from players where room_id = r.id and not is_presenter) >= 30 then
    raise exception 'this room is full (30 players)';
  end if;
  insert into players(room_id, display_name) values (r.id, v_name) returning * into pl;
  insert into player_secrets(player_id, room_id) values (pl.id, r.id)
    returning session_token into v_session;
  return json_build_object(
    'room_id', r.id, 'code', r.code, 'status', r.status, 'params', r.params,
    'player_id', pl.id, 'session_token', v_session, 'is_host', false
  );
end $$;

-- Known keys only, each clamped to the range the app offers.
create or replace function update_room_params(p_host_token uuid, p_params jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare r rooms; clean jsonb := '{}'::jsonb; m matches; pending int;
begin
  r := _room_for_host(p_host_token);
  if p_params ? 'songs_per_player' then
    clean := clean || jsonb_build_object('songs_per_player',
      least(8, greatest(1, round((p_params->>'songs_per_player')::numeric)::int)));
  end if;
  if p_params ? 'vote_timer_seconds' then
    clean := clean || jsonb_build_object('vote_timer_seconds',
      least(600, greatest(10, round((p_params->>'vote_timer_seconds')::numeric)::int)));
  end if;
  if p_params ? 'theme' then
    clean := clean || jsonb_build_object('theme', left(btrim(coalesce(p_params->>'theme', '')), 120));
  end if;
  if p_params ? 'allow_self_vote' then
    clean := clean || jsonb_build_object('allow_self_vote', (p_params->>'allow_self_vote')::boolean);
  end if;
  if p_params ? 'anonymous' then
    clean := clean || jsonb_build_object('anonymous', (p_params->>'anonymous')::boolean);
  end if;
  if p_params ? 'audio_only' then
    clean := clean || jsonb_build_object('audio_only', (p_params->>'audio_only')::boolean);
  end if;
  update rooms set params = params || clean where id = r.id returning * into r;
  -- self-voting changes who an open vote waits on: recount it, and finish it if nobody
  -- it was waiting on can vote any more
  for m in select * from matches where room_id = r.id and status = 'open' for update loop
    pending := _pending_voters(m);
    update matches
      set eligible_voters = coalesce(array_length(m.voted_player_ids, 1), 0) + pending
      where id = m.id;
    if pending = 0 and coalesce(array_length(m.voted_player_ids, 1), 0) > 0 then
      perform _do_close_match(m.id);
    end if;
  end loop;
  return r.params::json;
end $$;

-- ──────────────────────────────────────────────── one write per change ──

create or replace function start_voting(p_host_token uuid, p_match_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r rooms; m matches; secs int;
begin
  r := _room_for_host(p_host_token);
  select * into m from matches where id = p_match_id and room_id = r.id for update;
  if not found then raise exception 'no such match'; end if;
  if m.status <> 'listening' then raise exception 'this match is not in its listening stage'; end if;
  secs := coalesce((r.params->>'vote_timer_seconds')::int, 60);
  m.voted_player_ids := '{}';
  update matches set status = 'open', closes_at = now() + make_interval(secs => secs),
    voted_player_ids = '{}', eligible_voters = _pending_voters(m)
    where id = m.id;
end $$;

create or replace function cast_vote(
  p_session_token uuid, p_match_id uuid, p_choice uuid
) returns void language plpgsql security definer set search_path = public as $$
declare pl players; r rooms; m matches; pending int;
begin
  pl := _player_for_session(p_session_token);
  if pl.is_presenter then raise exception 'the TV screen does not vote'; end if;
  select * into r from rooms where id = pl.room_id;
  if r.status <> 'in_progress' then raise exception 'the tournament is not live'; end if;
  select * into m from matches where id = p_match_id and room_id = r.id for update;
  if not found then raise exception 'no such match'; end if;
  if m.status <> 'open' then raise exception 'voting is not open'; end if;
  if now() > m.closes_at then raise exception 'voting has closed'; end if;
  if not (p_choice = any(_candidates(m))) then raise exception 'invalid choice'; end if;
  if not coalesce((r.params->>'allow_self_vote')::boolean, true) then
    if exists (select 1 from submissions
               where id = any(_candidates(m)) and player_id = pl.id) then
      raise exception 'cannot vote on your own pick';
    end if;
  end if;

  insert into votes(match_id, player_id, vote_round, choice)
    values (m.id, pl.id, m.vote_round, p_choice)
    on conflict (match_id, player_id, vote_round)
      do update set choice = excluded.choice, created_at = now();

  select coalesce(array_agg(distinct player_id), '{}') into m.voted_player_ids
    from votes where match_id = m.id and vote_round = m.vote_round;
  pending := _pending_voters(m);
  update matches
    set voted_player_ids = m.voted_player_ids,
        eligible_voters = coalesce(array_length(m.voted_player_ids, 1), 0) + pending
    where id = m.id;
  if pending = 0 then
    perform _do_close_match(m.id);
  end if;
end $$;

create or replace function start_revote(p_host_token uuid, p_match_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r rooms; m matches; secs int;
begin
  r := _room_for_host(p_host_token);
  select * into m from matches where id = p_match_id and room_id = r.id for update;
  if not found then raise exception 'no such match'; end if;
  if m.status <> 'discussion' then raise exception 'only a tied match can be re-voted'; end if;
  secs := coalesce((r.params->>'vote_timer_seconds')::int, 60);
  m.voted_player_ids := '{}';
  update matches set status = 'open', vote_round = m.vote_round + 1,
    voted_player_ids = '{}', votes_a = null, votes_b = null, votes_c = null,
    closes_at = now() + make_interval(secs => secs),
    eligible_voters = _pending_voters(m)
    where id = m.id;
end $$;

-- ───────────────────────────────────────────────────────────── grants ──
revoke execute on function _client_hash() from public, anon, authenticated;

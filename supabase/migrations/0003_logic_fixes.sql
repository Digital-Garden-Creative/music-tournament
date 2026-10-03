-- Song Tournament — logic fixes on top of 0001.
--
--   * Presence: a player counts as online only while their heartbeat is fresh. Any
--     heartbeat sweeps stale players in the room to disconnected, so a phone that went to
--     sleep no longer blocks the "everyone has voted" early close.
--   * Early close waits only for online players who are actually allowed to vote (with
--     self-voting off, the two submitters in a match can't), and the match row carries
--     that count so clients can show "3/5 voted".
--   * Any player can close a match once its timer has run out, so voting no longer stalls
--     when the organizer's tab is closed.
--   * Phase checks on every host action (no reopening played matches, no reseeding a live
--     bracket, no closing another room's match).
--   * Non-anonymous rooms expose who picked what from the start.
--   * Input clean-up: trimmed/limited names and titles, whitelisted room params.

-- 'seeding' was never used: seed_bracket goes straight from submitting to in_progress.
alter table rooms drop constraint if exists rooms_status_check;
alter table rooms add constraint rooms_status_check
  check (status in ('lobby','submitting','in_progress','complete'));

-- Voters the current vote round is waiting on, plus those who already voted.
alter table matches add column eligible_voters int;

-- ───────────────────────────────────────────────────────── presence ──

-- Heartbeats run every 15s; allow a few missed beats (background tabs throttle timers).
create or replace function _online_cutoff() returns timestamptz
language sql stable as $$ select now() - interval '60 seconds' $$;

create or replace function heartbeat(p_session_token uuid, p_connected boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare pl players;
begin
  pl := _player_for_session(p_session_token);
  update players set connected = p_connected, last_seen = now() where id = pl.id;
  update players set connected = false
    where room_id = pl.room_id and connected and last_seen < _online_cutoff();
end $$;

-- Online players who may vote in this match and haven't voted in its current round.
create or replace function _pending_voters(m matches) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int
  from players p join rooms r on r.id = p.room_id
  where p.room_id = m.room_id
    and p.connected and p.last_seen >= _online_cutoff()
    and not (p.id = any(m.voted_player_ids))
    and (coalesce((r.params->>'allow_self_vote')::boolean, true)
         or not exists (select 1 from submissions s
                        where s.id in (m.song_a, m.song_b) and s.player_id = p.id));
$$;

-- ──────────────────────────────────────────────── lobby / identity ──

create or replace function _clean_name(p_name text) returns text
language plpgsql immutable as $$
declare v text := left(btrim(coalesce(p_name, '')), 24);
begin
  if v = '' then raise exception 'please enter a name'; end if;
  return v;
end $$;

create or replace function create_room(p_host_name text, p_params jsonb default null)
returns json language plpgsql security definer set search_path = public as $$
declare r rooms; pl players; v_host uuid; v_session uuid; v_name text;
begin
  v_name := _clean_name(p_host_name);
  insert into rooms(code) values (gen_room_code()) returning * into r;
  insert into room_secrets(room_id) values (r.id) returning host_token into v_host;
  if p_params is not null then
    perform update_room_params(v_host, p_params);
    select * into r from rooms where id = r.id;
  end if;
  insert into players(room_id, display_name, is_host)
    values (r.id, v_name, true) returning * into pl;
  insert into player_secrets(player_id, room_id) values (pl.id, r.id)
    returning session_token into v_session;
  return json_build_object(
    'room_id', r.id, 'code', r.code, 'status', r.status, 'params', r.params,
    'host_token', v_host,
    'player_id', pl.id, 'session_token', v_session, 'is_host', true
  );
end $$;

create or replace function join_room(p_code text, p_display_name text)
returns json language plpgsql security definer set search_path = public as $$
declare r rooms; pl players; v_session uuid; v_name text;
begin
  v_name := _clean_name(p_display_name);
  select * into r from rooms where code = upper(btrim(p_code));
  if not found then raise exception 'no such room'; end if;
  insert into players(room_id, display_name) values (r.id, v_name) returning * into pl;
  insert into player_secrets(player_id, room_id) values (pl.id, r.id)
    returning session_token into v_session;
  return json_build_object(
    'room_id', r.id, 'code', r.code, 'status', r.status, 'params', r.params,
    'player_id', pl.id, 'session_token', v_session, 'is_host', false
  );
end $$;

create or replace function update_room_params(p_host_token uuid, p_params jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare r rooms; clean jsonb;
begin
  r := _room_for_host(p_host_token);
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into clean
    from jsonb_each(p_params)
    where key in ('songs_per_player','theme','vote_timer_seconds','allow_self_vote','anonymous');
  update rooms set params = params || clean where id = r.id returning * into r;
  return r.params::json;
end $$;

-- Only the lobby ⇄ submitting step is manual; seed_bracket and reveal_room own the rest.
create or replace function set_room_status(p_host_token uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare r rooms;
begin
  r := _room_for_host(p_host_token);
  if not ((r.status = 'lobby' and p_status = 'submitting')
       or (r.status = 'submitting' and p_status = 'lobby')) then
    raise exception 'cannot move the room from % to %', r.status, p_status;
  end if;
  update rooms set status = p_status where id = r.id;
end $$;

-- ──────────────────────────────────────────────────────── submissions ──

create or replace function submit_pick(
  p_session_token uuid, p_title text, p_source_url text,
  p_youtube_id text, p_media_type text
) returns json language plpgsql security definer set search_path = public as $$
declare pl players; r rooms; s submissions; cap int;
begin
  pl := _player_for_session(p_session_token);
  select * into r from rooms where id = pl.room_id;
  if r.status <> 'submitting' then raise exception 'submissions are not open'; end if;
  cap := coalesce((r.params->>'songs_per_player')::int, 2);
  if (select count(*) from submissions where player_id = pl.id) >= cap then
    raise exception 'submission limit reached';
  end if;
  insert into submissions(room_id, player_id, title, source_url, youtube_id, media_type,
                          rip_status)
    values (r.id, pl.id,
            coalesce(nullif(left(btrim(coalesce(p_title, '')), 80), ''), 'Untitled'),
            left(btrim(p_source_url), 500), p_youtube_id, p_media_type,
            case when p_media_type = 'audio' then 'pending' else 'none' end)
    returning * into s;
  if p_media_type = 'audio' and p_youtube_id is not null then
    insert into rip_jobs(submission_id, room_id, youtube_id)
      values (s.id, r.id, p_youtube_id);
  end if;
  return json_build_object('id', s.id, 'rip_status', s.rip_status);
end $$;

-- ───────────────────────────────────────────── seeding & bracket ──

create or replace function seed_bracket(p_host_token uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r rooms; ids uuid[]; n int; bsize int; nrounds int; v_round int; v_slot int;
  matches_in_round int; m matches; a uuid; b uuid; byes int; idx int;
begin
  r := _room_for_host(p_host_token);
  if r.status <> 'submitting' then raise exception 'the bracket can only be seeded once, after submissions'; end if;
  -- shuffle submissions
  select array_agg(id order by random()) into ids from submissions where room_id = r.id;
  n := coalesce(array_length(ids, 1), 0);
  if n < 2 then raise exception 'need at least 2 songs to seed'; end if;

  -- bracket size = next power of two >= n; count rounds while we go (no float rounding)
  bsize := 1; nrounds := 0;
  while bsize < n loop bsize := bsize * 2; nrounds := nrounds + 1; end loop;

  delete from matches where room_id = r.id;

  -- create every match across every round (later rounds start empty)
  matches_in_round := bsize / 2;
  for v_round in 1..nrounds loop
    for v_slot in 0..(matches_in_round - 1) loop
      insert into matches(room_id, round, slot) values (r.id, v_round, v_slot);
    end loop;
    matches_in_round := matches_in_round / 2;
  end loop;

  -- Fill round 1. The first `byes` matches each hold a single entrant (auto-advance);
  -- the rest are full pairings. Since bsize is the next power of two >= n, byes < bsize/2,
  -- so no match is ever left empty (which would stall the bracket).
  byes := bsize - n;
  idx := 1;  -- 1-based pointer into the shuffled ids
  for v_slot in 0..(bsize/2 - 1) loop
    if v_slot < byes then
      a := ids[idx]; idx := idx + 1; b := null;       -- bye
    else
      a := ids[idx]; b := ids[idx + 1]; idx := idx + 2;
    end if;
    update matches set song_a = a, song_b = b
      where matches.room_id = r.id and matches.round = 1 and matches.slot = v_slot;
  end loop;

  -- auto-resolve byes (one side null) and propagate winners forward
  for m in select * from matches where room_id = r.id and round = 1
           and song_a is not null and song_b is null order by slot loop
    update matches set winner = m.song_a, status = 'closed', votes_a = 0, votes_b = 0
      where id = m.id returning * into m;
    perform _advance_winner(m);
  end loop;

  update rooms set status = 'in_progress' where id = r.id;
end $$;

-- ─────────────────────────────────────────────────────────── voting ──

create or replace function open_match(p_host_token uuid, p_match_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r rooms; m matches; secs int;
begin
  r := _room_for_host(p_host_token);
  if r.status <> 'in_progress' then raise exception 'the tournament is not live'; end if;
  select * into m from matches where id = p_match_id and room_id = r.id for update;
  if not found then raise exception 'no such match'; end if;
  if m.status <> 'pending' then raise exception 'this match has already been played'; end if;
  if m.song_a is null or m.song_b is null then raise exception 'match not ready'; end if;
  if exists (select 1 from matches where room_id = r.id and status in ('open','discussion')) then
    raise exception 'finish the current match first';
  end if;
  secs := coalesce((r.params->>'vote_timer_seconds')::int, 60);
  update matches set status = 'open', opened_at = now(),
                     closes_at = now() + make_interval(secs => secs),
                     voted_player_ids = '{}', votes_a = null, votes_b = null
    where id = m.id returning * into m;
  update matches set eligible_voters = _pending_voters(m) where id = m.id;
end $$;

create or replace function cast_vote(
  p_session_token uuid, p_match_id uuid, p_choice uuid
) returns void language plpgsql security definer set search_path = public as $$
declare pl players; r rooms; m matches; pending int;
begin
  pl := _player_for_session(p_session_token);
  select * into r from rooms where id = pl.room_id;
  if r.status <> 'in_progress' then raise exception 'the tournament is not live'; end if;
  select * into m from matches where id = p_match_id and room_id = r.id for update;
  if not found then raise exception 'no such match'; end if;
  if m.status <> 'open' then raise exception 'voting is not open'; end if;
  if now() > m.closes_at then raise exception 'voting has closed'; end if;
  if p_choice not in (m.song_a, m.song_b) then raise exception 'invalid choice'; end if;
  if not coalesce((r.params->>'allow_self_vote')::boolean, true) then
    if exists (select 1 from submissions
               where id in (m.song_a, m.song_b) and player_id = pl.id) then
      raise exception 'cannot vote on your own pick';
    end if;
  end if;

  insert into votes(match_id, player_id, vote_round, choice)
    values (m.id, pl.id, m.vote_round, p_choice)
    on conflict (match_id, player_id, vote_round)
      do update set choice = excluded.choice, created_at = now();

  update matches set voted_player_ids =
    (select array_agg(distinct player_id) from votes
     where match_id = m.id and vote_round = m.vote_round)
    where id = m.id returning * into m;

  -- early finish: close once no online, eligible player is still to vote
  pending := _pending_voters(m);
  update matches
    set eligible_voters = coalesce(array_length(m.voted_player_ids, 1), 0) + pending
    where id = m.id;
  if pending = 0 then
    perform _do_close_match(m.id);
  end if;
end $$;

create or replace function close_match(p_host_token uuid, p_match_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r rooms;
begin
  r := _room_for_host(p_host_token);
  if not exists (select 1 from matches where id = p_match_id and room_id = r.id) then
    raise exception 'no such match';
  end if;
  perform _do_close_match(p_match_id);
end $$;

-- Any player may close a match whose timer has run out. A no-op until then (clients
-- retry), so a fast client clock can't cut voting short.
create or replace function close_expired_match(p_session_token uuid, p_match_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare pl players; m matches;
begin
  pl := _player_for_session(p_session_token);
  select * into m from matches where id = p_match_id and room_id = pl.room_id;
  if not found then raise exception 'no such match'; end if;
  if m.status = 'open' and now() >= m.closes_at then
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
  update matches set status = 'open', vote_round = m.vote_round + 1,
    voted_player_ids = '{}', votes_a = null, votes_b = null,
    opened_at = now(), closes_at = now() + make_interval(secs => secs)
    where id = m.id returning * into m;
  update matches set eligible_voters = _pending_voters(m) where id = m.id;
end $$;

create or replace function reveal_room(p_host_token uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r rooms;
begin
  r := _room_for_host(p_host_token);
  if not exists (
    select 1 from matches
    where room_id = r.id and winner is not null
      and round = (select max(round) from matches where room_id = r.id)
  ) then
    raise exception 'the final has not been decided yet';
  end if;
  update rooms set revealed = true, status = 'complete' where id = r.id;
end $$;

-- Ownership map: readable once revealed, or from the start when the room isn't anonymous.
create or replace function ownership(p_room_id uuid)
returns table(submission_id uuid, display_name text)
language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from rooms
    where id = p_room_id
      and (revealed or not coalesce((params->>'anonymous')::boolean, true))
  ) then
    raise exception 'picks are anonymous until the reveal';
  end if;
  return query
    select s.id, p.display_name
    from submissions s join players p on p.id = s.player_id
    where s.room_id = p_room_id;
end $$;

-- ───────────────────────────────────────────────────────────── grants ──
-- New helpers get Supabase's default anon/authenticated EXECUTE, so revoke it again.
revoke execute on function
  _online_cutoff(), _pending_voters(matches), _clean_name(text)
  from public, anon, authenticated;

grant execute on function close_expired_match(uuid, uuid) to anon, authenticated;

-- Song Tournament — no byes, a listening stage, live (TV) mode, and YouTube-only audio.
--
--   * No byes: a round with an odd number of songs has one three-way match (1v1v1). The
--     bracket shrinks round by round (7 → 3 → 1, 5 → 2 → 1, …) instead of padding to a
--     power of two. A three-way tie for first between two songs re-votes just those two
--     (the third is `excluded`); a full three-way tie re-votes all three.
--   * Listening: open_match starts a 'listening' stage with no voting; the host starts the
--     vote (and its timer) with start_voting.
--   * Live mode: a room created with p_live has a presenter seat (the TV) instead of a host
--     player. The presenter runs the game but never submits, votes, or counts as a voter.
--   * Audio-only picks now play through a hidden YouTube player in the browser, so nothing
--     is ripped any more: no rip jobs, and the rip worker is gone.

alter table rooms add column live boolean not null default false;
alter table players add column is_presenter boolean not null default false;

alter table matches add column size int not null default 2 check (size in (2, 3));
alter table matches add column song_c uuid references submissions(id) on delete set null;
alter table matches add column votes_c int;
-- In a three-way re-vote, the song dropped for having fewer votes than the two tied leaders.
alter table matches add column excluded uuid references submissions(id) on delete set null;

alter table matches drop constraint if exists matches_status_check;
alter table matches add constraint matches_status_check
  check (status in ('pending','listening','open','discussion','closed'));

drop table if exists rip_jobs;

-- The organizer's submission checklist leaves out the TV.
create or replace view v_submission_counts as
  select p.id as player_id, p.room_id, p.display_name, count(s.id) as submitted
  from players p
  left join submissions s on s.player_id = p.id
  where not p.is_presenter
  group by p.id, p.room_id, p.display_name;

-- ──────────────────────────────────────────────────────────── helpers ──

-- Songs still in contention in a match (two or three, minus a re-vote's excluded song).
create or replace function _candidates(m matches) returns uuid[]
language sql immutable as $$
  select coalesce(array_agg(x), '{}')
  from unnest(array[m.song_a, m.song_b, m.song_c]) as x
  where x is not null and x is distinct from m.excluded;
$$;

-- Online players who may vote in this match and haven't voted in its current round.
create or replace function _pending_voters(m matches) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int
  from players p join rooms r on r.id = p.room_id
  where p.room_id = m.room_id
    and not p.is_presenter
    and p.connected and p.last_seen >= _online_cutoff()
    and not (p.id = any(m.voted_player_ids))
    and (coalesce((r.params->>'allow_self_vote')::boolean, true)
         or not exists (select 1 from submissions s
                        where s.id = any(_candidates(m)) and s.player_id = p.id));
$$;

-- ──────────────────────────────────────────────── lobby / identity ──

drop function if exists create_room(text, jsonb);
create function create_room(p_host_name text, p_params jsonb default null, p_live boolean default false)
returns json language plpgsql security definer set search_path = public as $$
declare r rooms; pl players; v_host uuid; v_session uuid; v_name text;
begin
  -- the TV seat doesn't need a name; a phone host does
  v_name := case when p_live then 'TV' else _clean_name(p_host_name) end;
  insert into rooms(code, live) values (gen_room_code(), coalesce(p_live, false)) returning * into r;
  insert into room_secrets(room_id) values (r.id) returning host_token into v_host;
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

-- ──────────────────────────────────────────────────────── submissions ──

create or replace function submit_pick(
  p_session_token uuid, p_title text, p_source_url text,
  p_youtube_id text, p_media_type text
) returns json language plpgsql security definer set search_path = public as $$
declare pl players; r rooms; s submissions; cap int;
begin
  pl := _player_for_session(p_session_token);
  if pl.is_presenter then raise exception 'the TV screen does not submit picks'; end if;
  select * into r from rooms where id = pl.room_id;
  if r.status <> 'submitting' then raise exception 'submissions are not open'; end if;
  cap := coalesce((r.params->>'songs_per_player')::int, 2);
  if (select count(*) from submissions where player_id = pl.id) >= cap then
    raise exception 'submission limit reached';
  end if;
  insert into submissions(room_id, player_id, title, source_url, youtube_id, media_type)
    values (r.id, pl.id,
            coalesce(nullif(left(btrim(coalesce(p_title, '')), 80), ''), 'Untitled'),
            left(btrim(p_source_url), 500), p_youtube_id, p_media_type)
    returning * into s;
  return json_build_object('id', s.id);
end $$;

-- ───────────────────────────────────────────── seeding & bracket ──

-- Shuffled submission ids, laid out the way seed_bracket consumes them: consecutive pairs,
-- with the last three forming a three-way match when the count is odd. Reshuffles until no
-- round-1 match has two songs from the same player, keeping the last try when that's
-- impossible (e.g. one player submitted most of the songs).
drop function if exists _fair_shuffle(uuid, int);
create function _fair_shuffle(p_room_id uuid)
returns uuid[] language plpgsql security definer set search_path = public as $$
declare ids uuid[]; owners uuid[]; n int; attempt int; ok boolean; k int; sz int;
begin
  for attempt in 1..200 loop
    select array_agg(id order by rnd), array_agg(player_id order by rnd) into ids, owners
      from (select id, player_id, random() as rnd from submissions where room_id = p_room_id) s;
    n := coalesce(array_length(ids, 1), 0);
    ok := true;
    k := 1;
    while ok and k < n loop
      sz := case when n % 2 = 1 and k = n - 2 then 3 else 2 end;
      if (select count(distinct o) from unnest(owners[k:k + sz - 1]) o) < sz then ok := false; end if;
      k := k + sz;
    end loop;
    exit when ok;
  end loop;
  return ids;
end $$;

-- Winner of (round, slot) moves to the next round's match floor(slot/2); with an odd
-- number of matches the last one folds into the final group as its third song.
create or replace function _advance_winner(p_match matches)
returns void language plpgsql security definer set search_path = public as $$
declare k int; g int; target int; pos int;
begin
  if p_match.winner is null then return; end if;
  select count(*) into k from matches where room_id = p_match.room_id and round = p_match.round;
  if k <= 1 then return; end if;  -- this was the final
  g := k / 2;
  target := least(p_match.slot / 2, g - 1);
  pos := p_match.slot - 2 * target;
  update matches set
    song_a = case when pos = 0 then p_match.winner else song_a end,
    song_b = case when pos = 1 then p_match.winner else song_b end,
    song_c = case when pos = 2 then p_match.winner else song_c end
  where room_id = p_match.room_id and round = p_match.round + 1 and slot = target;
end $$;

create or replace function seed_bracket(p_host_token uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r rooms; ids uuid[]; n int; m int; g int; v_round int; v_slot int; idx int;
begin
  r := _room_for_host(p_host_token);
  if r.status <> 'submitting' then raise exception 'the bracket can only be seeded once, after submissions'; end if;
  n := (select count(*) from submissions where room_id = r.id);
  if n < 2 then raise exception 'need at least 2 songs to seed'; end if;
  ids := _fair_shuffle(r.id);

  delete from matches where room_id = r.id;

  -- every round halves (rounding down) until one match is left; an odd count makes the
  -- round's last match a three-way
  m := n; v_round := 0;
  while m > 1 loop
    v_round := v_round + 1;
    g := m / 2;
    for v_slot in 0..(g - 1) loop
      insert into matches(room_id, round, slot, size)
        values (r.id, v_round, v_slot, case when v_slot = g - 1 and m % 2 = 1 then 3 else 2 end);
    end loop;
    m := g;
  end loop;

  idx := 1;  -- 1-based pointer into the shuffled ids
  for v_slot in 0..(n / 2 - 1) loop
    update matches set song_a = ids[idx], song_b = ids[idx + 1],
      song_c = case when matches.size = 3 then ids[idx + 2] end
      where matches.room_id = r.id and matches.round = 1 and matches.slot = v_slot;
    idx := idx + case when v_slot = n / 2 - 1 and n % 2 = 1 then 3 else 2 end;
  end loop;

  update rooms set status = 'in_progress' where id = r.id;
end $$;

-- ─────────────────────────────────────────────────────────── voting ──

-- Opening a match starts its listening stage; nobody can vote until start_voting.
create or replace function open_match(p_host_token uuid, p_match_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r rooms; m matches;
begin
  r := _room_for_host(p_host_token);
  if r.status <> 'in_progress' then raise exception 'the tournament is not live'; end if;
  select * into m from matches where id = p_match_id and room_id = r.id for update;
  if not found then raise exception 'no such match'; end if;
  if m.status <> 'pending' then raise exception 'this match has already been played'; end if;
  if m.song_a is null or m.song_b is null or (m.size = 3 and m.song_c is null) then
    raise exception 'match not ready';
  end if;
  if exists (select 1 from matches where room_id = r.id and status in ('listening','open','discussion')) then
    raise exception 'finish the current match first';
  end if;
  update matches set status = 'listening', opened_at = now(), closes_at = null,
                     voted_player_ids = '{}', votes_a = null, votes_b = null, votes_c = null,
                     excluded = null
    where id = m.id;
end $$;

create or replace function start_voting(p_host_token uuid, p_match_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r rooms; m matches; secs int;
begin
  r := _room_for_host(p_host_token);
  select * into m from matches where id = p_match_id and room_id = r.id for update;
  if not found then raise exception 'no such match'; end if;
  if m.status <> 'listening' then raise exception 'this match is not in its listening stage'; end if;
  secs := coalesce((r.params->>'vote_timer_seconds')::int, 60);
  update matches set status = 'open', closes_at = now() + make_interval(secs => secs)
    where id = m.id returning * into m;
  update matches set eligible_voters = _pending_voters(m) where id = m.id;
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

  update matches set voted_player_ids =
    (select array_agg(distinct player_id) from votes
     where match_id = m.id and vote_round = m.vote_round)
    where id = m.id returning * into m;

  pending := _pending_voters(m);
  update matches
    set eligible_voters = coalesce(array_length(m.voted_player_ids, 1), 0) + pending
    where id = m.id;
  if pending = 0 then
    perform _do_close_match(m.id);
  end if;
end $$;

-- Tally the current vote round: a single leader wins; otherwise the match goes to
-- discussion. In a three-way, if exactly two songs share the lead, the third sits out the
-- re-vote.
create or replace function _do_close_match(p_match_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare m matches; cands uuid[]; va int; vb int; vc int; leaders uuid[];
begin
  select * into m from matches where id = p_match_id for update;
  if m.status <> 'open' then return; end if;
  cands := _candidates(m);
  select count(*) filter (where choice = m.song_a),
         count(*) filter (where choice = m.song_b),
         count(*) filter (where choice = m.song_c)
    into va, vb, vc
    from votes where match_id = m.id and vote_round = m.vote_round;
  -- every candidate tied for the most votes (a no-vote round ties them all)
  with tally as (
    select c, (select count(*) from votes v
               where v.match_id = m.id and v.vote_round = m.vote_round and v.choice = c) as cnt
    from unnest(cands) as c
  )
  select array_agg(c) into leaders from tally where cnt = (select max(cnt) from tally);
  if coalesce(array_length(leaders, 1), 0) = 1 then
    update matches set status = 'closed', votes_a = va, votes_b = vb,
      votes_c = case when m.song_c is null then null else vc end,
      winner = leaders[1]
      where id = m.id returning * into m;
    perform _advance_winner(m);
  elsif array_length(cands, 1) = 3 and array_length(leaders, 1) = 2 then
    update matches set status = 'discussion',
      excluded = (select c from unnest(cands) c where not (c = any(leaders)))
      where id = m.id;
  else
    update matches set status = 'discussion' where id = m.id;
  end if;
end $$;

-- A re-vote goes straight to voting (everyone has heard the songs), keeping any exclusion.
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
    voted_player_ids = '{}', votes_a = null, votes_b = null, votes_c = null,
    closes_at = now() + make_interval(secs => secs)
    where id = m.id returning * into m;
  update matches set eligible_voters = _pending_voters(m) where id = m.id;
end $$;

-- ───────────────────────────────────────────────────────────── grants ──
revoke execute on function _candidates(matches), _fair_shuffle(uuid)
  from public, anon, authenticated;
grant execute on function create_room(text, jsonb, boolean), start_voting(uuid, uuid)
  to anon, authenticated;

-- Song Tournament — initial schema, RLS, views, and RPCs.
--
-- Security model (friends-scale app, no full auth):
--   * Identity is a random session_token per player; the organizer also holds a host_token.
--   * All mutations go through SECURITY DEFINER RPCs that validate those tokens.
--   * Anonymity of song ownership is preserved by NOT exposing submissions.player_id to
--     the anon role — clients read songs through the v_submissions_public view.
--   * Vote choices are never exposed; clients only learn who has voted (not what) and the
--     final tallies once a match closes.

create extension if not exists pgcrypto;

-- ───────────────────────────────────────────────────────────── tables ──

create table rooms (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,
  status      text not null default 'lobby'
              check (status in ('lobby','submitting','seeding','in_progress','complete')),
  params      jsonb not null default jsonb_build_object(
                'songs_per_player', 2,
                'theme', '',
                'vote_timer_seconds', 60,
                'allow_self_vote', true,
                'anonymous', true
              ),
  revealed    boolean not null default false,  -- submitters de-anonymized at the end
  created_at  timestamptz not null default now()
);

create table players (
  id            uuid primary key default gen_random_uuid(),
  room_id       uuid not null references rooms(id) on delete cascade,
  display_name  text not null,
  is_host       boolean not null default false,
  connected     boolean not null default true,
  last_seen     timestamptz not null default now(),
  joined_at     timestamptz not null default now()
);
create index on players(room_id);

-- Secrets kept OUT of any realtime-published table so tokens never reach clients via the
-- change stream (Realtime gates rows by RLS but broadcasts all columns). Only the
-- SECURITY DEFINER RPCs below read these.
create table room_secrets (
  room_id    uuid primary key references rooms(id) on delete cascade,
  host_token uuid unique not null default gen_random_uuid()
);

create table player_secrets (
  player_id     uuid primary key references players(id) on delete cascade,
  room_id       uuid not null references rooms(id) on delete cascade,
  session_token uuid unique not null default gen_random_uuid()
);

create table submissions (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references rooms(id) on delete cascade,
  player_id   uuid not null references players(id) on delete cascade,
  title       text not null,
  source_url  text not null,
  youtube_id  text,
  media_type  text not null default 'video' check (media_type in ('video','audio')),
  rip_status  text not null default 'none'
              check (rip_status in ('none','pending','processing','ready','failed')),
  audio_url   text,
  rip_error   text,
  created_at  timestamptz not null default now()
);
create index on submissions(room_id);
create index on submissions(player_id);

create table matches (
  id               uuid primary key default gen_random_uuid(),
  room_id          uuid not null references rooms(id) on delete cascade,
  round            int not null,             -- 1 = first round
  slot             int not null,             -- 0-based position within the round
  song_a           uuid references submissions(id) on delete set null,
  song_b           uuid references submissions(id) on delete set null,
  winner           uuid references submissions(id) on delete set null,
  status           text not null default 'pending'
                   check (status in ('pending','open','discussion','closed')),
  vote_round       int not null default 1,   -- increments on a TO-triggered re-vote
  voted_player_ids uuid[] not null default '{}',
  votes_a          int,                       -- populated only when revealed/closed
  votes_b          int,
  opened_at        timestamptz,
  closes_at        timestamptz,
  unique (room_id, round, slot)
);
create index on matches(room_id);

create table votes (
  id          uuid primary key default gen_random_uuid(),
  match_id    uuid not null references matches(id) on delete cascade,
  player_id   uuid not null references players(id) on delete cascade,
  vote_round  int not null,
  choice      uuid not null references submissions(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (match_id, player_id, vote_round)
);

create table rip_jobs (
  id            uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions(id) on delete cascade,
  room_id       uuid not null references rooms(id) on delete cascade,
  youtube_id    text not null,
  status        text not null default 'pending'
                check (status in ('pending','processing','ready','failed')),
  error         text,
  claimed_at    timestamptz,
  created_at    timestamptz not null default now()
);
create index on rip_jobs(status);

-- ─────────────────────────────────────────────────────── anon views ──
-- Safe projection of submissions: everything EXCEPT player_id, so song ownership
-- stays hidden. Runs with the view owner's rights (security_invoker off) so the anon
-- role can read it even though it cannot select the base table.
create view v_submissions_public as
  select id, room_id, title, source_url, youtube_id, media_type, rip_status, audio_url
  from submissions;

-- Per-player submission progress for the organizer's checklist (count only, no titles).
create view v_submission_counts as
  select p.id as player_id, p.room_id, p.display_name, count(s.id) as submitted
  from players p
  left join submissions s on s.player_id = p.id
  group by p.id, p.room_id, p.display_name;

-- ─────────────────────────────────────────────────────────────── RLS ──
alter table rooms          enable row level security;
alter table players        enable row level security;
alter table submissions    enable row level security;
alter table matches        enable row level security;
alter table votes          enable row level security;
alter table rip_jobs       enable row level security;
alter table room_secrets   enable row level security;
alter table player_secrets enable row level security;

-- Readable (and realtime-subscribable) by anyone with the room code.
create policy read_rooms   on rooms       for select using (true);
create policy read_players on players     for select using (true);
create policy read_matches on matches     for select using (true);
-- submissions / votes / rip_jobs / *_secrets: no anon policies => no direct anon access.

grant select on v_submissions_public to anon, authenticated;
grant select on v_submission_counts to anon, authenticated;

-- ───────────────────────────────────────────────────── helper funcs ──

create or replace function gen_room_code() returns text language plpgsql as $$
declare
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';  -- no easily-confused chars
  code text;
  i int;
begin
  loop
    code := '';
    for i in 1..4 loop
      code := code || substr(alphabet, 1 + floor(random()*length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from rooms where rooms.code = code);
  end loop;
  return code;
end $$;

-- Resolve a host's room from the host_token (raises if invalid).
create or replace function _room_for_host(p_host_token uuid) returns rooms
language plpgsql security definer set search_path = public as $$
declare r rooms;
begin
  select rm.* into r from rooms rm
    join room_secrets s on s.room_id = rm.id
    where s.host_token = p_host_token;
  if not found then raise exception 'invalid host token'; end if;
  return r;
end $$;

-- Resolve a player from the session_token (raises if invalid).
create or replace function _player_for_session(p_session_token uuid) returns players
language plpgsql security definer set search_path = public as $$
declare pl players;
begin
  select p.* into pl from players p
    join player_secrets ps on ps.player_id = p.id
    where ps.session_token = p_session_token;
  if not found then raise exception 'invalid session token'; end if;
  return pl;
end $$;

-- ──────────────────────────────────────────────── lobby / identity ──

create or replace function create_room(p_host_name text, p_params jsonb default null)
returns json language plpgsql security definer set search_path = public as $$
declare r rooms; pl players; v_host uuid; v_session uuid;
begin
  insert into rooms(code) values (gen_room_code()) returning * into r;
  if p_params is not null then
    update rooms set params = params || p_params where id = r.id returning * into r;
  end if;
  insert into room_secrets(room_id) values (r.id) returning host_token into v_host;
  insert into players(room_id, display_name, is_host)
    values (r.id, p_host_name, true) returning * into pl;
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
declare r rooms; pl players; v_session uuid;
begin
  select * into r from rooms where code = upper(p_code);
  if not found then raise exception 'no such room'; end if;
  insert into players(room_id, display_name) values (r.id, p_display_name) returning * into pl;
  insert into player_secrets(player_id, room_id) values (pl.id, r.id)
    returning session_token into v_session;
  return json_build_object(
    'room_id', r.id, 'code', r.code, 'status', r.status, 'params', r.params,
    'player_id', pl.id, 'session_token', v_session, 'is_host', false
  );
end $$;

-- Re-attach after a refresh/disconnect using a stored session_token.
create or replace function resume_session(p_session_token uuid)
returns json language plpgsql security definer set search_path = public as $$
declare r rooms; pl players;
begin
  pl := _player_for_session(p_session_token);
  select * into r from rooms where id = pl.room_id;
  update players set connected = true, last_seen = now() where id = pl.id;
  return json_build_object(
    'room_id', r.id, 'code', r.code, 'status', r.status, 'params', r.params,
    'player_id', pl.id, 'is_host', pl.is_host,
    'host_token', case when pl.is_host
      then (select host_token from room_secrets where room_id = r.id) else null end
  );
end $$;

create or replace function heartbeat(p_session_token uuid, p_connected boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare pl players;
begin
  pl := _player_for_session(p_session_token);
  update players set connected = p_connected, last_seen = now() where id = pl.id;
end $$;

create or replace function update_room_params(p_host_token uuid, p_params jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare r rooms;
begin
  r := _room_for_host(p_host_token);
  update rooms set params = params || p_params where id = r.id returning * into r;
  return row_to_json(r.params);
end $$;

create or replace function set_room_status(p_host_token uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare r rooms;
begin
  r := _room_for_host(p_host_token);
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
    values (r.id, pl.id, p_title, p_source_url, p_youtube_id, p_media_type,
            case when p_media_type = 'audio' then 'pending' else 'none' end)
    returning * into s;
  if p_media_type = 'audio' and p_youtube_id is not null then
    insert into rip_jobs(submission_id, room_id, youtube_id)
      values (s.id, r.id, p_youtube_id);
  end if;
  return json_build_object('id', s.id, 'rip_status', s.rip_status);
end $$;

create or replace function delete_pick(p_session_token uuid, p_submission_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare pl players; r rooms;
begin
  pl := _player_for_session(p_session_token);
  select * into r from rooms where id = pl.room_id;
  if r.status <> 'submitting' then raise exception 'submissions are locked'; end if;
  delete from submissions where id = p_submission_id and player_id = pl.id;
end $$;

-- The submitter can list their own picks (full detail, including ids).
create or replace function my_picks(p_session_token uuid)
returns setof submissions language plpgsql security definer set search_path = public as $$
declare pl players;
begin
  pl := _player_for_session(p_session_token);
  return query select * from submissions where player_id = pl.id order by created_at;
end $$;

-- ───────────────────────────────────────────── seeding & bracket ──

-- Write a closed match's winner into its parent slot in the next round.
create or replace function _advance_winner(p_match matches)
returns void language plpgsql security definer set search_path = public as $$
declare parent_round int; parent_slot int;
begin
  if p_match.winner is null then return; end if;
  parent_round := p_match.round + 1;
  parent_slot  := p_match.slot / 2;
  if not exists (select 1 from matches
                 where room_id = p_match.room_id and round = parent_round and slot = parent_slot)
  then
    return;  -- this was the final
  end if;
  if p_match.slot % 2 = 0 then
    update matches set song_a = p_match.winner
      where room_id = p_match.room_id and round = parent_round and slot = parent_slot;
  else
    update matches set song_b = p_match.winner
      where room_id = p_match.room_id and round = parent_round and slot = parent_slot;
  end if;
end $$;

create or replace function seed_bracket(p_host_token uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r rooms; ids uuid[]; n int; bsize int; nrounds int; v_round int; v_slot int;
  matches_in_round int; m matches; a uuid; b uuid; byes int; idx int;
begin
  r := _room_for_host(p_host_token);
  -- shuffle submissions
  select array_agg(id order by random()) into ids from submissions where room_id = r.id;
  n := coalesce(array_length(ids, 1), 0);
  if n < 2 then raise exception 'need at least 2 songs to seed'; end if;

  -- bracket size = next power of two >= n; count rounds while we go (no float rounding)
  bsize := 1; nrounds := 0;
  while bsize < n loop bsize := bsize * 2; nrounds := nrounds + 1; end loop;

  delete from matches where room_id = r.id;  -- allow re-seed

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
  select * into m from matches where id = p_match_id and room_id = r.id;
  if not found then raise exception 'no such match'; end if;
  if m.song_a is null or m.song_b is null then raise exception 'match not ready'; end if;
  secs := coalesce((r.params->>'vote_timer_seconds')::int, 60);
  update matches set status = 'open', opened_at = now(),
                     closes_at = now() + make_interval(secs => secs),
                     voted_player_ids = '{}', votes_a = null, votes_b = null
    where id = m.id;
end $$;

-- Tally the current vote_round and either close with a winner or fall into discussion.
create or replace function _do_close_match(p_match_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare m matches; va int; vb int;
begin
  select * into m from matches where id = p_match_id for update;
  if m.status <> 'open' then return; end if;
  select count(*) filter (where choice = m.song_a),
         count(*) filter (where choice = m.song_b)
    into va, vb
    from votes where match_id = m.id and vote_round = m.vote_round;
  if va = vb then
    -- tie → discussion; results stay hidden, TO will trigger a re-vote
    update matches set status = 'discussion' where id = m.id;
  else
    update matches set status = 'closed', votes_a = va, votes_b = vb,
      winner = case when va > vb then m.song_a else m.song_b end
      where id = m.id returning * into m;
    perform _advance_winner(m);
  end if;
end $$;

create or replace function cast_vote(
  p_session_token uuid, p_match_id uuid, p_choice uuid
) returns void language plpgsql security definer set search_path = public as $$
declare pl players; r rooms; m matches; eligible int; voted int;
begin
  pl := _player_for_session(p_session_token);
  select * into r from rooms where id = pl.room_id;
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

  -- early finish: close as soon as all connected players have voted
  select count(*) into eligible from players where room_id = r.id and connected;
  voted := coalesce(array_length(m.voted_player_ids, 1), 0);
  if voted >= eligible then
    perform _do_close_match(m.id);
  end if;
end $$;

-- Manual close (timer expiry or TO button).
create or replace function close_match(p_host_token uuid, p_match_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r rooms;
begin
  r := _room_for_host(p_host_token);
  perform _do_close_match(p_match_id);
end $$;

-- After a tie + discussion, the TO reopens voting; prior votes are superseded by bumping
-- vote_round so the new round starts clean.
create or replace function start_revote(p_host_token uuid, p_match_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r rooms; m matches; secs int;
begin
  r := _room_for_host(p_host_token);
  select * into m from matches where id = p_match_id and room_id = r.id;
  if not found then raise exception 'no such match'; end if;
  secs := coalesce((r.params->>'vote_timer_seconds')::int, 60);
  update matches set status = 'open', vote_round = m.vote_round + 1,
    voted_player_ids = '{}', votes_a = null, votes_b = null,
    opened_at = now(), closes_at = now() + make_interval(secs => secs)
    where id = m.id;
end $$;

-- De-anonymize at the end: returns submission_id → display_name for the room.
create or replace function reveal_room(p_host_token uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r rooms;
begin
  r := _room_for_host(p_host_token);
  update rooms set revealed = true, status = 'complete' where id = r.id;
end $$;

-- Ownership map, only readable once the room is revealed.
create or replace function ownership(p_room_id uuid)
returns table(submission_id uuid, display_name text)
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from rooms where id = p_room_id and revealed) then
    raise exception 'room not revealed';
  end if;
  return query
    select s.id, p.display_name
    from submissions s join players p on p.id = s.player_id
    where s.room_id = p_room_id;
end $$;

-- Allow anon to call the RPCs.
grant execute on all functions in schema public to anon, authenticated;

-- Realtime: broadcast row changes for room state and matches.
alter publication supabase_realtime add table rooms;
alter publication supabase_realtime add table players;
alter publication supabase_realtime add table matches;

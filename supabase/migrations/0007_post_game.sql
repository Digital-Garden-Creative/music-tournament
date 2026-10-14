-- Song Tournament — changes after the first real game:
--   * every player counts toward "everyone has voted", online or not (a locked phone used to
--     drop out and let a match close early on too few votes)
--   * an `audio_only` room setting
--   * the host can reshuffle or hand-place the round-1 draw until the first match opens
--   * the host can change a decided match's winner; later matches it fed are reset
--   * settings changed mid-vote are applied to the open match straight away
--
-- Apply by hand in the Supabase SQL Editor after 0006.

alter table rooms alter column params set default jsonb_build_object(
  'songs_per_player', 2,
  'theme', '',
  'vote_timer_seconds', 60,
  'allow_self_vote', true,
  'anonymous', true,
  'audio_only', false
);

-- set when the host picked this match's winner instead of the vote
alter table matches add column if not exists overridden boolean not null default false;

-- ──────────────────────────────────────────────────────────── voting ──

-- Players who may vote in this match and haven't voted in its current round. Being offline
-- no longer excuses anyone: the timer is what closes a vote someone sleeps through.
create or replace function _pending_voters(m matches) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int
  from players p join rooms r on r.id = p.room_id
  where p.room_id = m.room_id
    and not p.is_presenter
    and not (p.id = any(m.voted_player_ids))
    and (coalesce((r.params->>'allow_self_vote')::boolean, true)
         or not exists (select 1 from submissions s
                        where s.id = any(_candidates(m)) and s.player_id = p.id));
$$;

-- Settings can change mid-game. Turning self-voting on or off changes who an open vote is
-- waiting on, so recount it, and finish it if the last voter it was waiting on is now out.
create or replace function update_room_params(p_host_token uuid, p_params jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare r rooms; clean jsonb; m matches; pending int;
begin
  r := _room_for_host(p_host_token);
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into clean
    from jsonb_each(p_params)
    where key in ('songs_per_player','theme','vote_timer_seconds','allow_self_vote',
                  'anonymous','audio_only');
  update rooms set params = params || clean where id = r.id returning * into r;
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

-- ─────────────────────────────────────────────────────────── seeding ──

-- The draw can be redone until the first match opens.
create or replace function _bracket_untouched(p_room_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from matches
    where room_id = p_room_id and (status <> 'pending' or opened_at is not null)
  );
$$;

-- Lay `ids` into round 1 in order: consecutive pairs, the last three forming the three-way
-- when the count is odd. Later rounds start empty.
create or replace function _fill_round_one(p_room_id uuid, ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare n int; v_slot int; idx int;
begin
  n := coalesce(array_length(ids, 1), 0);
  update matches set song_a = null, song_b = null, song_c = null, winner = null
    where room_id = p_room_id and round > 1;
  idx := 1;
  for v_slot in 0..(n / 2 - 1) loop
    update matches set song_a = ids[idx], song_b = ids[idx + 1],
      song_c = case when matches.size = 3 then ids[idx + 2] end
      where matches.room_id = p_room_id and matches.round = 1 and matches.slot = v_slot;
    idx := idx + case when v_slot = n / 2 - 1 and n % 2 = 1 then 3 else 2 end;
  end loop;
end $$;

create or replace function seed_bracket(p_host_token uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r rooms; n int; m int; g int; v_round int; v_slot int;
begin
  r := _room_for_host(p_host_token);
  if r.status <> 'submitting' then raise exception 'the bracket can only be seeded once, after submissions'; end if;
  n := (select count(*) from submissions where room_id = r.id);
  if n < 2 then raise exception 'need at least 2 songs to seed'; end if;

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

  perform _fill_round_one(r.id, _fair_shuffle(r.id));
  update rooms set status = 'in_progress' where id = r.id;
end $$;

-- A fresh fair draw (no round-1 match pits a player against themselves where avoidable).
create or replace function reseed_bracket(p_host_token uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r rooms;
begin
  r := _room_for_host(p_host_token);
  if r.status <> 'in_progress' then raise exception 'the tournament is not live'; end if;
  if not _bracket_untouched(r.id) then raise exception 'the draw is locked once a match has started'; end if;
  perform _fill_round_one(r.id, _fair_shuffle(r.id));
end $$;

-- The host's own draw: every song in the room, each once, in round-1 order.
create or replace function set_seed_order(p_host_token uuid, p_order uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare r rooms; n int;
begin
  r := _room_for_host(p_host_token);
  if r.status <> 'in_progress' then raise exception 'the tournament is not live'; end if;
  if not _bracket_untouched(r.id) then raise exception 'the draw is locked once a match has started'; end if;
  n := (select count(*) from submissions where room_id = r.id);
  if coalesce(array_length(p_order, 1), 0) <> n
     or (select count(distinct x) from unnest(p_order) x) <> n
     or exists (select 1 from unnest(p_order) x
                where x is null or not exists (select 1 from submissions s
                                               where s.id = x and s.room_id = r.id)) then
    raise exception 'the order must list every song exactly once';
  end if;
  perform _fill_round_one(r.id, p_order);
end $$;

-- ────────────────────────────────────────────────────────── overrides ──

-- Take p_match's winner back out of the next round. If that next match had already started,
-- its result is void too: reset it and undo whatever it sent onward, all the way up.
create or replace function _unadvance(p_match matches)
returns void language plpgsql security definer set search_path = public as $$
declare k int; g int; target int; pos int; nx matches;
begin
  if p_match.winner is null then return; end if;
  select count(*) into k from matches where room_id = p_match.room_id and round = p_match.round;
  if k <= 1 then return; end if;  -- the final feeds nothing
  g := k / 2;
  target := least(p_match.slot / 2, g - 1);
  pos := p_match.slot - 2 * target;
  select * into nx from matches
    where room_id = p_match.room_id and round = p_match.round + 1 and slot = target for update;
  update matches set
    song_a = case when pos = 0 then null else song_a end,
    song_b = case when pos = 1 then null else song_b end,
    song_c = case when pos = 2 then null else song_c end
    where id = nx.id;
  if nx.status <> 'pending' or nx.opened_at is not null then
    perform _unadvance(nx);
    delete from votes where match_id = nx.id;
    update matches set status = 'pending', winner = null, overridden = false,
      votes_a = null, votes_b = null, votes_c = null, vote_round = 1, voted_player_ids = '{}',
      eligible_voters = null, excluded = null, opened_at = null, closes_at = null
      where id = nx.id;
  end if;
end $$;

-- The host changes a decided match's winner. Later matches the old winner reached are reset
-- (to be played again with the new winner), and the new winner moves on in its place.
create or replace function override_winner(p_host_token uuid, p_match_id uuid, p_winner uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r rooms; m matches;
begin
  r := _room_for_host(p_host_token);
  if r.status <> 'in_progress' then raise exception 'the tournament is not live'; end if;
  select * into m from matches where id = p_match_id and room_id = r.id for update;
  if not found then raise exception 'no such match'; end if;
  if m.status <> 'closed' or m.winner is null then raise exception 'only a decided match can be changed'; end if;
  -- (not "= any(...)": an empty slot C makes that null rather than false)
  if p_winner is null or not exists (
    select 1 from unnest(array[m.song_a, m.song_b, m.song_c]) x where x = p_winner
  ) then
    raise exception 'that song is not in this match';
  end if;
  if p_winner = m.winner then return; end if;
  perform _unadvance(m);
  update matches set winner = p_winner, overridden = true where id = m.id returning * into m;
  perform _advance_winner(m);
end $$;

-- ───────────────────────────────────────────────────────────── grants ──
revoke execute on function
  _bracket_untouched(uuid), _fill_round_one(uuid, uuid[]), _unadvance(matches)
  from public, anon, authenticated;
grant execute on function
  reseed_bracket(uuid), set_seed_order(uuid, uuid[]), override_winner(uuid, uuid, uuid)
  to anon, authenticated;

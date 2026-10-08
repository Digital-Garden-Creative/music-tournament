-- Song Tournament — fairer seeding.
--
-- seed_bracket used a plain shuffle, so with several songs per player it could pair a
-- player's own songs against each other in round 1, or hand one player every bye (whose
-- songs then met in round 2). Now it reshuffles until round 1 has no same-owner pairs
-- and the byes are spread over as many players as possible, falling back to the last
-- shuffle when that's impossible (e.g. one player submitted most of the songs).

-- Shuffled submission ids for the room, laid out the way seed_bracket consumes them: the
-- first `byes` entries get a bye, the rest pair off in order.
create or replace function _fair_shuffle(p_room_id uuid, p_byes int)
returns uuid[] language plpgsql security definer set search_path = public as $$
declare ids uuid[]; owners uuid[]; n int; attempt int; ok boolean; k int; spread int;
begin
  -- byes can only go to distinct players while there are enough players
  spread := least(p_byes, (select count(distinct player_id) from submissions where room_id = p_room_id));
  for attempt in 1..200 loop
    select array_agg(id order by r), array_agg(player_id order by r) into ids, owners
      from (select id, player_id, random() as r from submissions where room_id = p_room_id) s;
    n := coalesce(array_length(ids, 1), 0);
    ok := true;
    if p_byes > 1 and (select count(distinct o) from unnest(owners[1:p_byes]) o) < spread then
      ok := false;
    end if;
    -- round-1 pairs have different owners
    k := p_byes + 1;
    while ok and k < n loop
      if owners[k] = owners[k + 1] then ok := false; end if;
      k := k + 2;
    end loop;
    exit when ok;
  end loop;
  return ids;
end $$;

create or replace function seed_bracket(p_host_token uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r rooms; ids uuid[]; n int; bsize int; nrounds int; v_round int; v_slot int;
  matches_in_round int; m matches; a uuid; b uuid; byes int; idx int;
begin
  r := _room_for_host(p_host_token);
  if r.status <> 'submitting' then raise exception 'the bracket can only be seeded once, after submissions'; end if;
  n := (select count(*) from submissions where room_id = r.id);
  if n < 2 then raise exception 'need at least 2 songs to seed'; end if;

  -- bracket size = next power of two >= n; count rounds while we go (no float rounding)
  bsize := 1; nrounds := 0;
  while bsize < n loop bsize := bsize * 2; nrounds := nrounds + 1; end loop;
  byes := bsize - n;
  ids := _fair_shuffle(r.id, byes);

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

-- New helper gets Supabase's default anon EXECUTE, so revoke it.
revoke execute on function _fair_shuffle(uuid, int) from public, anon, authenticated;

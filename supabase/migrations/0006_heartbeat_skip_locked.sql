-- Song Tournament — heartbeats no longer block each other.
--
-- Each heartbeat refreshes the caller's row and then marks stale players in the room as
-- disconnected. When two stale players checked in at the same moment, each held its own
-- row while waiting to sweep the other's, so they blocked each other until the statement
-- timed out. The sweep now leaves out the caller and skips rows another heartbeat is busy
-- with (that player is back online anyway).

create or replace function heartbeat(p_session_token uuid, p_connected boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare pl players;
begin
  pl := _player_for_session(p_session_token);
  update players set connected = p_connected, last_seen = now() where id = pl.id;
  update players set connected = false
    where id in (
      select id from players
      where room_id = pl.room_id and id <> pl.id
        and connected and last_seen < _online_cutoff()
      for update skip locked
    );
end $$;

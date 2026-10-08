import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import {
  getMatches, getPlayers, getRoom, getSubmissions, heartbeat, joinRoom, myPicks, ownership,
  resumeSession,
} from './api';
import { clearSession, loadSession, saveSession } from './session';
import type { Match, Player, PublicSubmission, Room, Session } from './types';

export interface RoomState {
  session: Session | null;
  room: Room | null;
  players: Player[];
  submissions: PublicSubmission[];
  matches: Match[];
  /** submission id → submitter name; filled once the room is revealed, or always when not anonymous. */
  owners: Record<string, string>;
  /** Ids of this player's own picks (known to them even in anonymous rooms). */
  myPickIds: string[];
  refresh: () => Promise<void>;
}

/** What the phase components receive: the room is loaded and we hold a seat in it. */
export interface ReadyRoomState extends RoomState {
  session: Session;
  room: Room;
}

export type RoomPhase = 'loading' | 'join' | 'ready' | 'error';

export function useRoom(code: string) {
  const [phase, setPhase] = useState<RoomPhase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [submissions, setSubmissions] = useState<PublicSubmission[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [owners, setOwners] = useState<Record<string, string>>({});
  const [myPickIds, setMyPickIds] = useState<string[]>([]);
  const roomIdRef = useRef<string | null>(null);

  const reloadRoom = useCallback(async (roomId: string) => {
    const [r, p, s, m] = await Promise.all([
      getRoom(roomId), getPlayers(roomId), getSubmissions(roomId), getMatches(roomId),
    ]);
    setRoom(r); setPlayers(p as Player[]); setSubmissions(s); setMatches(m);
  }, []);

  const refresh = useCallback(async () => {
    if (roomIdRef.current) await reloadRoom(roomIdRef.current);
  }, [reloadRoom]);

  const enter = useCallback(async (s: Session) => {
    saveSession(s);
    setSession(s);
    roomIdRef.current = s.roomId;
    await reloadRoom(s.roomId);
    setPhase('ready');
  }, [reloadRoom]);

  // Resume the seat stored for this room code, or ask for a name to join with.
  useEffect(() => {
    (async () => {
      const stored = loadSession(code);
      if (!stored) { setPhase('join'); return; }
      try {
        const fresh = await resumeSession(stored.sessionToken);
        await enter({ ...stored, ...fresh, sessionToken: stored.sessionToken });
      } catch (err) {
        const message = (err as Error).message;
        if (/invalid session token/.test(message)) {
          clearSession(code);
          setPhase('join');
        } else {
          setError(message); setPhase('error');
        }
      }
    })();
  }, [code, enter]);

  /** Take a new seat in this room. Throws (e.g. "no such room") for the form to show. */
  const join = useCallback(async (name: string) => {
    await enter(await joinRoom(code, name));
  }, [code, enter]);

  // Realtime: any change to room/players/matches → refetch that slice.
  useEffect(() => {
    if (!session) return;
    const roomId = session.roomId;
    const channel = supabase
      .channel(`room:${roomId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
        async () => setRoom(await getRoom(roomId)))
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'players', filter: `room_id=eq.${roomId}` },
        async () => setPlayers((await getPlayers(roomId)) as Player[]))
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'matches', filter: `room_id=eq.${roomId}` },
        async () => setMatches(await getMatches(roomId)))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session]);

  // Submissions aren't on the realtime feed (the table is private), so poll: while picks
  // are coming in, and while any audio rip is still running (it can finish mid-bracket).
  const ripsRunning = submissions.some(
    (s) => s.media_type === 'audio' && (s.rip_status === 'pending' || s.rip_status === 'processing'),
  );
  useEffect(() => {
    if (!session || !room) return;
    const roomId = session.roomId;
    getSubmissions(roomId).then(setSubmissions).catch(() => {});
    if (room.status === 'lobby' || room.status === 'submitting' || ripsRunning) {
      const id = setInterval(() => getSubmissions(roomId).then(setSubmissions).catch(() => {}), 4000);
      return () => clearInterval(id);
    }
  }, [session, room?.status, ripsRunning]);

  // Who picked what, once the room allows it.
  const ownersVisible = !!room && (room.revealed || !room.params.anonymous);
  const submissionIds = submissions.map((s) => s.id).join(',');
  useEffect(() => {
    if (!room || !ownersVisible) { setOwners({}); return; }
    ownership(room.id)
      .then((rows) => {
        const map: Record<string, string> = {};
        rows.forEach((r) => { map[r.submission_id] = r.display_name; });
        setOwners(map);
      })
      .catch(() => {});
  }, [room?.id, ownersVisible, submissionIds]);

  // Our own picks, so a match can tell us when we're sitting it out (self-voting off).
  useEffect(() => {
    if (!session || room?.status !== 'in_progress') return;
    myPicks(session.sessionToken).then((ps) => setMyPickIds(ps.map((p) => p.id))).catch(() => {});
  }, [session, room?.status]);

  // Heartbeat keeps us counted as online for the early-finish vote check. When a phone
  // wakes up, beat immediately and refetch anything realtime missed while asleep.
  useEffect(() => {
    if (!session) return;
    const token = session.sessionToken;
    const beat = (connected: boolean) => { heartbeat(token, connected).catch(() => {}); };
    beat(true);
    const id = setInterval(() => beat(true), 15000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') { beat(true); refresh().catch(() => {}); }
    };
    const bye = () => beat(false);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pagehide', bye);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pagehide', bye);
      bye();
    };
  }, [session, refresh]);

  const state: RoomState = { session, room, players, submissions, matches, owners, myPickIds, refresh };
  return { phase, error, join, state };
}

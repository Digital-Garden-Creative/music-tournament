import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import {
  getMatches, getPlayers, getRoom, getSubmissions, heartbeat, resumeSession,
} from './api';
import { loadSession, saveSession } from './session';
import type { Match, Player, PublicSubmission, Room, Session } from './types';

export interface RoomState {
  session: Session | null;
  room: Room | null;
  players: Player[];
  submissions: PublicSubmission[];
  matches: Match[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useRoom(): RoomState {
  const [session, setSession] = useState<Session | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [submissions, setSubmissions] = useState<PublicSubmission[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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

  // Resume identity from localStorage and do the first load.
  useEffect(() => {
    (async () => {
      const stored = loadSession();
      if (!stored) { setError('No active session. Return home to join a room.'); setLoading(false); return; }
      try {
        const fresh = await resumeSession(stored.sessionToken);
        // keep host_token from resume (only present for the host)
        const merged: Session = { ...stored, ...fresh, sessionToken: stored.sessionToken };
        saveSession(merged);
        setSession(merged);
        roomIdRef.current = merged.roomId;
        await reloadRoom(merged.roomId);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [reloadRoom]);

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

  // Refetch submissions when the room enters the submitting phase (rip status updates, etc.)
  useEffect(() => {
    if (!session || !room) return;
    if (room.status === 'submitting' || room.status === 'lobby') {
      const id = setInterval(() => getSubmissions(session.roomId).then(setSubmissions), 4000);
      return () => clearInterval(id);
    }
  }, [session, room?.status]);

  // Heartbeat so the "everyone has voted" early-finish knows who's connected.
  useEffect(() => {
    if (!session) return;
    const token = session.sessionToken;
    heartbeat(token, true).catch(() => {});
    const id = setInterval(() => heartbeat(token, true).catch(() => {}), 15000);
    const bye = () => { heartbeat(token, false).catch(() => {}); };
    window.addEventListener('beforeunload', bye);
    return () => { clearInterval(id); window.removeEventListener('beforeunload', bye); bye(); };
  }, [session]);

  return { session, room, players, submissions, matches, loading, error, refresh };
}

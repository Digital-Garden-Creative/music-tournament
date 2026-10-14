import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabase';
import {
  getMatches, getPlayers, getRoom, getSubmissions, joinRoom, myPicks, ownership,
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
  /** This seat is the TV in a live room: it runs the game but doesn't submit or vote. */
  isPresenter: boolean;
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
  // Player ids with a device in the room right now, from Realtime Presence.
  const [online, setOnline] = useState<ReadonlySet<string>>(new Set());
  const roomIdRef = useRef<string | null>(null);

  const reloadRoom = useCallback(async (roomId: string) => {
    const [r, p, s, m] = await Promise.all([
      getRoom(roomId), getPlayers(roomId), getSubmissions(roomId), getMatches(roomId),
    ]);
    setRoom(r); setPlayers(withoutTv(p as Player[])); setSubmissions(s); setMatches(m);
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

  // Realtime: any change to room/players/matches → refetch that slice. The same channel
  // carries Presence: each device announces its player id, and the server drops it when the
  // connection closes (tab closed, phone locked, signal lost). That drives the online dots
  // without writing to the database.
  useEffect(() => {
    if (!session) return;
    const roomId = session.roomId;
    const reloadRoom = coalesced(() => getRoom(roomId), setRoom);
    const reloadPlayers = coalesced(() => getPlayers(roomId), (p) => setPlayers(withoutTv(p as Player[])));
    const reloadMatches = coalesced(() => getMatches(roomId), setMatches);
    const channel = supabase.channel(`room:${roomId}`, {
      config: { presence: { key: session.playerId } },
    });
    channel
      .on('presence', { event: 'sync' }, () => setOnline(new Set(Object.keys(channel.presenceState()))))
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, reloadRoom)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'players', filter: `room_id=eq.${roomId}` }, reloadPlayers)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'matches', filter: `room_id=eq.${roomId}` }, reloadMatches)
      .subscribe((status) => {
        // (re)joined, including after a dropped connection comes back
        if (status === 'SUBSCRIBED') channel.track({ at: Date.now() }).catch(() => {});
      });
    return () => {
      reloadRoom.cancel(); reloadPlayers.cancel(); reloadMatches.cancel();
      supabase.removeChannel(channel);
    };
  }, [session]);

  // Submissions aren't on the realtime feed (the table is private), so poll while picks
  // are coming in.
  useEffect(() => {
    if (!session || !room) return;
    const roomId = session.roomId;
    getSubmissions(roomId).then(setSubmissions).catch(() => {});
    if (room.status === 'lobby' || room.status === 'submitting') {
      const id = setInterval(() => getSubmissions(roomId).then(setSubmissions).catch(() => {}), 4000);
      return () => clearInterval(id);
    }
  }, [session, room?.status]);

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

  // When a phone wakes up, refetch anything realtime missed while it was asleep.
  useEffect(() => {
    if (!session) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh().catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [session, refresh]);

  const playersOnline = useMemo(
    () => players.map((p) => ({ ...p, connected: online.has(p.id) })),
    [players, online],
  );
  const isPresenter = !!room?.live && !!session?.isHost;
  const state: RoomState = {
    session, room, players: playersOnline, submissions, matches, owners, myPickIds, isPresenter, refresh,
  };
  return { phase, error, join, state };
}

// The TV seat isn't a player, so it stays out of player lists and online counts.
function withoutTv(players: Player[]): Player[] {
  return players.filter((p) => !p.is_presenter);
}

// Refetches one slice after realtime changes. Changes landing within `ms` of the first (a
// burst of votes) share one fetch, and a slow earlier response never overwrites a newer one.
function coalesced<T>(load: () => Promise<T>, apply: (value: T) => void, ms = 250) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let latest = 0;
  const run = () => {
    if (timer) return;
    timer = setTimeout(async () => {
      timer = null;
      const mine = ++latest;
      try {
        const value = await load();
        if (mine === latest) apply(value);
      } catch { /* the next change, or the wake-up refresh, catches up */ }
    }, ms);
  };
  run.cancel = () => { if (timer) clearTimeout(timer); timer = null; latest++; };
  return run;
}

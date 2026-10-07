import { useState } from 'react';
import { useRoom } from '../lib/useRoom';
import type { ReadyRoomState } from '../lib/useRoom';
import Lobby from './room/Lobby';
import Submit from './room/Submit';
import Bracket from './room/Bracket';
import Complete from './room/Complete';
import RoomHeader from './room/RoomHeader';

export default function Room() {
  const code = (new URLSearchParams(window.location.search).get('code') ?? '').trim().toUpperCase();
  if (!code) {
    return <ErrorScreen message="That link is missing a room code." />;
  }
  return <RoomForCode code={code} />;
}

function RoomForCode({ code }: { code: string }) {
  const { phase, error, join, state } = useRoom(code);

  if (phase === 'loading') {
    return <Centered><p className="text-zinc-400">Loading room…</p></Centered>;
  }
  if (phase === 'join') return <JoinForm code={code} onJoin={join} />;
  if (phase === 'error' || !state.session || !state.room) {
    return <ErrorScreen message={error ?? 'Something went wrong.'} />;
  }

  const ready = state as ReadyRoomState;
  const { room } = ready;
  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <RoomHeader room={room} session={ready.session} players={ready.players} />
      {room.status === 'lobby' && <Lobby {...ready} />}
      {room.status === 'submitting' && <Submit {...ready} />}
      {room.status === 'in_progress' && <Bracket {...ready} />}
      {room.status === 'complete' && <Complete {...ready} />}
    </div>
  );
}

function JoinForm({ code, onJoin }: { code: string; onJoin: (name: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await onJoin(name.trim()); }
    catch (err) { setError((err as Error).message); setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-md px-6 pt-20 pb-16">
      <form onSubmit={submit}
        className="flex flex-col gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 shadow-xl shadow-black/40">
        <div className="text-center">
          <div className="text-xs uppercase tracking-wider text-zinc-500">Joining room</div>
          <div className="font-mono text-3xl font-bold tracking-[0.3em] text-fuchsia-400">{code}</div>
        </div>
        <label className="text-sm font-medium text-zinc-300">
          Your name
          <input
            autoFocus value={name} onChange={(e) => setName(e.target.value)}
            maxLength={24} required placeholder="Player 1"
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 outline-none focus:border-fuchsia-500"
          />
        </label>
        <button type="submit" disabled={busy}
          className="rounded-xl bg-fuchsia-600 px-4 py-2.5 font-semibold text-white transition hover:bg-fuchsia-500 disabled:opacity-50">
          {busy ? '…' : 'Join room'}
        </button>
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <a href="/" className="text-center text-sm text-zinc-500 hover:text-zinc-300">← Back home</a>
      </form>
    </div>
  );
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <Centered>
      <p className="mb-4 text-rose-400">{message}</p>
      <a href="/" className="rounded-lg bg-fuchsia-600 px-4 py-2 font-semibold text-white hover:bg-fuchsia-500">
        Back home
      </a>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      {children}
    </div>
  );
}

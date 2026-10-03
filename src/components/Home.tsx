import { useState } from 'react';
import { createRoom, joinRoom } from '../lib/api';
import { saveSession } from '../lib/session';

type Mode = 'menu' | 'create' | 'join';

export default function Home() {
  const [mode, setMode] = useState<Mode>('menu');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const session = await createRoom(name.trim());
      saveSession(session);
      window.location.href = `/room?code=${session.code}`;
    } catch (err) {
      setError((err as Error).message); setBusy(false);
    }
  }

  async function handleJoin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const session = await joinRoom(code.trim(), name.trim());
      saveSession(session);
      window.location.href = `/room?code=${session.code}`;
    } catch (err) {
      setError((err as Error).message); setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-6 pt-20 pb-16 sm:pt-28">
      <div className="mb-2 flex items-center gap-2 text-fuchsia-400">
        <span className="text-3xl">🎵</span>
      </div>
      <h1 className="bg-gradient-to-r from-fuchsia-400 via-violet-400 to-sky-400 bg-clip-text text-center text-5xl font-black tracking-tight text-transparent">
        Song Tournament
      </h1>
      <p className="mt-3 text-center text-zinc-400">
        Pick your songs. Seed the bracket. Crown a champion.
      </p>

      <div className="mt-10 w-full rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 shadow-xl shadow-black/40">
        {mode === 'menu' && (
          <div className="flex flex-col gap-3">
            <button
              onClick={() => { setMode('create'); setError(null); }}
              className="rounded-xl bg-fuchsia-600 px-4 py-3 font-semibold text-white transition hover:bg-fuchsia-500"
            >
              Host a tournament
            </button>
            <button
              onClick={() => { setMode('join'); setError(null); }}
              className="rounded-xl border border-zinc-700 bg-zinc-800/60 px-4 py-3 font-semibold text-zinc-100 transition hover:border-zinc-600 hover:bg-zinc-800"
            >
              Join with a code
            </button>
          </div>
        )}

        {mode === 'create' && (
          <form onSubmit={handleCreate} className="flex flex-col gap-4">
            <label className="text-sm font-medium text-zinc-300">
              Your name
              <input
                autoFocus value={name} onChange={(e) => setName(e.target.value)}
                maxLength={24} required placeholder="DJ Organizer"
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 outline-none focus:border-fuchsia-500"
              />
            </label>
            <Actions busy={busy} onBack={() => setMode('menu')} label="Create room" />
          </form>
        )}

        {mode === 'join' && (
          <form onSubmit={handleJoin} className="flex flex-col gap-4">
            <label className="text-sm font-medium text-zinc-300">
              Room code
              <input
                autoFocus value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                maxLength={4} required placeholder="ABCD"
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-center text-2xl font-bold tracking-[0.4em] text-zinc-100 uppercase outline-none focus:border-fuchsia-500"
              />
            </label>
            <label className="text-sm font-medium text-zinc-300">
              Your name
              <input
                value={name} onChange={(e) => setName(e.target.value)}
                maxLength={24} required placeholder="Player 1"
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 outline-none focus:border-fuchsia-500"
              />
            </label>
            <Actions busy={busy} onBack={() => setMode('menu')} label="Join room" />
          </form>
        )}

        {error && <p className="mt-4 text-sm text-rose-400">{error}</p>}
      </div>
    </div>
  );
}

function Actions({ busy, onBack, label }: { busy: boolean; onBack: () => void; label: string }) {
  return (
    <div className="flex gap-3">
      <button
        type="button" onClick={onBack}
        className="rounded-xl border border-zinc-700 px-4 py-2.5 text-sm text-zinc-300 transition hover:bg-zinc-800"
      >
        Back
      </button>
      <button
        type="submit" disabled={busy}
        className="flex-1 rounded-xl bg-fuchsia-600 px-4 py-2.5 font-semibold text-white transition hover:bg-fuchsia-500 disabled:opacity-50"
      >
        {busy ? '…' : label}
      </button>
    </div>
  );
}

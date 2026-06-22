import { useState } from 'react';
import { setStatus, updateParams } from '../../lib/api';
import type { RoomState } from '../../lib/useRoom';

export default function Lobby({ session, room, players }: RoomState) {
  if (!session || !room) return null;
  const isHost = session.isHost;
  const [params, setLocal] = useState(room.params);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save<K extends keyof typeof params>(key: K, value: (typeof params)[K]) {
    const next = { ...params, [key]: value };
    setLocal(next);
    if (!session!.hostToken) return;
    setSaving(true);
    try {
      await updateParams(session!.hostToken, { [key]: value });
    } catch (err) { setError((err as Error).message); }
    finally { setSaving(false); }
  }

  async function openSubmissions() {
    setError(null);
    try { await setStatus(session!.hostToken!, 'submitting'); }
    catch (err) { setError((err as Error).message); }
  }

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_280px]">
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
        <h2 className="text-lg font-semibold">Tournament settings</h2>
        {isHost ? (
          <div className="mt-4 flex flex-col gap-5">
            <Field label="Theme / parameters">
              <input
                value={params.theme}
                onChange={(e) => save('theme', e.target.value)}
                placeholder="e.g. Best cover of a 90s song"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 outline-none focus:border-fuchsia-500"
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Songs per player">
                <NumberInput value={params.songs_per_player} min={1} max={8}
                  onChange={(v) => save('songs_per_player', v)} />
              </Field>
              <Field label="Vote timer (seconds)">
                <NumberInput value={params.vote_timer_seconds} min={10} max={600}
                  onChange={(v) => save('vote_timer_seconds', v)} />
              </Field>
            </div>
            <Toggle label="Players can vote on their own picks"
              checked={params.allow_self_vote}
              onChange={(v) => save('allow_self_vote', v)} />
            <Toggle label="Anonymous picks (hide who submitted what)"
              checked={params.anonymous}
              onChange={(v) => save('anonymous', v)} />

            <button
              onClick={openSubmissions}
              className="mt-2 rounded-xl bg-fuchsia-600 px-4 py-3 font-semibold text-white transition hover:bg-fuchsia-500"
            >
              Open submissions →
            </button>
            {saving && <p className="text-xs text-zinc-500">Saving…</p>}
            {error && <p className="text-sm text-rose-400">{error}</p>}
          </div>
        ) : (
          <ul className="mt-4 space-y-2 text-sm text-zinc-300">
            <li><span className="text-zinc-500">Theme:</span> {room.params.theme || '—'}</li>
            <li><span className="text-zinc-500">Songs per player:</span> {room.params.songs_per_player}</li>
            <li><span className="text-zinc-500">Vote timer:</span> {room.params.vote_timer_seconds}s</li>
            <p className="pt-3 text-zinc-500">Waiting for the organizer to open submissions…</p>
          </ul>
        )}
      </section>

      <PlayerList players={players} />
    </div>
  );
}

export function PlayerList({ players }: { players: RoomState['players'] }) {
  return (
    <aside className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">
        Players ({players.length})
      </h3>
      <ul className="space-y-2">
        {players.map((p) => (
          <li key={p.id} className="flex items-center gap-2 text-sm">
            <span className={`h-2 w-2 rounded-full ${p.connected ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
            <span className="text-zinc-200">{p.display_name}</span>
            {p.is_host && <span className="text-xs text-amber-400">★</span>}
          </li>
        ))}
      </ul>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm font-medium text-zinc-300">
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  );
}

function NumberInput({ value, min, max, onChange }: {
  value: number; min: number; max: number; onChange: (v: number) => void;
}) {
  return (
    <input
      type="number" value={value} min={min} max={max}
      onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value))))}
      className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 outline-none focus:border-fuchsia-500"
    />
  );
}

function Toggle({ label, checked, onChange }: {
  label: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-sm text-zinc-300">
      <span>{label}</span>
      <button
        type="button" onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-fuchsia-600' : 'bg-zinc-700'}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
    </label>
  );
}

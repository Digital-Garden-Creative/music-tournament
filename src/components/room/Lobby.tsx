import { useCallback, useEffect, useRef, useState } from 'react';
import { setStatus, updateParams } from '../../lib/api';
import type { RoomParams } from '../../lib/types';
import type { ReadyRoomState, RoomState } from '../../lib/useRoom';

export default function Lobby({ session, room, players }: ReadyRoomState) {
  const isHost = session.isHost;
  const [params, setLocal] = useState(room.params);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edits are batched and saved after a short pause rather than once per keystroke.
  const pending = useRef<Partial<RoomParams>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const patch = pending.current;
    pending.current = {};
    if (!session.hostToken || Object.keys(patch).length === 0) return;
    setSaving(true);
    try { await updateParams(session.hostToken, patch); }
    catch (err) { setError((err as Error).message); }
    finally { setSaving(false); }
  }, [session.hostToken]);

  useEffect(() => () => { flush(); }, [flush]);

  function save<K extends keyof RoomParams>(key: K, value: RoomParams[K]) {
    setLocal((p) => ({ ...p, [key]: value }));
    pending.current = { ...pending.current, [key]: value };
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 500);
  }

  async function openSubmissions() {
    setError(null);
    try {
      await flush();
      await setStatus(session.hostToken!, 'submitting');
    } catch (err) { setError((err as Error).message); }
  }

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_280px]">
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
            <li><span className="text-zinc-500">Vote on your own picks:</span> {room.params.allow_self_vote ? 'allowed' : 'not allowed'}</li>
            <li><span className="text-zinc-500">Picks:</span> {room.params.anonymous ? 'anonymous until the end' : 'names shown'}</li>
            <li className="pt-3 text-zinc-500">Waiting for the organizer to open submissions…</li>
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

// Keeps its own text so partial input ("3" on the way to "30") isn't clamped mid-typing;
// only in-range values are saved, and blur snaps the field back into range.
function NumberInput({ value, min, max, onChange }: {
  value: number; min: number; max: number; onChange: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));
  return (
    <input
      type="number" inputMode="numeric" value={text} min={min} max={max}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value !== '' && Number.isInteger(n) && n >= min && n <= max) onChange(n);
      }}
      onBlur={() => {
        const n = Number(text);
        const clamped = Number.isFinite(n) && text !== '' ? Math.max(min, Math.min(max, Math.round(n))) : value;
        setText(String(clamped));
        if (clamped !== value) onChange(clamped);
      }}
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
        type="button" role="switch" aria-checked={checked} aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-fuchsia-600' : 'bg-zinc-700'}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
    </label>
  );
}

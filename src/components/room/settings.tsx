import { useCallback, useEffect, useRef, useState } from 'react';
import { updateParams } from '../../lib/api';
import type { Room, RoomParams, Session } from '../../lib/types';

/** The host's editable copy of the room settings. Edits are batched and saved after a short
 *  pause rather than once per keystroke. */
export function useParamEditor(session: Session, room: Room) {
  const [params, setLocal] = useState(room.params);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<Partial<RoomParams>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const patch = pending.current;
    pending.current = {};
    if (!session.hostToken || Object.keys(patch).length === 0) return;
    setSaving(true);
    try { await updateParams(session.hostToken, patch); setError(null); }
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

  return { params, save, flush, saving, error, setError };
}

/** The settings that can change while the tournament runs (from the next vote on). */
export function LiveSettings({ params, save }: Pick<ReturnType<typeof useParamEditor>, 'params' | 'save'>) {
  return (
    <>
      <Field label="Vote timer (seconds)">
        <NumberInput value={params.vote_timer_seconds} min={10} max={600}
          onChange={(v) => save('vote_timer_seconds', v)} />
      </Field>
      <Toggle label="Players can vote on their own picks"
        checked={params.allow_self_vote}
        onChange={(v) => save('allow_self_vote', v)} />
      <Toggle label="Anonymous picks (hide who submitted what)"
        checked={params.anonymous}
        onChange={(v) => save('anonymous', v)} />
      <Toggle label="Audio only (hide every video)"
        checked={!!params.audio_only}
        onChange={(v) => save('audio_only', v)} />
    </>
  );
}

/** Read-only summary of the rules, for players. */
export function RulesList({ params, showSongs = true }: { params: RoomParams; showSongs?: boolean }) {
  return (
    <ul className="space-y-2 text-sm text-zinc-300">
      {showSongs && <li><span className="text-zinc-500">Songs per player:</span> {params.songs_per_player}</li>}
      <li><span className="text-zinc-500">Vote timer:</span> {params.vote_timer_seconds}s</li>
      <li><span className="text-zinc-500">Vote on your own picks:</span> {params.allow_self_vote ? 'allowed' : 'not allowed'}</li>
      <li><span className="text-zinc-500">Picks:</span> {params.anonymous ? 'anonymous until the end' : 'names shown'}</li>
      <li><span className="text-zinc-500">Playback:</span> {params.audio_only ? 'audio only' : "submitter's choice"}</li>
    </ul>
  );
}

/** Sidebar card during the tournament: the rules for everyone, editable by the host. */
export function RulesCard({ session, room }: { session: Session; room: Room }) {
  const [editing, setEditing] = useState(false);
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">Rules</h3>
        {session.isHost && (
          <button onClick={() => setEditing((e) => !e)}
            className="min-h-[34px] rounded-lg px-2.5 text-xs font-semibold text-fuchsia-300 transition hover:bg-fuchsia-500/10">
            {editing ? 'Done' : 'Change'}
          </button>
        )}
      </div>
      {editing ? <RulesEditor session={session} room={room} /> : <RulesList params={room.params} showSongs={false} />}
    </section>
  );
}

function RulesEditor({ session, room }: { session: Session; room: Room }) {
  const editor = useParamEditor(session, room);
  return (
    <div className="flex flex-col gap-4">
      <LiveSettings params={editor.params} save={editor.save} />
      <p className="text-xs text-zinc-500">
        {editor.saving ? 'Saving…' : 'Changes apply right away. A new timer starts with the next vote.'}
      </p>
      {editor.error && <p className="text-sm text-rose-400">{editor.error}</p>}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm font-medium text-zinc-300">
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  );
}

// Keeps its own text so partial input ("3" on the way to "30") isn't clamped mid-typing;
// only in-range values are saved, and blur snaps the field back into range.
export function NumberInput({ value, min, max, onChange }: {
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

// The switch says On/Off in words too, so its state can't be misread across a room.
export function Toggle({ label, checked, onChange }: {
  label: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm text-zinc-300">
      <span>{label}</span>
      <button
        type="button" role="switch" aria-checked={checked} aria-label={label}
        onClick={() => onChange(!checked)}
        className="flex min-h-[34px] shrink-0 items-center gap-2"
      >
        <span className={`w-7 text-right text-xs font-semibold ${checked ? 'text-fuchsia-300' : 'text-zinc-500'}`}>
          {checked ? 'On' : 'Off'}
        </span>
        <span className={`relative h-6 w-11 rounded-full transition ${checked ? 'bg-fuchsia-600' : 'bg-zinc-700'}`}>
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${checked ? 'left-[22px]' : 'left-0.5'}`} />
        </span>
      </button>
    </div>
  );
}

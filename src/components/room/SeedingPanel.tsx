import { useEffect, useRef, useState } from 'react';
import { reseedBracket, setSeedOrder } from '../../lib/api';
import type { Match, PublicSubmission } from '../../lib/types';

/** Round-1 songs in bracket order. */
export function roundOneOrder(matches: Match[]): string[] {
  return matches
    .filter((m) => m.round === 1)
    .sort((a, b) => a.slot - b.slot)
    .flatMap((m) => [m.song_a, m.song_b, m.song_c].filter((x): x is string => !!x));
}

/** `matches` with round 1 refilled from `order` (for previews; nulls show as TBD). */
export function withRoundOne(matches: Match[], order: (string | null)[]): Match[] {
  let i = 0;
  return [...matches]
    .sort((a, b) => a.round - b.round || a.slot - b.slot)
    .map((m) => {
      if (m.round !== 1) return m;
      const songs = order.slice(i, i + m.size);
      i += m.size;
      return { ...m, song_a: songs[0] ?? null, song_b: songs[1] ?? null, song_c: m.size === 3 ? songs[2] ?? null : null };
    });
}

/** Round-1 match sizes in order, e.g. [2, 2, 3]. */
const groupSizes = (matches: Match[]) =>
  matches.filter((m) => m.round === 1).sort((a, b) => a.slot - b.slot).map((m) => m.size);

const shuffled = <T,>(xs: T[]) => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

type Mode = 'menu' | 'hand' | 'text';

/** Host tools for the round-1 draw, until the first match opens. `onPreview` shows a
 *  temporary order in the bracket (the shuffle animation); null goes back to the real one. */
export default function SeedingPanel({ hostToken, matches, subsById, onPreview, refresh }: {
  hostToken: string;
  matches: Match[];
  subsById: Map<string, PublicSubmission>;
  onPreview: (order: string[] | null) => void;
  refresh: () => Promise<void>;
}) {
  const [mode, setMode] = useState<Mode>('menu');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const order = roundOneOrder(matches);
  const sizes = groupSizes(matches);
  const title = (id: string | null) => (id && subsById.get(id)?.title) || '?';

  // The shuffle animation: the bracket flips through random draws, slowing down, then the
  // server's fair draw lands.
  const cancelled = useRef(false);
  useEffect(() => {
    cancelled.current = false;
    return () => { cancelled.current = true; onPreview(null); };
  }, []);
  async function shuffle() {
    setBusy(true); setError(null);
    const result = reseedBracket(hostToken);
    result.catch(() => {});  // awaited below, after the animation
    try {
      for (let frame = 0; frame < 16 && !cancelled.current; frame++) {
        onPreview(shuffled(order));
        await new Promise((r) => setTimeout(r, 70 + frame * frame * 2.2));
      }
      await result;
      await refresh();
    } catch (err) { setError((err as Error).message); }
    finally { onPreview(null); setBusy(false); }
  }

  async function save(next: string[]) {
    setBusy(true); setError(null);
    try { await setSeedOrder(hostToken, next); await refresh(); setMode('menu'); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <section className="mb-6 rounded-2xl border border-violet-500/40 bg-violet-500/5 p-5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <h2 className="text-lg font-semibold">Set the draw</h2>
        <p className="text-xs text-zinc-400">You can redo it until the first match opens.</p>
      </div>

      {mode === 'menu' && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={shuffle} disabled={busy}
            className="min-h-[40px] rounded-xl bg-violet-600 px-4 py-2 font-semibold text-white transition hover:bg-violet-500 disabled:opacity-50">
            {busy ? '🎲 Shuffling…' : '🎲 Shuffle'}
          </button>
          <button onClick={() => { setMode('hand'); setError(null); }} disabled={busy}
            className="min-h-[40px] rounded-xl border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-50">
            ✋ Arrange by hand
          </button>
          <button onClick={() => { setMode('text'); setError(null); }} disabled={busy}
            className="min-h-[40px] rounded-xl border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-50">
            📝 Export / import as text
          </button>
        </div>
      )}

      {mode === 'hand' && (
        <HandEditor order={order} sizes={sizes} title={title} busy={busy}
          onCancel={() => setMode('menu')} onSave={save} />
      )}

      {mode === 'text' && (
        <TextEditor order={order} sizes={sizes} subsById={subsById} busy={busy}
          onCancel={() => setMode('menu')} onSave={save} onError={setError} />
      )}

      {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}
    </section>
  );
}

// Tap a slot, then another slot to swap them, or a song from "Not placed" to put it there.
// "Empty every slot" starts the draw from scratch.
function HandEditor({ order, sizes, title, busy, onCancel, onSave }: {
  order: string[]; sizes: number[]; title: (id: string | null) => string; busy: boolean;
  onCancel: () => void; onSave: (order: string[]) => void;
}) {
  const [draft, setDraft] = useState<(string | null)[]>(order);
  const [picked, setPicked] = useState<number | null>(null);
  const pool = order.filter((id) => !draft.includes(id));
  const complete = draft.every(Boolean);

  function tapSlot(i: number) {
    if (picked === null) { setPicked(i); return; }
    if (picked !== i) {
      setDraft((d) => { const n = [...d]; [n[picked], n[i]] = [n[i], n[picked]]; return n; });
    }
    setPicked(null);
  }
  function tapPool(id: string) {
    setDraft((d) => {
      const n = [...d];
      const at = picked ?? n.indexOf(null);
      if (at >= 0) n[at] = id;
      return n;
    });
    setPicked(null);
  }

  let start = 0;
  const groups = sizes.map((size) => { const g = { start, size }; start += size; return g; });

  return (
    <div className="mt-4">
      <p className="text-sm text-zinc-400">
        Tap a song, then another to swap them. Tap a song in <span className="text-zinc-200">Not placed</span> to
        drop it into the selected (or first empty) slot.
      </p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {groups.map((g, gi) => (
          <div key={gi} className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40">
            <p className="px-3 pt-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Match {gi + 1}{g.size === 3 ? ' · three-way' : ''}
            </p>
            {Array.from({ length: g.size }, (_, k) => g.start + k).map((i) => (
              <button key={i} onClick={() => tapSlot(i)}
                className={`flex min-h-[40px] w-full items-center gap-2 px-3 py-2 text-left text-sm transition ${
                  picked === i ? 'bg-violet-600/30 text-white' : 'text-zinc-200 hover:bg-zinc-800/70'
                }`}>
                <span className="w-5 shrink-0 text-xs text-zinc-500">{i + 1}</span>
                <span className="min-w-0 truncate">
                  {draft[i] ? title(draft[i]) : <span className="text-zinc-600">empty</span>}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>

      {pool.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Not placed ({pool.length})</p>
          <div className="flex flex-wrap gap-2">
            {pool.map((id) => (
              <button key={id} onClick={() => tapPool(id)}
                className="min-h-[36px] max-w-full truncate rounded-full border border-violet-500/40 px-3 py-1.5 text-sm text-violet-100 transition hover:bg-violet-500/15">
                {title(id)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button onClick={() => onSave(draft as string[])} disabled={!complete || busy}
          className="min-h-[40px] rounded-xl bg-violet-600 px-4 py-2 font-semibold text-white transition hover:bg-violet-500 disabled:opacity-40">
          Save draw
        </button>
        <button onClick={() => { setDraft(order.map(() => null)); setPicked(null); }} disabled={busy}
          className="min-h-[40px] rounded-xl border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition hover:bg-zinc-800">
          Empty every slot
        </button>
        <button onClick={onCancel}
          className="min-h-[40px] rounded-xl px-4 py-2 text-sm text-zinc-400 transition hover:bg-zinc-800">
          Cancel
        </button>
      </div>
    </div>
  );
}

// The draw as a numbered list, one song per line, to copy out or paste back in.
function orderToText(order: string[], sizes: number[], subsById: Map<string, PublicSubmission>): string {
  const lines: string[] = [];
  let i = 0;
  sizes.forEach((size, gi) => {
    lines.push(`Match ${gi + 1}`);
    for (let k = 0; k < size; k++, i++) lines.push(`${i + 1}. ${subsById.get(order[i])?.title ?? '?'}`);
    lines.push('');
  });
  return lines.join('\n').trim();
}

/** Reads a pasted list back into song ids: one title per line, numbering and "Match n"
 *  headings optional. Throws a readable message when the list doesn't cover every song. */
export function textToOrder(text: string, songs: PublicSubmission[]): string[] {
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  const left = [...songs];
  const order: string[] = [];
  const unknown: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^\s*\d+\s*[.)\-:]\s*/, '').trim();
    if (!line || /^match\s+\d+/i.test(line)) continue;
    const at = left.findIndex((s) => norm(s.title) === norm(line));
    if (at < 0) { unknown.push(line); continue; }
    order.push(left[at].id);
    left.splice(at, 1);
  }
  const problems: string[] = [];
  if (unknown.length) problems.push(`Not a song in this room: ${unknown.map((u) => `"${u}"`).join(', ')}.`);
  if (left.length) problems.push(`Missing: ${left.map((s) => `"${s.title}"`).join(', ')}.`);
  if (problems.length) throw new Error(problems.join(' '));
  return order;
}

function TextEditor({ order, sizes, subsById, busy, onCancel, onSave, onError }: {
  order: string[]; sizes: number[]; subsById: Map<string, PublicSubmission>; busy: boolean;
  onCancel: () => void; onSave: (order: string[]) => void; onError: (e: string | null) => void;
}) {
  const [text, setText] = useState(() => orderToText(order, sizes, subsById));
  const [copied, setCopied] = useState(false);
  const songs = order.map((id) => subsById.get(id)).filter((s): s is PublicSubmission => !!s);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { onError("Couldn't copy. Select the text and copy it by hand."); }
  }
  function apply() {
    try { onError(null); onSave(textToOrder(text, songs)); }
    catch (err) { onError((err as Error).message); }
  }

  return (
    <div className="mt-4">
      <p className="text-sm text-zinc-400">
        Copy the draw out, or edit or paste a list here and apply it. One song title per line;
        songs are paired in order (the last three share a match when the count is odd), so the
        numbers and match headings are just for reading.
      </p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={Math.min(18, order.length + sizes.length * 2)}
        aria-label="Draw as text" spellCheck={false}
        className="mt-3 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-200 outline-none focus:border-violet-500" />
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={apply} disabled={busy}
          className="min-h-[40px] rounded-xl bg-violet-600 px-4 py-2 font-semibold text-white transition hover:bg-violet-500 disabled:opacity-40">
          Apply this order
        </button>
        <button onClick={copy}
          className="min-h-[40px] rounded-xl border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition hover:bg-zinc-800">
          {copied ? '✓ Copied' : 'Copy'}
        </button>
        <button onClick={() => setText(orderToText(order, sizes, subsById))}
          className="min-h-[40px] rounded-xl border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition hover:bg-zinc-800">
          Reset to current
        </button>
        <button onClick={() => { onError(null); onCancel(); }}
          className="min-h-[40px] rounded-xl px-4 py-2 text-sm text-zinc-400 transition hover:bg-zinc-800">
          Cancel
        </button>
      </div>
    </div>
  );
}

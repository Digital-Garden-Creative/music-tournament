import { useEffect, useState } from 'react';
import {
  deletePick, getSubmissionCounts, myPicks, seedBracket, submitPick,
} from '../../lib/api';
import { parseYouTubeId, youTubeThumb } from '../../lib/youtube';
import type { MyPick } from '../../lib/types';
import type { RoomState } from '../../lib/useRoom';

export default function Submit({ session, room }: RoomState) {
  if (!session || !room) return null;
  const cap = room.params.songs_per_player;
  const [picks, setPicks] = useState<MyPick[]>([]);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [media, setMedia] = useState<'video' | 'audio'>('video');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try { setPicks(await myPicks(session!.sessionToken)); } catch { /* ignore */ }
  }
  useEffect(() => { load(); }, []);

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const ytId = parseYouTubeId(url);
    if (!ytId) { setError('Please paste a valid YouTube link.'); return; }
    setBusy(true);
    try {
      await submitPick(session!.sessionToken, title.trim() || 'Untitled', url.trim(), ytId, media);
      setTitle(''); setUrl(''); setMedia('video');
      await load();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    try { await deletePick(session!.sessionToken, id); await load(); }
    catch (err) { setError((err as Error).message); }
  }

  const remaining = cap - picks.length;

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_300px]">
      <section>
        {room.params.theme && (
          <div className="mb-4 rounded-xl border border-violet-500/30 bg-violet-500/10 px-4 py-3">
            <span className="text-xs uppercase tracking-wide text-violet-300">Theme</span>
            <p className="font-medium text-violet-100">{room.params.theme}</p>
          </div>
        )}

        <h2 className="text-lg font-semibold">
          Your picks <span className="text-zinc-500">({picks.length}/{cap})</span>
        </h2>

        <ul className="mt-3 space-y-2">
          {picks.map((p) => (
            <li key={p.id} className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
              {p.youtube_id && (
                <img src={youTubeThumb(p.youtube_id)} alt=""
                  className="h-12 w-20 rounded-md object-cover" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{p.title}</p>
                <p className="text-xs text-zinc-500">
                  {p.media_type === 'audio' ? '🎧 Audio only' : '📺 Video'}
                  {p.media_type === 'audio' && ` · rip ${p.rip_status}`}
                </p>
              </div>
              <button onClick={() => remove(p.id)}
                className="rounded-lg px-2 py-1 text-sm text-zinc-500 transition hover:bg-zinc-800 hover:text-rose-400">
                Remove
              </button>
            </li>
          ))}
        </ul>

        {remaining > 0 ? (
          <form onSubmit={add} className="mt-5 space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
            <input
              value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80}
              placeholder="Song label (e.g. Hendrix – All Along the Watchtower)"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 outline-none focus:border-fuchsia-500"
            />
            <input
              value={url} onChange={(e) => setUrl(e.target.value)} required
              placeholder="YouTube link"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 outline-none focus:border-fuchsia-500"
            />
            <div className="flex items-center gap-2">
              <MediaPill active={media === 'video'} onClick={() => setMedia('video')}>📺 Video</MediaPill>
              <MediaPill active={media === 'audio'} onClick={() => setMedia('audio')}>🎧 Audio only</MediaPill>
            </div>
            <p className="text-xs text-zinc-500">
              Audio-only picks get ripped to an MP3 in the background by the host's rip worker.
            </p>
            <button type="submit" disabled={busy}
              className="w-full rounded-xl bg-fuchsia-600 px-4 py-2.5 font-semibold text-white transition hover:bg-fuchsia-500 disabled:opacity-50">
              {busy ? 'Adding…' : 'Add pick'}
            </button>
            {error && <p className="text-sm text-rose-400">{error}</p>}
          </form>
        ) : (
          <p className="mt-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-emerald-300">
            ✓ All your picks are in! Waiting for the organizer to seed the bracket.
          </p>
        )}
        {error && remaining > 0 ? null : error && <p className="mt-3 text-sm text-rose-400">{error}</p>}
      </section>

      <HostPanel session={session} cap={cap} />
    </div>
  );
}

function HostPanel({ session, cap }: { session: RoomState['session']; cap: number }) {
  if (!session) return null;
  const [counts, setCounts] = useState<{ player_id: string; display_name: string; submitted: number }[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session.isHost) return;
    const load = () => getSubmissionCounts(session.roomId).then((c) => setCounts(c as typeof counts));
    load();
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [session.isHost]);

  if (!session.isHost) {
    return (
      <aside className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 text-sm text-zinc-400">
        Submit up to {cap} songs. The organizer will start the bracket once everyone's ready.
      </aside>
    );
  }

  const everyoneReady = counts.length > 0 && counts.every((c) => c.submitted >= cap);
  const total = counts.reduce((n, c) => n + Number(c.submitted), 0);

  async function seed() {
    setError(null);
    try { await seedBracket(session!.hostToken!); }
    catch (err) { setError((err as Error).message); }
  }

  return (
    <aside className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">
        Submission progress
      </h3>
      <ul className="space-y-2">
        {counts.map((c) => (
          <li key={c.player_id} className="flex items-center justify-between text-sm">
            <span className="text-zinc-200">{c.display_name}</span>
            <span className={Number(c.submitted) >= cap ? 'text-emerald-400' : 'text-zinc-500'}>
              {c.submitted}/{cap}
            </span>
          </li>
        ))}
      </ul>
      <button onClick={seed}
        className="mt-5 w-full rounded-xl bg-fuchsia-600 px-4 py-2.5 font-semibold text-white transition hover:bg-fuchsia-500 disabled:opacity-50"
        disabled={total < 2}>
        Seed bracket ({total} songs)
      </button>
      {!everyoneReady && counts.length > 0 && (
        <p className="mt-2 text-xs text-amber-400/80">Not everyone has submitted yet — you can still seed.</p>
      )}
      {error && <p className="mt-2 text-sm text-rose-400">{error}</p>}
    </aside>
  );
}

function MediaPill({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
        active ? 'bg-fuchsia-600 text-white' : 'border border-zinc-700 text-zinc-300 hover:bg-zinc-800'
      }`}>
      {children}
    </button>
  );
}

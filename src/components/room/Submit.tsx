import { useEffect, useState } from 'react';
import {
  deletePick, getSubmissionCounts, myPicks, seedBracket, setStatus, submitPick,
} from '../../lib/api';
import { checkYouTube, cleanSongTitle, parseYouTubeId, youTubeThumb } from '../../lib/youtube';
import type { YouTubeCheck } from '../../lib/youtube';
import type { MyPick } from '../../lib/types';
import type { ReadyRoomState } from '../../lib/useRoom';

export default function Submit({ session, room, players }: ReadyRoomState) {
  const cap = room.params.songs_per_player;
  const [picks, setPicks] = useState<MyPick[]>([]);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [media, setMedia] = useState<'video' | 'audio'>('video');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // What YouTube says about the pasted link, and the title we filled in from it (so a
  // title the player typed themselves is never overwritten).
  const [check, setCheck] = useState<{ id: string; result: YouTubeCheck | null } | null>(null);
  const [autoTitle, setAutoTitle] = useState('');
  const ytId = parseYouTubeId(url);

  useEffect(() => {
    if (!ytId) { setCheck(null); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      const result = await checkYouTube(ytId);
      if (cancelled) return;
      setCheck({ id: ytId, result });
      if (result?.ok && result.title) {
        const filled = cleanSongTitle(result.title).slice(0, 80);
        setTitle((cur) => (cur.trim() === '' || cur === autoTitle ? filled : cur));
        setAutoTitle(filled);
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [ytId]);
  const status = check && check.id === ytId ? check.result : null;

  async function load() {
    try { setPicks(await myPicks(session.sessionToken)); } catch { /* ignore */ }
  }
  useEffect(() => { load(); }, []);

  // Rip status changes on the server, so poll while any of our audio picks is still ripping.
  const ripping = picks.some(
    (p) => p.media_type === 'audio' && (p.rip_status === 'pending' || p.rip_status === 'processing'),
  );
  useEffect(() => {
    if (!ripping) return;
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [ripping]);

  async function add(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!ytId) { setError('Please paste a valid YouTube link.'); return; }
    if (status && !status.ok && status.reason === 'missing') {
      setError("That video can't be found. It may be private or deleted.");
      return;
    }
    if (status && !status.ok && status.reason === 'blocked' && media === 'video') {
      setError("That video can't play here. Switch to 🎧 Audio only, or find another upload.");
      return;
    }
    setBusy(true);
    try {
      await submitPick(session.sessionToken, title.trim() || 'Untitled', url.trim(), ytId, media);
      setTitle(''); setUrl(''); setMedia('video'); setAutoTitle(''); setCheck(null);
      await load();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    try { await deletePick(session.sessionToken, id); await load(); }
    catch (err) { setError((err as Error).message); }
  }

  const remaining = cap - picks.length;

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_300px]">
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
                  className="h-12 w-20 shrink-0 rounded-md object-cover" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{p.title}</p>
                <p className="text-xs text-zinc-500">
                  {p.media_type === 'audio' ? '🎧 Audio only' : '📺 Video'}
                  {p.media_type === 'audio' && ` · rip ${p.rip_status}`}
                </p>
              </div>
              <button onClick={() => remove(p.id)}
                className="min-h-[36px] rounded-lg px-2 py-1 text-sm text-zinc-500 transition hover:bg-zinc-800 hover:text-rose-400">
                Remove
              </button>
            </li>
          ))}
        </ul>

        {remaining > 0 ? (
          <form onSubmit={add} className="mt-5 space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
            <input
              value={url} onChange={(e) => { setUrl(e.target.value); setError(null); }} required
              inputMode="url" autoComplete="off" aria-label="YouTube link"
              placeholder="Paste a YouTube link"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 outline-none focus:border-fuchsia-500"
            />
            {ytId && <LinkStatus id={ytId} status={status} checked={check?.id === ytId} />}
            <input
              value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80}
              aria-label="Song label"
              placeholder="Song label (fills in from the link)"
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

      <HostPanel session={session} cap={cap}
        selfVoteOff={!room.params.allow_self_vote} playerCount={players.length} />
    </div>
  );
}

function HostPanel({ session, cap, selfVoteOff, playerCount }: {
  session: ReadyRoomState['session']; cap: number; selfVoteOff: boolean; playerCount: number;
}) {
  const [counts, setCounts] = useState<{ player_id: string; display_name: string; submitted: number }[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session.isHost) return;
    const load = () => getSubmissionCounts(session.roomId).then((c) => setCounts(c as typeof counts)).catch(() => {});
    load();
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [session.isHost]);

  if (!session.isHost) {
    return (
      <aside className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 text-sm text-zinc-400">
        Submit up to {cap} {cap === 1 ? 'song' : 'songs'}. The organizer will start the bracket once everyone's ready.
      </aside>
    );
  }

  const everyoneReady = counts.length > 0 && counts.every((c) => c.submitted >= cap);
  const total = counts.reduce((n, c) => n + Number(c.submitted), 0);

  async function seed() {
    setError(null);
    try { await seedBracket(session.hostToken!); }
    catch (err) { setError((err as Error).message); }
  }

  async function backToSettings() {
    setError(null);
    try { await setStatus(session.hostToken!, 'lobby'); }
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
      {selfVoteOff && playerCount < 3 && (
        <p className="mt-2 text-xs text-amber-400/80">
          Self-voting is off and there are fewer than 3 players, so some matches will have nobody
          allowed to vote. Go back to settings to turn it on.
        </p>
      )}
      {error && <p className="mt-2 text-sm text-rose-400">{error}</p>}
      <button onClick={backToSettings}
        className="mt-4 min-h-[36px] w-full rounded-lg text-sm text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200">
        ← Back to settings
      </button>
    </aside>
  );
}

// What YouTube says about the pasted link, under the field.
function LinkStatus({ id, status, checked }: { id: string; status: YouTubeCheck | null; checked: boolean }) {
  const tone = !checked ? 'text-zinc-500'
    : status?.ok === false ? (status.reason === 'missing' ? 'text-rose-400' : 'text-amber-300')
    : status?.ok ? 'text-emerald-300' : 'text-zinc-500';
  const text = !checked ? 'Checking the link…'
    : status?.ok ? '✓ Found on YouTube'
    : status?.reason === 'missing' ? "Couldn't find this video. It may be private or deleted."
    : status?.reason === 'blocked' ? "This video can't play here (its uploader blocks embedding). 🎧 Audio only still works."
    : "Couldn't check this link, but you can still add it.";
  return (
    <div className="flex items-center gap-3" aria-live="polite">
      {status?.ok && <img src={youTubeThumb(id)} alt="" className="h-10 w-16 shrink-0 rounded object-cover" />}
      <p className={`text-xs ${tone}`}>{text}</p>
    </div>
  );
}

function MediaPill({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick}
      className={`min-h-[36px] rounded-full px-3 py-1.5 text-sm font-medium transition ${
        active ? 'bg-fuchsia-600 text-white' : 'border border-zinc-700 text-zinc-300 hover:bg-zinc-800'
      }`}>
      {children}
    </button>
  );
}

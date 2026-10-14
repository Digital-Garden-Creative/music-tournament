import { useEffect, useMemo, useState } from 'react';
import { drawBracket, drawChampionCard, saveImage } from '../../lib/exportImage';
import type { ExportData } from '../../lib/exportImage';
import { clearSession } from '../../lib/session';
import { youTubeThumb } from '../../lib/youtube';
import type { PublicSubmission } from '../../lib/types';
import type { ReadyRoomState } from '../../lib/useRoom';
import BracketView from './BracketView';

export default function Complete({ room, matches, submissions, owners, players }: ReadyRoomState) {
  const subsById = useMemo(() => {
    const m = new Map<string, PublicSubmission>();
    submissions.forEach((s) => m.set(s.id, s));
    return m;
  }, [submissions]);

  const totalRounds = matches.reduce((max, m) => Math.max(max, m.round), 0);
  const champion = matches.find((m) => m.round === totalRounds)?.winner ?? null;
  const champSong = champion ? subsById.get(champion) : null;

  return (
    <div>
      <div className="mb-8 rounded-2xl border border-amber-500/40 bg-gradient-to-br from-amber-500/15 to-fuchsia-500/10 p-8 text-center">
        <div className="text-5xl">🏆</div>
        <p className="mt-2 text-xs uppercase tracking-wide text-amber-300/80">Champion</p>
        <h2 className="mt-1 text-3xl font-black text-amber-200">{champSong?.title ?? '—'}</h2>
        {champion && owners[champion] && (
          <p className="mt-1 text-amber-100/80">submitted by {owners[champion]}</p>
        )}
      </div>

      <ShareResults data={{ room, matches, subsById, owners, playerCount: players.length }} />

      <h3 className="mb-4 text-lg font-semibold">Every pick, revealed</h3>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {submissions.map((s) => (
          <li key={s.id} className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
            {s.youtube_id && (
              <img src={youTubeThumb(s.youtube_id)} alt="" className="h-12 w-20 shrink-0 rounded-md object-cover" />
            )}
            <div className="min-w-0">
              <p className="truncate font-medium" title={s.title}>{s.title}</p>
              <p className="text-xs text-zinc-500">{owners[s.id] ?? '—'}</p>
            </div>
          </li>
        ))}
      </ul>

      <h3 className="mt-10 mb-4 text-lg font-semibold">How it played out</h3>
      <BracketView matches={matches} subsById={subsById} owners={owners} />

      <div className="mt-8 text-center">
        <a href="/" onClick={() => clearSession(room.code)}
          className="inline-block rounded-xl border border-zinc-700 px-5 py-2.5 text-sm font-medium text-zinc-200 transition hover:bg-zinc-800">
          Start a new tournament
        </a>
      </div>
    </div>
  );
}

type Picture = { blob: Blob; url: string };

// Both images are drawn as soon as the results are in, so tapping one can open the share
// sheet straight away (phones only allow that right after a tap).
function ShareResults({ data }: { data: ExportData }) {
  const [bracket, setBracket] = useState<Picture | null>(null);
  const [card, setCard] = useState<Picture | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ownersKey = Object.keys(data.owners).length;

  useEffect(() => {
    let cancelled = false;
    const made: string[] = [];
    const picture = async (draw: Promise<Blob>, set: (p: Picture) => void) => {
      const blob = await draw;
      const url = URL.createObjectURL(blob);
      made.push(url);
      if (!cancelled) set({ blob, url });
    };
    Promise.all([picture(drawBracket(data), setBracket), picture(drawChampionCard(data), setCard)])
      .catch(() => { if (!cancelled) setError("Couldn't draw the images on this device."); });
    return () => { cancelled = true; made.forEach((u) => URL.revokeObjectURL(u)); };
  }, [data.matches, ownersKey, data.subsById]);

  const name = `song-tournament-${data.room.code.toLowerCase()}`;
  return (
    <section className="mb-10 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
      <h3 className="text-lg font-semibold">Share the results</h3>
      <p className="mt-1 text-sm text-zinc-400">Tap an image to save or share it.</p>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Shot label="Bracket" pic={bracket} onSave={() => bracket && saveImage(bracket.blob, `${name}-bracket.png`)} />
        <Shot label="Champion card" pic={card} tall onSave={() => card && saveImage(card.blob, `${name}-champion.png`)} />
      </div>
      {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}
    </section>
  );
}

function Shot({ label, pic, tall = false, onSave }: {
  label: string; pic: Picture | null; tall?: boolean; onSave: () => void;
}) {
  return (
    <button onClick={onSave} disabled={!pic}
      className="group flex flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 text-left transition hover:border-fuchsia-500/60 disabled:opacity-60">
      <div className={`flex w-full items-center justify-center bg-black ${tall ? 'aspect-[9/16] max-h-80' : 'aspect-video'}`}>
        {pic ? <img src={pic.url} alt={`${label} preview`} className="h-full w-full object-contain" />
          : <span className="text-sm text-zinc-500">Drawing…</span>}
      </div>
      <span className="flex min-h-[44px] items-center justify-between gap-2 px-3 py-2 text-sm font-semibold text-zinc-200">
        {label}
        <span className="text-fuchsia-300 group-hover:text-fuchsia-200">Save ↓</span>
      </span>
    </button>
  );
}

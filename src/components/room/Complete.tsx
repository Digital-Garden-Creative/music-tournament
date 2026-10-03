import { useMemo } from 'react';
import { clearSession } from '../../lib/session';
import { youTubeThumb } from '../../lib/youtube';
import type { PublicSubmission } from '../../lib/types';
import type { ReadyRoomState } from '../../lib/useRoom';

export default function Complete({ room, matches, submissions, owners }: ReadyRoomState) {
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

      <h3 className="mb-4 text-lg font-semibold">Every pick, revealed</h3>
      <ul className="grid gap-3 sm:grid-cols-2">
        {submissions.map((s) => (
          <li key={s.id} className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
            {s.youtube_id && (
              <img src={youTubeThumb(s.youtube_id)} alt="" className="h-12 w-20 rounded-md object-cover" />
            )}
            <div className="min-w-0">
              <p className="truncate font-medium">{s.title}</p>
              <p className="text-xs text-zinc-500">{owners[s.id] ?? '—'}</p>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-8 text-center">
        <a href="/" onClick={() => clearSession(room.code)}
          className="inline-block rounded-xl border border-zinc-700 px-5 py-2.5 text-sm font-medium text-zinc-200 transition hover:bg-zinc-800">
          Start a new tournament
        </a>
      </div>
    </div>
  );
}

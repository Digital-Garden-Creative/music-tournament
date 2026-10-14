import { useMemo } from 'react';
import { roundName } from '../../lib/bracket';
import type { Match, PublicSubmission } from '../../lib/types';

/** The bracket as columns of match cards. Read-only unless `canOpen`/`onOpen` (start a
 *  match) or `canEdit`/`onEdit` (change a decided match's winner) are given. */
export default function BracketView({ matches, subsById, owners, canOpen, onOpen, canEdit, onEdit, shuffling = false }: {
  matches: Match[];
  subsById: Map<string, PublicSubmission>;
  owners: Record<string, string>;
  canOpen?: (m: Match) => boolean;
  onOpen?: (m: Match) => void;
  canEdit?: (m: Match) => boolean;
  onEdit?: (m: Match) => void;
  /** Round 1 is mid shuffle-animation. */
  shuffling?: boolean;
}) {
  const totalRounds = matches.reduce((max, m) => Math.max(max, m.round), 0);
  const rounds = useMemo(() => {
    const byRound = new Map<number, Match[]>();
    matches.forEach((m) => {
      if (!byRound.has(m.round)) byRound.set(m.round, []);
      byRound.get(m.round)!.push(m);
    });
    return [...byRound.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([round, ms]) => [round, [...ms].sort((a, b) => a.slot - b.slot)] as const);
  }, [matches]);

  return (
    <div className="flex gap-6 overflow-x-auto pb-4">
      {rounds.map(([round, ms]) => (
        <div key={round} className="min-w-[220px] flex-1">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            {roundName(round, totalRounds)}
          </h3>
          <div className="flex flex-col gap-3">
            {ms.map((m) => (
              <MatchCard
                key={m.id} match={m} subsById={subsById} owners={owners}
                canOpen={canOpen?.(m) ?? false}
                onOpen={() => onOpen?.(m)}
                canEdit={canEdit?.(m) ?? false}
                onEdit={() => onEdit?.(m)}
                shuffling={shuffling && m.round === 1}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function MatchCard({ match, subsById, owners, canOpen, onOpen, canEdit, onEdit, shuffling }: {
  match: Match; subsById: Map<string, PublicSubmission>; owners: Record<string, string>;
  canOpen: boolean; onOpen: () => void; canEdit: boolean; onEdit: () => void; shuffling: boolean;
}) {
  const rows = [
    { id: match.song_a, votes: match.votes_a },
    { id: match.song_b, votes: match.votes_b },
    ...(match.size === 3 || match.song_c ? [{ id: match.song_c, votes: match.votes_c }] : []),
  ];
  const row = (id: string | null, votes: number | null) => {
    const s = id ? subsById.get(id) : null;
    const isWinner = match.winner && match.winner === id;
    const out = !!id && id === match.excluded;
    return (
      <div className={`flex items-center justify-between gap-2 px-3 py-2 text-sm ${
        isWinner ? 'font-semibold text-emerald-300' : out ? 'text-zinc-500 line-through' : 'text-zinc-300'
      }`}>
        <span className="min-w-0 truncate" title={s?.title}>
          {/* rooms from before three-way matches could still have byes */}
          {s ? s.title : <span className="text-zinc-600">{match.round === 1 && match.status === 'closed' ? '— bye —' : 'TBD'}</span>}
          {s && owners[s.id] && <span className="ml-1.5 text-xs font-normal text-zinc-500">· {owners[s.id]}</span>}
        </span>
        {match.status === 'closed' && match.opened_at && votes !== null && (
          <span className="shrink-0 text-xs text-zinc-500">{votes}</span>
        )}
      </div>
    );
  };
  return (
    <div className={`overflow-hidden rounded-xl border transition ${
      shuffling ? 'border-violet-500/60 ring-1 ring-violet-500/40'
        : match.status === 'open' || match.status === 'listening' ? 'border-fuchsia-500/60 ring-1 ring-fuchsia-500/30'
        : match.status === 'discussion' ? 'border-amber-500/50'
        : 'border-zinc-800'
    } bg-zinc-900/40`}>
      {rows.map((r, i) => (
        <div key={i}>
          {i > 0 && <div className="h-px bg-zinc-800" />}
          {row(r.id, r.votes)}
        </div>
      ))}
      {canOpen && (
        <button onClick={onOpen}
          className="min-h-[36px] w-full bg-fuchsia-600/90 py-1.5 text-xs font-semibold text-white transition hover:bg-fuchsia-500">
          Open voting
        </button>
      )}
      {match.status === 'listening' && (
        <div className="bg-fuchsia-500/15 py-1.5 text-center text-xs font-semibold text-fuchsia-300">
          🎧 Listening
        </div>
      )}
      {match.overridden && (
        <div className="bg-amber-500/10 py-1 text-center text-[11px] font-semibold uppercase tracking-wide text-amber-300/90">
          Host's pick
        </div>
      )}
      {canEdit && (
        <button onClick={onEdit}
          className="min-h-[34px] w-full border-t border-zinc-800 py-1.5 text-xs font-medium text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200">
          Change winner
        </button>
      )}
      {match.status === 'discussion' && (
        <div className="bg-amber-500/15 py-1.5 text-center text-xs font-semibold text-amber-300">
          Tie — discussing
        </div>
      )}
    </div>
  );
}

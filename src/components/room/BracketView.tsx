import { useMemo } from 'react';
import type { Match, PublicSubmission } from '../../lib/types';

const ROUND_NAME = (round: number, totalRounds: number) => {
  const fromEnd = totalRounds - round;
  if (fromEnd === 0) return 'Final';
  if (fromEnd === 1) return 'Semifinals';
  if (fromEnd === 2) return 'Quarterfinals';
  return `Round ${round}`;
};

/** The bracket as columns of match cards. Read-only unless `canOpen`/`onOpen` are given. */
export default function BracketView({ matches, subsById, owners, canOpen, onOpen }: {
  matches: Match[];
  subsById: Map<string, PublicSubmission>;
  owners: Record<string, string>;
  canOpen?: (m: Match) => boolean;
  onOpen?: (m: Match) => void;
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
            {ROUND_NAME(round, totalRounds)}
          </h3>
          <div className="flex flex-col gap-3">
            {ms.map((m) => (
              <MatchCard
                key={m.id} match={m} subsById={subsById} owners={owners}
                canOpen={canOpen?.(m) ?? false}
                onOpen={() => onOpen?.(m)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function MatchCard({ match, subsById, owners, canOpen, onOpen }: {
  match: Match; subsById: Map<string, PublicSubmission>; owners: Record<string, string>;
  canOpen: boolean; onOpen: () => void;
}) {
  const a = match.song_a ? subsById.get(match.song_a) : null;
  const b = match.song_b ? subsById.get(match.song_b) : null;
  const row = (s: PublicSubmission | null | undefined, id: string | null, votes: number | null) => {
    const isWinner = match.winner && match.winner === id;
    return (
      <div className={`flex items-center justify-between gap-2 px-3 py-2 text-sm ${
        isWinner ? 'font-semibold text-emerald-300' : 'text-zinc-300'
      }`}>
        <span className="min-w-0 truncate" title={s?.title}>
          {s ? s.title : <span className="text-zinc-600">{match.round === 1 ? '— bye —' : 'TBD'}</span>}
          {s && owners[s.id] && <span className="ml-1.5 text-xs font-normal text-zinc-500">· {owners[s.id]}</span>}
        </span>
        {match.status === 'closed' && match.opened_at && votes !== null && (
          <span className="shrink-0 text-xs text-zinc-500">{votes}</span>
        )}
      </div>
    );
  };
  return (
    <div className={`overflow-hidden rounded-xl border ${
      match.status === 'open' ? 'border-fuchsia-500/60 ring-1 ring-fuchsia-500/30'
        : match.status === 'discussion' ? 'border-amber-500/50'
        : 'border-zinc-800'
    } bg-zinc-900/40`}>
      {row(a, match.song_a, match.votes_a)}
      <div className="h-px bg-zinc-800" />
      {row(b, match.song_b, match.votes_b)}
      {canOpen && (
        <button onClick={onOpen}
          className="min-h-[36px] w-full bg-fuchsia-600/90 py-1.5 text-xs font-semibold text-white transition hover:bg-fuchsia-500">
          Open voting
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

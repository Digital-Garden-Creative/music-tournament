import { useMemo } from 'react';
import { openMatch, revealRoom } from '../../lib/api';
import type { Match, PublicSubmission } from '../../lib/types';
import type { RoomState } from '../../lib/useRoom';
import MatchPanel from './MatchPanel';
import { PlayerList } from './Lobby';

const ROUND_NAME = (round: number, totalRounds: number) => {
  const fromEnd = totalRounds - round;
  if (fromEnd === 0) return 'Final';
  if (fromEnd === 1) return 'Semifinals';
  if (fromEnd === 2) return 'Quarterfinals';
  return `Round ${round}`;
};

export default function Bracket(state: RoomState) {
  const { session, room, matches, submissions, players } = state;
  if (!session || !room) return null;

  const subsById = useMemo(() => {
    const m = new Map<string, PublicSubmission>();
    submissions.forEach((s) => m.set(s.id, s));
    return m;
  }, [submissions]);

  const totalRounds = matches.reduce((max, m) => Math.max(max, m.round), 0);
  const rounds = useMemo(() => {
    const byRound = new Map<number, Match[]>();
    matches.forEach((m) => {
      if (!byRound.has(m.round)) byRound.set(m.round, []);
      byRound.get(m.round)!.push(m);
    });
    return [...byRound.entries()].sort((a, b) => a[0] - b[0]);
  }, [matches]);

  const active = matches.find((m) => m.status === 'open' || m.status === 'discussion') ?? null;
  const champion = matches.find((m) => m.round === totalRounds)?.winner ?? null;
  const isHost = session.isHost;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
      <div>
        {active ? (
          <MatchPanel match={active} subsById={subsById} state={state} />
        ) : champion ? (
          <ChampionBanner
            title={subsById.get(champion)?.title ?? 'Champion'}
            isHost={isHost}
            onReveal={() => revealRoom(session.hostToken!)}
          />
        ) : (
          <div className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 text-zinc-400">
            {isHost ? 'Pick a match below and open it to start voting.' : 'Waiting for the organizer to open the next match…'}
          </div>
        )}

        <div className="flex gap-6 overflow-x-auto pb-4">
          {rounds.map(([round, ms]) => (
            <div key={round} className="min-w-[220px] flex-1">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                {ROUND_NAME(round, totalRounds)}
              </h3>
              <div className="flex flex-col gap-3">
                {ms.sort((a, b) => a.slot - b.slot).map((m) => (
                  <MatchCard
                    key={m.id} match={m} subsById={subsById}
                    canOpen={isHost && !active && m.status === 'pending' && !!m.song_a && !!m.song_b}
                    onOpen={() => openMatch(session.hostToken!, m.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <PlayerList players={players} />
    </div>
  );
}

function MatchCard({ match, subsById, canOpen, onOpen }: {
  match: Match; subsById: Map<string, PublicSubmission>;
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
        <span className="truncate">{s ? s.title : <span className="text-zinc-600">— bye —</span>}</span>
        {match.status === 'closed' && votes !== null && (
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
          className="w-full bg-fuchsia-600/90 py-1.5 text-xs font-semibold text-white transition hover:bg-fuchsia-500">
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

function ChampionBanner({ title, isHost, onReveal }: {
  title: string; isHost: boolean; onReveal: () => void;
}) {
  return (
    <div className="mb-6 rounded-2xl border border-amber-500/40 bg-gradient-to-br from-amber-500/15 to-fuchsia-500/10 p-8 text-center">
      <div className="text-4xl">🏆</div>
      <p className="mt-2 text-xs uppercase tracking-wide text-amber-300/80">Champion</p>
      <h2 className="mt-1 text-3xl font-black text-amber-200">{title}</h2>
      {isHost && (
        <button onClick={onReveal}
          className="mt-5 rounded-xl bg-fuchsia-600 px-5 py-2.5 font-semibold text-white transition hover:bg-fuchsia-500">
          Reveal who picked what →
        </button>
      )}
    </div>
  );
}

import { useMemo, useState } from 'react';
import { openMatch, revealRoom } from '../../lib/api';
import type { PublicSubmission } from '../../lib/types';
import type { ReadyRoomState } from '../../lib/useRoom';
import BracketView from './BracketView';
import MatchPanel from './MatchPanel';
import { PlayerList } from './Lobby';

export default function Bracket(state: ReadyRoomState) {
  const { session, matches, submissions, players, owners } = state;
  const [error, setError] = useState<string | null>(null);
  const act = (p: Promise<unknown>) => { setError(null); p.catch((e: Error) => setError(e.message)); };

  const subsById = useMemo(() => {
    const m = new Map<string, PublicSubmission>();
    submissions.forEach((s) => m.set(s.id, s));
    return m;
  }, [submissions]);

  const totalRounds = matches.reduce((max, m) => Math.max(max, m.round), 0);

  const active = matches.find((m) => m.status === 'open' || m.status === 'discussion') ?? null;
  const champion = matches.find((m) => m.round === totalRounds)?.winner ?? null;
  // Between matches, keep the last result on screen (byes were never opened, so skip them).
  const lastPlayed = matches
    .filter((m) => m.status === 'closed' && m.opened_at)
    .sort((x, y) => y.opened_at!.localeCompare(x.opened_at!))[0] ?? null;
  const isHost = session.isHost;
  // The earliest match with both songs in, so the host can move on without hunting for it.
  const nextUp = matches
    .filter((m) => m.status === 'pending' && m.song_a && m.song_b)
    .sort((x, y) => x.round - y.round || x.slot - y.slot)[0] ?? null;
  const title = (id: string | null) => (id && subsById.get(id)?.title) || '?';

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
      <div>
        {active ? (
          <MatchPanel match={active} subsById={subsById} state={state} />
        ) : champion ? (
          <ChampionBanner
            title={subsById.get(champion)?.title ?? 'Champion'}
            isHost={isHost}
            anonymous={state.room.params.anonymous}
            onReveal={() => act(revealRoom(session.hostToken!))}
          />
        ) : (
          <>
            {lastPlayed && <MatchPanel match={lastPlayed} subsById={subsById} state={state} />}
            <div className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 text-zinc-400">
              {isHost && nextUp ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="min-w-0">
                    <span className="block text-xs uppercase tracking-wide text-zinc-500">Up next</span>
                    <span className="text-zinc-200">{title(nextUp.song_a)}</span>
                    <span className="mx-2 text-zinc-600">vs</span>
                    <span className="text-zinc-200">{title(nextUp.song_b)}</span>
                  </p>
                  <button onClick={() => act(openMatch(session.hostToken!, nextUp.id))}
                    className="min-h-[40px] shrink-0 rounded-xl bg-fuchsia-600 px-4 py-2 font-semibold text-white transition hover:bg-fuchsia-500">
                    Open next match →
                  </button>
                </div>
              ) : isHost ? 'Pick a match below and open it to start voting.'
                : 'Waiting for the organizer to open the next match…'}
            </div>
          </>
        )}

        {error && <p className="mb-4 text-sm text-rose-400">{error}</p>}

        <BracketView
          matches={matches} subsById={subsById} owners={owners}
          canOpen={(m) => isHost && !active && m.status === 'pending' && !!m.song_a && !!m.song_b}
          onOpen={(m) => act(openMatch(session.hostToken!, m.id))}
        />
      </div>

      <PlayerList players={players} />
    </div>
  );
}

function ChampionBanner({ title, isHost, anonymous, onReveal }: {
  title: string; isHost: boolean; anonymous: boolean; onReveal: () => void;
}) {
  return (
    <div className="mb-6 rounded-2xl border border-amber-500/40 bg-gradient-to-br from-amber-500/15 to-fuchsia-500/10 p-8 text-center">
      <div className="text-4xl">🏆</div>
      <p className="mt-2 text-xs uppercase tracking-wide text-amber-300/80">Champion</p>
      <h2 className="mt-1 text-3xl font-black text-amber-200">{title}</h2>
      {isHost && (
        <button onClick={onReveal}
          className="mt-5 rounded-xl bg-fuchsia-600 px-5 py-2.5 font-semibold text-white transition hover:bg-fuchsia-500">
          {anonymous ? 'Reveal who picked what →' : 'Finish tournament →'}
        </button>
      )}
    </div>
  );
}

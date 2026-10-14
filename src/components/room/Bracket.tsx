import { useEffect, useMemo, useRef, useState } from 'react';
import { openMatch, overrideWinner, revealRoom } from '../../lib/api';
import type { Match, PublicSubmission } from '../../lib/types';
import type { ReadyRoomState } from '../../lib/useRoom';
import BracketView from './BracketView';
import MatchPanel from './MatchPanel';
import { PlayerList } from './Lobby';
import SeedingPanel, { withRoundOne } from './SeedingPanel';
import { RulesCard } from './settings';

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

  const active = matches.find((m) => m.status === 'listening' || m.status === 'open' || m.status === 'discussion') ?? null;
  const champion = matches.find((m) => m.round === totalRounds)?.winner ?? null;
  // Between matches, keep the last result on screen (byes were never opened, so skip them).
  const lastPlayed = matches
    .filter((m) => m.status === 'closed' && m.opened_at)
    .sort((x, y) => y.opened_at!.localeCompare(x.opened_at!))[0] ?? null;
  const isHost = session.isHost;
  // The earliest match with every song in, so the host can move on without hunting for it.
  const nextUp = matches
    .filter((m) => m.status === 'pending' && ready(m))
    .sort((x, y) => x.round - y.round || x.slot - y.slot)[0] ?? null;
  const title = (id: string | null) => (id && subsById.get(id)?.title) || '?';

  // Before any match has started, the host can redo the draw.
  const untouched = matches.length > 0 && matches.every((m) => m.status === 'pending' && !m.opened_at);
  const [preview, setPreview] = useState<string[] | null>(null);
  const shown = preview ? withRoundOne(matches, preview) : matches;

  // The decided match whose winner the host is changing (looked up fresh on every update).
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = matches.find((m) => m.id === editingId && m.status === 'closed') ?? null;

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
            {isHost && untouched && (
              <SeedingPanel hostToken={session.hostToken!} matches={matches} subsById={subsById}
                onPreview={setPreview} refresh={state.refresh} />
            )}
            {lastPlayed && <MatchPanel match={lastPlayed} subsById={subsById} state={state} />}
            <div className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 text-zinc-400">
              {isHost && nextUp ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="min-w-0">
                    <span className="block text-xs uppercase tracking-wide text-zinc-500">Up next</span>
                    {[nextUp.song_a, nextUp.song_b, nextUp.song_c].filter(Boolean).map((id, i) => (
                      <span key={id}>
                        {i > 0 && <span className="mx-2 text-zinc-600">vs</span>}
                        <span className="text-zinc-200">{title(id)}</span>
                      </span>
                    ))}
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

        {editing && (
          <OverridePanel match={editing} matches={matches} title={title}
            onCancel={() => setEditingId(null)}
            onPick={(winner) => {
              setError(null);
              overrideWinner(session.hostToken!, editing.id, winner)
                .then(() => setEditingId(null))
                .catch((e: Error) => setError(e.message));
            }} />
        )}

        <BracketView
          matches={shown} subsById={subsById} owners={owners}
          canOpen={(m) => isHost && !active && !preview && m.status === 'pending' && ready(m)}
          onOpen={(m) => act(openMatch(session.hostToken!, m.id))}
          canEdit={(m) => isHost && m.status === 'closed' && !!m.winner}
          onEdit={(m) => setEditingId(m.id)}
          shuffling={!!preview}
        />
      </div>

      <div className="flex flex-col gap-6">
        <PlayerList players={players} />
        <RulesCard session={session} room={state.room} />
      </div>
    </div>
  );
}

// The started matches a decided match's result fed into, in order: these are the ones
// changing its winner resets.
function laterPlayed(matches: Match[], from: Match): Match[] {
  const out: Match[] = [];
  let cur = from;
  for (;;) {
    const k = matches.filter((m) => m.round === cur.round).length;
    if (k <= 1) break;
    const g = Math.floor(k / 2);
    const target = Math.min(Math.floor(cur.slot / 2), g - 1);
    const next = matches.find((m) => m.round === cur.round + 1 && m.slot === target);
    if (!next || (next.status === 'pending' && !next.opened_at)) break;
    out.push(next);
    cur = next;
  }
  return out;
}

function OverridePanel({ match, matches, title, onCancel, onPick }: {
  match: Match; matches: Match[]; title: (id: string | null) => string;
  onCancel: () => void; onPick: (winner: string) => void;
}) {
  const [choice, setChoice] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [match.id]);
  const songs = [match.song_a, match.song_b, match.song_c].filter((x): x is string => !!x);
  const resets = laterPlayed(matches, match);
  return (
    <section ref={ref} className="mb-6 rounded-2xl border border-amber-500/40 bg-amber-500/5 p-5">
      <h2 className="text-lg font-semibold">Change the winner</h2>
      <p className="mt-1 text-sm text-zinc-400">Pick the song that should go through instead.</p>
      <div className="mt-3 flex flex-col gap-2">
        {songs.map((id) => {
          const current = id === match.winner;
          return (
            <button key={id} onClick={() => setChoice(id)} disabled={current}
              className={`flex min-h-[40px] items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left text-sm transition ${
                choice === id ? 'border-amber-400 bg-amber-500/15 text-white'
                  : current ? 'border-emerald-500/40 text-emerald-300'
                  : 'border-zinc-700 text-zinc-200 hover:bg-zinc-800'
              }`}>
              <span className="min-w-0 truncate">{title(id)}</span>
              {current && <span className="shrink-0 text-xs">current winner</span>}
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-sm text-amber-200/80">
        {resets.length === 0
          ? 'Nothing later has been played yet, so only this result changes.'
          : `This resets ${resets.length} later ${resets.length === 1 ? 'match' : 'matches'}, which will be played again${
              resets.some((m) => m.status !== 'closed') ? ', including the one in progress' : ''
            }.`}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={() => choice && onPick(choice)} disabled={!choice}
          className="min-h-[40px] rounded-xl bg-amber-600 px-4 py-2 font-semibold text-white transition hover:bg-amber-500 disabled:opacity-40">
          Make it the winner
        </button>
        <button onClick={onCancel}
          className="min-h-[40px] rounded-xl px-4 py-2 text-sm text-zinc-400 transition hover:bg-zinc-800">
          Cancel
        </button>
      </div>
    </section>
  );
}

// Every slot filled: two songs, or three for a three-way.
function ready(m: Match): boolean {
  return !!m.song_a && !!m.song_b && (m.size !== 3 || !!m.song_c);
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

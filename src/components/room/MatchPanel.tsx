import { useEffect, useState } from 'react';
import { castVote, closeExpiredMatch, closeMatch, startRevote } from '../../lib/api';
import { youTubeEmbed } from '../../lib/youtube';
import type { Match, PublicSubmission } from '../../lib/types';
import type { ReadyRoomState } from '../../lib/useRoom';

export default function MatchPanel({ match, subsById, state }: {
  match: Match; subsById: Map<string, PublicSubmission>; state: ReadyRoomState;
}) {
  const { session, players, owners } = state;
  const a = match.song_a ? subsById.get(match.song_a) : null;
  const b = match.song_b ? subsById.get(match.song_b) : null;
  const isHost = session.isHost;
  const myId = session.playerId;

  const [choice, setChoice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset local highlight when the match or vote round changes.
  useEffect(() => { setChoice(null); setError(null); }, [match.id, match.vote_round]);

  const remaining = useCountdown(match.closes_at, match.status === 'open');
  const haveVoted = match.voted_player_ids.includes(myId);
  const voterCount = match.eligible_voters ?? players.filter((p) => p.connected).length;

  // When the timer runs out, every client asks the server to close the match, so voting
  // doesn't stall if the organizer's tab is closed. Calls are staggered, and retried
  // because the server ignores them until its own clock says time is up.
  const expired = match.status === 'open' && remaining === 0;
  useEffect(() => {
    if (!expired) return;
    const close = () => { closeExpiredMatch(session.sessionToken, match.id).catch(() => {}); };
    const first = setTimeout(close, 300 + Math.random() * 1200);
    const retry = setInterval(close, 3000);
    return () => { clearTimeout(first); clearInterval(retry); };
  }, [expired, session.sessionToken, match.id, match.vote_round]);

  async function vote(songId: string) {
    setError(null);
    setChoice(songId);
    try { await castVote(session.sessionToken, match.id, songId); }
    catch (err) { setError((err as Error).message); setChoice(null); }
  }

  const revealed = match.status === 'closed';
  const tie = match.status === 'discussion';

  return (
    <section className="mb-6 rounded-2xl border border-fuchsia-500/40 bg-zinc-900/60 p-5 shadow-lg shadow-fuchsia-950/20">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          {tie ? '🤝 Tie — discuss!' : revealed ? 'Result' : 'Now voting'}
        </h2>
        {match.status === 'open' && remaining !== null && (
          <span className={`rounded-full px-3 py-1 font-mono text-sm font-bold ${
            remaining <= 10 ? 'bg-rose-500/20 text-rose-300' : 'bg-zinc-800 text-zinc-200'
          }`}>
            {remaining}s
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SongChoice
          song={a} side="a" votes={match.votes_a} revealed={revealed}
          winner={match.winner === match.song_a}
          owner={a ? owners[a.id] : undefined}
          selected={choice === match.song_a}
          disabled={match.status !== 'open'}
          onVote={() => a && vote(a.id)}
        />
        <SongChoice
          song={b} side="b" votes={match.votes_b} revealed={revealed}
          winner={match.winner === match.song_b}
          owner={b ? owners[b.id] : undefined}
          selected={choice === match.song_b}
          disabled={match.status !== 'open'}
          onVote={() => b && vote(b.id)}
        />
      </div>

      {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-zinc-400">
        <span>
          {match.status === 'open' && (
            <>{haveVoted ? '✓ Vote locked in (tap a card to change). ' : 'Cast your vote. '}
            {match.voted_player_ids.length}/{voterCount} voted</>
          )}
          {tie && 'Votes were even — the organizer will reopen voting.'}
          {revealed && 'Match complete.'}
        </span>

        {isHost && (
          <div className="flex gap-2">
            {match.status === 'open' && (
              <button onClick={() => closeMatch(session.hostToken!, match.id).catch((e) => setError(e.message))}
                className="min-h-[36px] rounded-lg border border-zinc-700 px-3 py-1.5 text-zinc-200 transition hover:bg-zinc-800">
                Close now
              </button>
            )}
            {tie && (
              <button onClick={() => startRevote(session.hostToken!, match.id).catch((e) => setError(e.message))}
                className="min-h-[36px] rounded-lg bg-amber-600 px-3 py-1.5 font-semibold text-white transition hover:bg-amber-500">
                Start re-vote
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function SongChoice({ song, side, votes, revealed, winner, owner, selected, disabled, onVote }: {
  song: PublicSubmission | null | undefined;
  side: 'a' | 'b'; votes: number | null; revealed: boolean; owner: string | undefined;
  winner: boolean; selected: boolean; disabled: boolean; onVote: () => void;
}) {
  if (!song) return <div className="rounded-xl border border-zinc-800 p-6 text-center text-zinc-600">— bye —</div>;
  return (
    <div className={`overflow-hidden rounded-xl border transition ${
      winner ? 'border-emerald-500/60 ring-1 ring-emerald-500/40'
        : selected ? 'border-fuchsia-500/70'
        : 'border-zinc-800'
    } bg-zinc-950/60`}>
      <SongPlayer song={song} />
      <div className="p-3">
        <p className="truncate font-medium">{song.title}</p>
        {owner && <p className="truncate text-xs text-zinc-500">picked by {owner}</p>}
        <div className="mt-2 flex items-center justify-between">
          {revealed ? (
            <span className={`text-sm font-bold ${winner ? 'text-emerald-300' : 'text-zinc-500'}`}>
              {votes ?? 0} vote{votes === 1 ? '' : 's'} {winner && '· winner'}
            </span>
          ) : (
            <button onClick={onVote} disabled={disabled}
              className={`min-h-[36px] rounded-lg px-4 py-1.5 text-sm font-semibold transition disabled:opacity-40 ${
                selected ? 'bg-fuchsia-600 text-white' : 'bg-zinc-800 text-zinc-100 hover:bg-fuchsia-600 hover:text-white'
              }`}>
              {selected ? '✓ Voted' : `Vote ${side.toUpperCase()}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function SongPlayer({ song }: { song: PublicSubmission }) {
  // Audio-only pick with a finished rip → audio element; otherwise the YouTube embed.
  if (song.media_type === 'audio' && song.rip_status === 'ready' && song.audio_url) {
    return (
      <div className="flex h-32 items-center justify-center bg-gradient-to-br from-fuchsia-900/30 to-violet-900/20 p-4">
        <audio controls src={song.audio_url} className="w-full" />
      </div>
    );
  }
  if (song.youtube_id) {
    return (
      <div className="aspect-video w-full">
        <iframe
          className="h-full w-full" src={youTubeEmbed(song.youtube_id)}
          title={song.title} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }
  return <div className="flex h-32 items-center justify-center text-zinc-600">No preview</div>;
}

// Seconds remaining until `iso`, ticking each second while `active`.
function useCountdown(iso: string | null, active: boolean): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [active]);
  if (!iso) return null;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 1000));
}

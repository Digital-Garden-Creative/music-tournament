import { useEffect, useState } from 'react';
import { castVote, closeExpiredMatch, closeMatch, startRevote, startVoting } from '../../lib/api';
import { youTubeEmbed, youTubeThumb } from '../../lib/youtube';
import type { Match, PublicSubmission } from '../../lib/types';
import type { ReadyRoomState } from '../../lib/useRoom';
import YouTubeAudio from './YouTubeAudio';

type Slot = { key: 'A' | 'B' | 'C'; id: string | null; votes: number | null };

export default function MatchPanel({ match, subsById, state }: {
  match: Match; subsById: Map<string, PublicSubmission>; state: ReadyRoomState;
}) {
  const { session, room, players, owners, myPickIds, isPresenter } = state;
  const isHost = session.isHost;
  const myId = session.playerId;
  // In a live game the TV plays the songs; phones only show them, so nothing overlaps.
  const showPlayers = !room.live || isPresenter;

  const slots: Slot[] = [
    { key: 'A', id: match.song_a, votes: match.votes_a },
    { key: 'B', id: match.song_b, votes: match.votes_b },
    ...(match.size === 3 || match.song_c ? [{ key: 'C' as const, id: match.song_c, votes: match.votes_c }] : []),
  ];
  const candidates = slots.map((s) => s.id).filter((id): id is string => !!id && id !== match.excluded);

  const [choice, setChoice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset local highlight when the match or vote round changes.
  useEffect(() => { setChoice(null); setError(null); }, [match.id, match.vote_round]);

  const listening = match.status === 'listening';
  const open = match.status === 'open';
  const tie = match.status === 'discussion';
  const revealed = match.status === 'closed';

  const remaining = useCountdown(match.closes_at, open);
  const haveVoted = match.voted_player_ids.includes(myId);
  // With self-voting off the server rejects our vote here, so say so up front.
  const sittingOut = !room.params.allow_self_vote && candidates.some((id) => myPickIds.includes(id));
  const voterCount = match.eligible_voters ?? players.filter((p) => p.connected).length;

  // When the timer runs out, every client asks the server to close the match, so voting
  // doesn't stall if the organizer's tab is closed. Calls are staggered, and retried
  // because the server ignores them until its own clock says time is up.
  const expired = open && remaining === 0;
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
  const act = (p: Promise<unknown>) => { setError(null); p.catch((e: Error) => setError(e.message)); };

  const title = (id: string | null) => (id && subsById.get(id)?.title) || '?';
  const heading = listening ? '🎧 Listen up' : open ? 'Now voting' : tie ? '🤝 Tie — discuss!' : 'Result';

  let status: string | null = null;
  if (listening) {
    status = isHost ? 'Play the songs, then start the vote when everyone has heard them.'
      : room.live ? 'The songs are playing on the TV. Voting opens soon.'
      : 'Have a listen. Voting opens when the organizer is ready.';
  } else if (open) {
    const count = `${match.voted_player_ids.length}/${voterCount} voted`;
    status = isPresenter ? count
      : sittingOut ? `Your pick is in this match, so you sit this one out. ${count}`
      : haveVoted ? `✓ Vote locked in (tap a card to change). ${count}`
      : `Cast your vote. ${count}`;
  } else if (tie) {
    status = match.excluded
      ? `Too close to call. Re-vote between ${title(candidates[0])} and ${title(candidates[1])}; ${title(match.excluded)} is out.`
      : match.voted_player_ids.length === 0
        ? 'No votes came in. The organizer will reopen voting.'
        : 'Votes were even. The organizer will reopen voting.';
  } else if (revealed) {
    status = 'Match complete.';
  }

  return (
    <section className="mb-6 rounded-2xl border border-fuchsia-500/40 bg-zinc-900/60 p-5 shadow-lg shadow-fuchsia-950/20">
      <div className="sticky top-0 z-10 -mx-5 -mt-5 mb-4 flex items-center justify-between rounded-t-2xl bg-zinc-900/95 px-5 pt-5 pb-3 backdrop-blur">
        <h2 className={`font-semibold ${isPresenter ? 'text-2xl' : 'text-lg'}`}>{heading}</h2>
        {open && remaining !== null && (
          <span className={`rounded-full px-3 py-1 font-mono font-bold ${isPresenter ? 'text-xl' : 'text-sm'} ${
            remaining <= 10 ? 'bg-rose-500/20 text-rose-300' : 'bg-zinc-800 text-zinc-200'
          }`}>
            {remaining}s
          </span>
        )}
      </div>

      <div className={`grid grid-cols-1 gap-4 ${slots.length === 3 ? 'md:grid-cols-3' : 'sm:grid-cols-2'}`}>
        {slots.map((s) => (
          <SongChoice
            key={s.key}
            song={s.id ? subsById.get(s.id) : null}
            label={s.key}
            votes={s.votes}
            revealed={revealed}
            winner={!!match.winner && match.winner === s.id}
            out={!!s.id && s.id === match.excluded}
            owner={s.id ? owners[s.id] : undefined}
            selected={!!s.id && choice === s.id}
            canVote={!isPresenter}
            disabled={!open || sittingOut}
            showPlayer={showPlayers}
            large={isPresenter}
            onVote={() => s.id && vote(s.id)}
          />
        ))}
      </div>

      {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}

      <div className={`mt-4 flex flex-wrap items-center justify-between gap-3 text-zinc-400 ${isPresenter ? 'text-lg' : 'text-sm'}`}>
        <span>{status}</span>

        {isHost && (
          <div className="flex gap-2">
            {listening && (
              <button onClick={() => act(startVoting(session.hostToken!, match.id))}
                className="min-h-[40px] rounded-lg bg-fuchsia-600 px-4 py-2 font-semibold text-white transition hover:bg-fuchsia-500">
                Start voting →
              </button>
            )}
            {open && (
              <button onClick={() => act(closeMatch(session.hostToken!, match.id))}
                className="min-h-[36px] rounded-lg border border-zinc-700 px-3 py-1.5 text-zinc-200 transition hover:bg-zinc-800">
                Close now
              </button>
            )}
            {tie && (
              <button onClick={() => act(startRevote(session.hostToken!, match.id))}
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

function SongChoice({ song, label, votes, revealed, winner, out, owner, selected, canVote, disabled, showPlayer, large, onVote }: {
  song: PublicSubmission | null | undefined;
  label: string; votes: number | null; revealed: boolean; winner: boolean; out: boolean;
  owner: string | undefined; selected: boolean; canVote: boolean; disabled: boolean;
  showPlayer: boolean; large: boolean; onVote: () => void;
}) {
  if (!song) return <div className="rounded-xl border border-zinc-800 p-6 text-center text-zinc-600">TBD</div>;
  return (
    <div className={`overflow-hidden rounded-xl border transition ${
      winner ? 'border-emerald-500/60 ring-1 ring-emerald-500/40'
        : selected ? 'border-fuchsia-500/70'
        : 'border-zinc-800'
    } bg-zinc-950/60 ${out ? 'opacity-45' : ''}`}>
      {showPlayer ? <SongPlayer song={song} /> : <SongThumb song={song} />}
      <div className="p-3">
        <p className={`line-clamp-2 font-medium ${large ? 'text-xl' : ''}`} title={song.title}>{song.title}</p>
        {owner && <p className="truncate text-xs text-zinc-500">picked by {owner}</p>}
        <div className="mt-2 flex min-h-[36px] items-center justify-between">
          {out ? (
            <span className="text-sm text-zinc-500">Out of the re-vote</span>
          ) : revealed ? (
            <span className={`text-sm font-bold ${winner ? 'text-emerald-300' : 'text-zinc-500'}`}>
              {votes ?? 0} vote{votes === 1 ? '' : 's'} {winner && '· winner'}
            </span>
          ) : canVote ? (
            <button onClick={onVote} disabled={disabled}
              className={`min-h-[36px] rounded-lg px-4 py-1.5 text-sm font-semibold transition disabled:opacity-40 ${
                selected ? 'bg-fuchsia-600 text-white' : 'bg-zinc-800 text-zinc-100 hover:bg-fuchsia-600 hover:text-white'
              }`}>
              {selected ? '✓ Voted' : `Vote ${label}`}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SongPlayer({ song }: { song: PublicSubmission }) {
  if (!song.youtube_id) {
    return <div className="flex h-32 items-center justify-center text-zinc-600">No preview</div>;
  }
  if (song.media_type === 'audio') return <YouTubeAudio youtubeId={song.youtube_id} title={song.title} />;
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

// Phones in a live game: just the artwork, no playback.
function SongThumb({ song }: { song: PublicSubmission }) {
  if (!song.youtube_id) return null;
  return <img src={youTubeThumb(song.youtube_id)} alt="" className="aspect-video w-full object-cover opacity-80" />;
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

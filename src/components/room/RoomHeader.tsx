import { useState } from 'react';
import type { Player, Room, Session } from '../../lib/types';

const STATUS_LABEL: Record<string, string> = {
  lobby: 'Lobby',
  submitting: 'Picking songs',
  in_progress: 'Tournament live',
  complete: 'Complete',
};

export default function RoomHeader({ room, session, players }: {
  room: Room; session: Session; players: Player[];
}) {
  const connected = players.filter((p) => p.connected).length;
  return (
    <header className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 px-5 py-4">
      <div className="flex flex-wrap items-center gap-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-zinc-500">Room code</div>
          <div className="font-mono text-2xl font-bold tracking-[0.3em] text-fuchsia-400">
            {room.code}
          </div>
        </div>
        <span className="rounded-full border border-zinc-700 bg-zinc-800/60 px-3 py-1 text-xs font-medium text-zinc-300">
          {STATUS_LABEL[room.status] ?? room.status}
        </span>
        {room.status !== 'complete' && <InviteButton code={room.code} />}
      </div>
      <div className="flex items-center gap-3 text-sm text-zinc-400">
        {session.isHost && (
          <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-400">
            ★ Organizer
          </span>
        )}
        <span>{connected}/{players.length} online</span>
      </div>
    </header>
  );
}

// Shares (phones) or copies (desktop) a link that opens straight onto the join form.
function InviteButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  async function invite() {
    const url = `${window.location.origin}/room?code=${code}`;
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ title: 'Song Tournament', text: `Join room ${code}`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* share sheet dismissed or clipboard blocked */ }
  }
  return (
    <button onClick={invite}
      className="min-h-[34px] rounded-full border border-fuchsia-500/40 px-3 py-1 text-xs font-semibold text-fuchsia-300 transition hover:bg-fuchsia-500/10">
      {copied ? '✓ Link copied' : 'Invite link'}
    </button>
  );
}

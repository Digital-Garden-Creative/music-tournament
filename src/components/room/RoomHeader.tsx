import type { Player, Room, Session } from '../../lib/types';

const STATUS_LABEL: Record<string, string> = {
  lobby: 'Lobby',
  submitting: 'Picking songs',
  seeding: 'Seeding',
  in_progress: 'Tournament live',
  complete: 'Complete',
};

export default function RoomHeader({ room, session, players }: {
  room: Room; session: Session; players: Player[];
}) {
  const connected = players.filter((p) => p.connected).length;
  return (
    <header className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 px-5 py-4">
      <div className="flex items-center gap-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-zinc-500">Room code</div>
          <div className="font-mono text-2xl font-bold tracking-[0.3em] text-fuchsia-400">
            {room.code}
          </div>
        </div>
        <span className="rounded-full border border-zinc-700 bg-zinc-800/60 px-3 py-1 text-xs font-medium text-zinc-300">
          {STATUS_LABEL[room.status] ?? room.status}
        </span>
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

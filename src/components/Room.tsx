import { useRoom } from '../lib/useRoom';
import Lobby from './room/Lobby';
import Submit from './room/Submit';
import Bracket from './room/Bracket';
import Complete from './room/Complete';
import RoomHeader from './room/RoomHeader';

export default function Room() {
  const state = useRoom();
  const { session, room, loading, error } = state;

  if (loading) {
    return <Centered><p className="text-zinc-400">Loading room…</p></Centered>;
  }
  if (error || !session || !room) {
    return (
      <Centered>
        <p className="mb-4 text-rose-400">{error ?? 'Something went wrong.'}</p>
        <a href="/" className="rounded-lg bg-fuchsia-600 px-4 py-2 font-semibold text-white hover:bg-fuchsia-500">
          Back home
        </a>
      </Centered>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <RoomHeader room={room} session={session} players={state.players} />
      {room.status === 'lobby' && <Lobby {...state} />}
      {room.status === 'submitting' && <Submit {...state} />}
      {(room.status === 'seeding' || room.status === 'in_progress') && <Bracket {...state} />}
      {room.status === 'complete' && <Complete {...state} />}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      {children}
    </div>
  );
}

import { setStatus } from '../../lib/api';
import type { ReadyRoomState, RoomState } from '../../lib/useRoom';
import QrCode from './QrCode';
import { Field, LiveSettings, NumberInput, RulesList, useParamEditor } from './settings';

export default function Lobby({ session, room, players, isPresenter }: ReadyRoomState) {
  const isHost = session.isHost;
  const { params, save, flush, saving, error, setError } = useParamEditor(session, room);

  async function openSubmissions() {
    setError(null);
    try {
      await flush();
      await setStatus(session.hostToken!, 'submitting');
    } catch (err) { setError((err as Error).message); }
  }

  return (
    <>
    {isPresenter && <JoinPanel code={room.code} />}
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_280px]">
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
        <h2 className="text-lg font-semibold">Tournament settings</h2>
        {isHost ? (
          <div className="mt-4 flex flex-col gap-5">
            <Field label="Theme / parameters">
              <input
                value={params.theme}
                onChange={(e) => save('theme', e.target.value)}
                placeholder="e.g. Best cover of a 90s song"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 outline-none focus:border-fuchsia-500"
              />
            </Field>
            <Field label="Songs per player">
              <NumberInput value={params.songs_per_player} min={1} max={8}
                onChange={(v) => save('songs_per_player', v)} />
            </Field>
            <LiveSettings params={params} save={save} />
            {!params.allow_self_vote && players.length <= 3 && (
              <p className="-mt-2 text-xs text-amber-400/80">
                With 3 or fewer players, a match can end up with nobody allowed to vote.
              </p>
            )}
            <p className="-mt-1 text-xs text-zinc-500">
              Everything except songs per player can be changed during the tournament too.
            </p>

            <button
              onClick={openSubmissions}
              className="mt-2 rounded-xl bg-fuchsia-600 px-4 py-3 font-semibold text-white transition hover:bg-fuchsia-500"
            >
              Open submissions →
            </button>
            {saving && <p className="text-xs text-zinc-500">Saving…</p>}
            {error && <p className="text-sm text-rose-400">{error}</p>}
          </div>
        ) : (
          <div className="mt-4 text-sm text-zinc-300">
            <p className="mb-2"><span className="text-zinc-500">Theme:</span> {room.params.theme || '—'}</p>
            <RulesList params={room.params} />
            {room.live && (
              <p className="pt-3 text-sky-300">📺 Songs play on the TV. Your phone is for picking and voting.</p>
            )}
            <p className="pt-3 text-zinc-500">Waiting for the organizer to open submissions…</p>
          </div>
        )}
      </section>

      <PlayerList players={players} />
    </div>
    </>
  );
}

// On the TV: the room code and a QR code, big enough to read across the room.
function JoinPanel({ code }: { code: string }) {
  const url = `${window.location.origin}/room?code=${code}`;
  return (
    <section className="mb-6 flex flex-col items-center gap-6 rounded-2xl border border-sky-500/30 bg-sky-500/5 p-6 sm:flex-row sm:justify-center sm:gap-10">
      <QrCode text={url} label={`QR code to join room ${code}`} className="h-44 w-44 rounded-xl sm:h-56 sm:w-56" />
      <div className="text-center sm:text-left">
        <p className="text-sm font-semibold uppercase tracking-widest text-zinc-400">Join on your phone</p>
        <p className="font-mono text-6xl font-black tracking-[0.25em] text-fuchsia-400 sm:text-7xl">{code}</p>
        <p className="mt-3 text-zinc-400">
          Scan the code, or go to <span className="text-zinc-200">{window.location.host}</span> and enter it.
        </p>
      </div>
    </section>
  );
}

export function PlayerList({ players }: { players: RoomState['players'] }) {
  return (
    <aside className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">
        Players ({players.length})
      </h3>
      <ul className="space-y-2">
        {players.map((p) => (
          <li key={p.id} className="flex items-center gap-2 text-sm">
            <span className={`h-2 w-2 rounded-full ${p.connected ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
            <span className="text-zinc-200">{p.display_name}</span>
            {p.is_host && <span className="text-xs text-amber-400">★</span>}
          </li>
        ))}
      </ul>
    </aside>
  );
}

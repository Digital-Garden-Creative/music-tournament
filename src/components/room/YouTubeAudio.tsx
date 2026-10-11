import { useEffect, useRef, useState } from 'react';
import { youTubeThumb } from '../../lib/youtube';

// Plays a YouTube video's sound with the picture hidden ("Audio only" picks), so nothing
// has to be ripped. The real player sits underneath a blurred-thumbnail cover that lets taps
// fall through to it: phones (iOS especially) only start sound from a tap on the player
// itself. Our own play/pause button and seek bar below drive it through the IFrame API.

type YTPlayer = {
  playVideo(): void; pauseVideo(): void; seekTo(s: number, allowAhead: boolean): void;
  getCurrentTime(): number; getDuration(): number; destroy(): void;
};
type YTNamespace = {
  Player: new (el: HTMLElement, opts: Record<string, unknown>) => YTPlayer;
  PlayerState: { ENDED: number; PLAYING: number; PAUSED: number; BUFFERING: number };
};
declare global {
  interface Window { YT?: YTNamespace; onYouTubeIframeAPIReady?: () => void }
}

let apiPromise: Promise<YTNamespace> | null = null;
function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  apiPromise ??= new Promise((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { previous?.(); resolve(window.YT!); };
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
  });
  return apiPromise;
}

type PlayState = 'loading' | 'ready' | 'playing' | 'paused' | 'ended' | 'error';

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export default function YouTubeAudio({ youtubeId, title }: { youtubeId: string; title: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const [state, setState] = useState<PlayState>('loading');
  const [time, setTime] = useState({ cur: 0, dur: 0 });

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    loadYouTubeApi().then((YT) => {
      if (cancelled || !wrap.current) return;
      // YT.Player replaces the element it's given, so hand it a child React doesn't own.
      const el = document.createElement('div');
      wrap.current.appendChild(el);
      player.current = new YT.Player(el, {
        videoId: youtubeId,
        width: '100%',
        height: '100%',
        playerVars: { controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3, playsinline: 1, rel: 0 },
        events: {
          onReady: () => {
            setState('ready');
            setTime({ cur: 0, dur: player.current?.getDuration() ?? 0 });
          },
          onStateChange: (e: { data: number }) => {
            if (e.data === YT.PlayerState.PLAYING || e.data === YT.PlayerState.BUFFERING) setState('playing');
            else if (e.data === YT.PlayerState.PAUSED) setState('paused');
            else if (e.data === YT.PlayerState.ENDED) setState('ended');
          },
          onError: () => setState('error'),
        },
      });
    });
    return () => {
      cancelled = true;
      player.current?.destroy();
      player.current = null;
      if (wrap.current) wrap.current.innerHTML = '';
    };
  }, [youtubeId]);

  // Keep the seek bar moving while the song plays.
  useEffect(() => {
    if (state !== 'playing') return;
    const tick = () => {
      const p = player.current;
      if (p) setTime({ cur: p.getCurrentTime(), dur: p.getDuration() });
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [state]);

  const playing = state === 'playing';
  const toggle = () => {
    const p = player.current;
    if (!p) return;
    if (playing) p.pauseVideo(); else p.playVideo();
  };

  return (
    <div>
      <div className="relative aspect-video w-full overflow-hidden bg-black">
        <div ref={wrap} className="absolute inset-0" />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-cover bg-center"
          style={{ backgroundImage: `url(${youTubeThumb(youtubeId)})` }}>
          <div className="absolute inset-0 bg-zinc-950/75 backdrop-blur-md" />
          <div className="relative flex flex-col items-center gap-2 text-center">
            <span className={`grid h-14 w-14 place-items-center rounded-full text-xl text-white shadow-lg ${
              playing ? 'bg-fuchsia-600/90' : 'bg-fuchsia-600'
            }`} aria-hidden="true">
              {state === 'loading' ? '…' : playing ? '❚❚' : '▶'}
            </span>
            <span className="text-xs font-semibold uppercase tracking-wide text-zinc-300">
              {state === 'error' ? "Can't play this one" : playing ? '🎧 Playing' : '🎧 Audio only · tap to play'}
            </span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3 px-3 pt-2">
        <button type="button" onClick={toggle} disabled={state === 'loading' || state === 'error'}
          aria-label={playing ? `Pause ${title}` : `Play ${title}`}
          className="grid min-h-[36px] min-w-[36px] place-items-center rounded-lg bg-zinc-800 text-sm text-zinc-100 transition hover:bg-zinc-700 disabled:opacity-40">
          {playing ? '❚❚' : '▶'}
        </button>
        <input type="range" min={0} max={Math.max(1, Math.round(time.dur))} step={1}
          value={Math.min(Math.round(time.cur), Math.round(time.dur) || 0)}
          onChange={(e) => {
            const s = Number(e.target.value);
            player.current?.seekTo(s, true);
            setTime((t) => ({ ...t, cur: s }));
          }}
          disabled={!time.dur}
          aria-label={`Seek in ${title}`}
          className="h-1 min-w-0 flex-1 accent-fuchsia-500" />
        <span className="shrink-0 font-mono text-xs text-zinc-500">
          {clock(time.cur)} / {time.dur ? clock(time.dur) : '–:––'}
        </span>
      </div>
    </div>
  );
}

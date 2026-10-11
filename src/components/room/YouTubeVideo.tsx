import { useEffect, useRef } from 'react';
import { loadYouTubeApi, pauseOthers, registerPlayer } from '../../lib/youtubePlayer';
import type { YTPlayer } from '../../lib/youtubePlayer';

// A regular YouTube embed with its own controls, built through the IFrame API so starting it
// pauses any other song on the page.
export default function YouTubeVideo({ youtubeId, title }: { youtubeId: string; title: string }) {
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let player: YTPlayer | null = null;
    let unregister = () => {};
    loadYouTubeApi().then((YT) => {
      if (cancelled || !wrap.current) return;
      // YT.Player replaces the element it's given, so hand it a child React doesn't own.
      const el = document.createElement('div');
      wrap.current.appendChild(el);
      const p = new YT.Player(el, {
        videoId: youtubeId,
        width: '100%',
        height: '100%',
        playerVars: { playsinline: 1, rel: 0 },
        events: {
          onReady: () => {
            // the API builds the iframe; give it a name for screen readers
            const iframe = wrap.current?.querySelector('iframe');
            iframe?.setAttribute('title', title);
          },
          onStateChange: (e: { data: number }) => {
            if (e.data === YT.PlayerState.PLAYING) pauseOthers(p);
          },
        },
      });
      player = p;
      unregister = registerPlayer(p);
    });
    return () => {
      cancelled = true;
      unregister();
      player?.destroy();
      if (wrap.current) wrap.current.innerHTML = '';
    };
  }, [youtubeId, title]);

  return <div ref={wrap} className="aspect-video w-full bg-black [&_iframe]:h-full [&_iframe]:w-full" />;
}

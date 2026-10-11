// Shared YouTube IFrame API plumbing: loads the API once, and keeps every player on the page
// in one registry so starting a song pauses whatever else was playing (otherwise the TV, or
// anyone listening on a phone, hears two songs over each other).

export type YTPlayer = {
  playVideo(): void; pauseVideo(): void; seekTo(s: number, allowAhead: boolean): void;
  getCurrentTime(): number; getDuration(): number; destroy(): void;
};
export type YTNamespace = {
  Player: new (el: HTMLElement, opts: Record<string, unknown>) => YTPlayer;
  PlayerState: { ENDED: number; PLAYING: number; PAUSED: number; BUFFERING: number };
};
declare global {
  interface Window { YT?: YTNamespace; onYouTubeIframeAPIReady?: () => void }
}

let apiPromise: Promise<YTNamespace> | null = null;
export function loadYouTubeApi(): Promise<YTNamespace> {
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

const players = new Set<YTPlayer>();

export function registerPlayer(p: YTPlayer): () => void {
  players.add(p);
  return () => { players.delete(p); };
}

/** Pause every registered player except `current`. */
export function pauseOthers(current: YTPlayer): void {
  players.forEach((p) => {
    if (p === current) return;
    try { p.pauseVideo(); } catch { /* not ready yet */ }
  });
}

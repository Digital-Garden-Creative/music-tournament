// Extract a YouTube video id from the common URL shapes; null if it isn't a YouTube link.
export function parseYouTubeId(input: string): string | null {
  const url = input.trim();
  const patterns = [
    /(?:youtube\.com\/watch\?(?:.*&)?v=)([\w-]{11})/,
    /(?:youtu\.be\/)([\w-]{11})/,
    /(?:youtube\.com\/embed\/)([\w-]{11})/,
    /(?:youtube\.com\/shorts\/)([\w-]{11})/,
    /(?:music\.youtube\.com\/watch\?(?:.*&)?v=)([\w-]{11})/,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) return m[1];
  }
  // bare id
  if (/^[\w-]{11}$/.test(url)) return url;
  return null;
}

export function youTubeThumb(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

export function youTubeEmbed(id: string): string {
  return `https://www.youtube.com/embed/${id}`;
}

/**
 * A YouTube upload title tidied into a song label: drops bracketed extras like
 * "(Official Video Remastered 4K)" or "[Lyrics]" and uses an en dash between artist and song.
 */
export function cleanSongTitle(raw: string): string {
  const extras = /\s*[([][^)\]]*\b(official|video|audio|lyrics?|remaster(ed)?|4k|hd|hq|visuali[sz]er|mv)\b[^)\]]*[)\]]/gi;
  const cleaned = raw.replace(extras, '').replace(/\s+-\s+/, ' – ').replace(/\s{2,}/g, ' ').trim();
  return cleaned || raw.trim();
}

export type YouTubeCheck =
  | { ok: true; title: string }
  | { ok: false; reason: 'missing' | 'blocked' };

/**
 * Look a video up through YouTube's oEmbed endpoint (CORS-enabled, no key): its title, or
 * why it won't play here. 401/403 means the uploader disabled embedding; 400/404 means it's
 * private, deleted, or never existed. Returns null when the lookup itself fails, so a flaky
 * network never blocks a pick.
 */
export async function checkYouTube(id: string): Promise<YouTubeCheck | null> {
  const watch = `https://www.youtube.com/watch?v=${id}`;
  try {
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watch)}`);
    if (res.ok) return { ok: true, title: String((await res.json()).title ?? '') };
    if (res.status === 401 || res.status === 403) return { ok: false, reason: 'blocked' };
    if (res.status === 400 || res.status === 404) return { ok: false, reason: 'missing' };
    return null;
  } catch {
    return null;
  }
}

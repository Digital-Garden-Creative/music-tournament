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

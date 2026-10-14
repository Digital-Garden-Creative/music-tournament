// Shareable PNGs of a finished tournament, drawn on a canvas: the whole bracket, and a
// phone-shaped champion card with the final standings. YouTube thumbnails can be drawn
// because i.ytimg.com allows cross-origin reads.
import { roundName } from './bracket';
import { youTubeThumb } from './youtube';
import type { Match, PublicSubmission, Room } from './types';

export interface ExportData {
  room: Room;
  matches: Match[];
  subsById: Map<string, PublicSubmission>;
  owners: Record<string, string>;
  playerCount: number;
}

const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';
const C = {
  bg: '#09090b', card: '#18181b', border: '#27272a', text: '#e4e4e7', muted: '#71717a',
  dim: '#52525b', win: '#6ee7b7', winBg: 'rgba(16,185,129,0.12)', sky: '#7dd3fc', glow: 'rgba(56,189,248,0.7)',
  amber: '#fcd34d', amberSoft: 'rgba(252,211,77,0.75)', fuchsia: '#e879f9', line: '#3f3f46',
};

const font = (weight: number, size: number) => `${weight} ${size}px ${FONT}`;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Shortens `text` with an ellipsis until it fits in `max` pixels at the current font.
function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(text.slice(0, mid).trimEnd() + '…').width <= max) lo = mid; else hi = mid - 1;
  }
  return text.slice(0, lo).trimEnd() + '…';
}

// Word-wraps into at most `lines` lines, the last one ellipsized.
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number, lines: number): string[] {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < words.length; i++) {
    const next = cur ? `${cur} ${words[i]}` : words[i];
    if (ctx.measureText(next).width <= max || !cur) { cur = next; continue; }
    out.push(cur);
    cur = words[i];
    if (out.length === lines - 1) { cur = words.slice(i).join(' '); break; }
  }
  if (cur) out.push(cur);
  return out.slice(0, lines).map((l, i) => (i === lines - 1 ? fit(ctx, l, max) : l));
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// Draws `img` covering the box (like object-fit: cover), clipped to rounded corners.
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number, r: number) {
  // hqdefault thumbnails are 4:3 with black bars; crop to the 16:9 middle
  const sh = img.height * 0.75, sy = img.height * 0.125;
  const scale = Math.max(w / img.width, h / sh);
  const dw = img.width * scale, dh = sh * scale;
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  ctx.drawImage(img, 0, sy, img.width, sh, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
}

function canvas(w: number, h: number, scale: number) {
  const el = document.createElement('canvas');
  el.width = Math.round(w * scale);
  el.height = Math.round(h * scale);
  const ctx = el.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.textBaseline = 'middle';
  return { el, ctx };
}

function toBlob(el: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => el.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not draw the image'))), 'image/png'));
}

function glowTitle(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, align: CanvasTextAlign) {
  ctx.save();
  ctx.font = font(900, size);
  ctx.textAlign = align;
  ctx.fillStyle = C.sky;
  ctx.shadowColor = C.glow;
  ctx.shadowBlur = size * 0.5;
  ctx.fillText(text, x, y);
  ctx.shadowBlur = size * 0.2;
  ctx.fillText(text, x, y);
  ctx.restore();
}

const today = () => new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

function byRound(matches: Match[]) {
  const total = matches.reduce((n, m) => Math.max(n, m.round), 0);
  const rounds: Match[][] = [];
  for (let r = 1; r <= total; r++) rounds.push(matches.filter((m) => m.round === r).sort((a, b) => a.slot - b.slot));
  return rounds;
}

// ─────────────────────────────────────────────────────────── bracket ──

export async function drawBracket({ room, matches, subsById, owners }: ExportData): Promise<Blob> {
  const rounds = byRound(matches);
  const total = rounds.length;
  const final = rounds[total - 1]?.[0];
  const champion = final?.winner ? subsById.get(final.winner) : undefined;

  // rows get a second line for who picked each song, when that's known
  const named = Object.keys(owners).length > 0;
  const PAD = 56, COL = 340, GAP = 56, ROW = named ? 54 : 40, CARD_GAP = 18, HEAD = 150, CHAMP = 340;
  const cardH = (m: Match) => (m.size === 3 ? 3 : 2) * ROW + 26;

  // round 1 stacks top to bottom; every later match sits level with the middle of the
  // matches that feed it
  const centers = new Map<string, number>();
  let y = 0;
  rounds[0]?.forEach((m) => { centers.set(m.id, y + cardH(m) / 2); y += cardH(m) + CARD_GAP; });
  const bodyH = Math.max(y - CARD_GAP, 420);
  for (let r = 1; r < total; r++) {
    const prev = rounds[r - 1];
    const g = rounds[r].length;
    rounds[r].forEach((m) => {
      const feeders = prev.filter((p) => Math.min(Math.floor(p.slot / 2), g - 1) === m.slot);
      const cs = feeders.map((f) => centers.get(f.id)!);
      centers.set(m.id, cs.length ? (Math.min(...cs) + Math.max(...cs)) / 2 : bodyH / 2);
    });
  }

  const W = PAD * 2 + total * COL + total * GAP + CHAMP;
  const H = PAD + HEAD + bodyH + PAD + 30;
  const { el, ctx } = canvas(W, H, 2);

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0b0b12');
  bg.addColorStop(1, '#140a1a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  glowTitle(ctx, 'Song Tournament', PAD, PAD + 30, 52, 'left');
  ctx.font = font(500, 22);
  ctx.fillStyle = C.muted;
  ctx.textAlign = 'left';
  ctx.fillText(fit(ctx, room.params.theme || 'Bracket results', W - PAD * 2 - 360), PAD, PAD + 84);
  ctx.textAlign = 'right';
  ctx.fillText(`${today()} · Room ${room.code}`, W - PAD, PAD + 84);

  const top = PAD + HEAD;
  const colX = (r: number) => PAD + r * (COL + GAP);

  ctx.textAlign = 'left';
  rounds.forEach((_, r) => {
    ctx.font = font(700, 15);
    ctx.fillStyle = C.muted;
    ctx.fillText(roundName(r + 1, total, rounds[r].length).toUpperCase(), colX(r), top - 22);
  });

  // connectors first, so cards sit on top of them
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 2;
  for (let r = 1; r < total; r++) {
    const g = rounds[r].length;
    rounds[r - 1].forEach((p) => {
      const target = rounds[r].find((m) => m.slot === Math.min(Math.floor(p.slot / 2), g - 1));
      if (!target) return;
      const x1 = colX(r - 1) + COL, y1 = top + centers.get(p.id)!;
      const x2 = colX(r), y2 = top + centers.get(target.id)!;
      const mid = x1 + GAP / 2;
      ctx.beginPath();
      ctx.moveTo(x1, y1); ctx.lineTo(mid, y1); ctx.lineTo(mid, y2); ctx.lineTo(x2, y2);
      ctx.stroke();
    });
  }
  if (final) {
    const y1 = top + centers.get(final.id)!;
    ctx.beginPath();
    ctx.moveTo(colX(total - 1) + COL, y1); ctx.lineTo(colX(total), y1);
    ctx.stroke();
  }

  rounds.forEach((ms, r) => ms.forEach((m) => {
    const h = cardH(m);
    const x = colX(r), cy = top + centers.get(m.id)!, y0 = cy - h / 2;
    ctx.fillStyle = C.card;
    roundRect(ctx, x, y0, COL, h, 14);
    ctx.fill();
    ctx.strokeStyle = C.border;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    const rows = [
      { id: m.song_a, votes: m.votes_a },
      { id: m.song_b, votes: m.votes_b },
      ...(m.size === 3 ? [{ id: m.song_c, votes: m.votes_c }] : []),
    ];
    rows.forEach((row, i) => {
      const ry = y0 + 13 + i * ROW;
      const win = !!row.id && row.id === m.winner;
      const out = !!row.id && row.id === m.excluded;
      if (win) {
        ctx.fillStyle = C.winBg;
        ctx.fillRect(x + 1, ry, COL - 2, ROW);
      }
      if (i > 0) { ctx.fillStyle = C.border; ctx.fillRect(x + 12, ry, COL - 24, 1); }
      const s = row.id ? subsById.get(row.id) : undefined;
      const owner = row.id ? owners[row.id] : undefined;
      const votes = m.status === 'closed' && row.votes !== null ? String(row.votes) : '';
      ctx.textAlign = 'right';
      ctx.font = font(600, 15);
      ctx.fillStyle = C.muted;
      ctx.fillText(votes, x + COL - 14, ry + ROW / 2);
      const textMax = COL - 28 - (votes ? 30 : 0);
      const titleY = named ? ry + 19 : ry + ROW / 2;
      ctx.textAlign = 'left';
      ctx.font = font(win ? 700 : 500, 16);
      ctx.fillStyle = !s ? C.dim : win ? C.win : out ? C.dim : C.text;
      const label = fit(ctx, s?.title ?? 'TBD', textMax);
      ctx.fillText(label, x + 14, titleY);
      if (out) ctx.fillRect(x + 14, titleY, ctx.measureText(label).width, 1.5);
      if (owner) {
        ctx.font = font(400, 13);
        ctx.fillStyle = C.muted;
        ctx.fillText(fit(ctx, owner, textMax), x + 14, ry + 38);
      }
    });
    if (m.overridden) {
      ctx.font = font(700, 11);
      ctx.fillStyle = C.amberSoft;
      ctx.textAlign = 'right';
      ctx.fillText("HOST'S PICK", x + COL - 12, y0 + h - 7);
    }
  }));

  // the champion, at the end of the line
  if (final && champion) {
    const x = colX(total) + 10, cy = top + centers.get(final.id)!;
    const img = champion.youtube_id ? await loadImage(youTubeThumb(champion.youtube_id)) : null;
    const boxW = CHAMP - 20, imgH = img ? Math.round(boxW * 9 / 16) : 0;
    const boxH = 70 + imgH + 104;
    const y0 = cy - boxH / 2;
    ctx.fillStyle = 'rgba(245,158,11,0.10)';
    roundRect(ctx, x, y0, boxW, boxH, 18);
    ctx.fill();
    ctx.strokeStyle = 'rgba(245,158,11,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.font = font(400, 34);
    ctx.fillStyle = '#fff';  // emoji take the fill's transparency
    ctx.fillText('🏆', x + boxW / 2, y0 + 34);
    if (img) drawCover(ctx, img, x + 16, y0 + 62, boxW - 32, imgH - 8, 10);
    ctx.font = font(700, 13);
    ctx.fillStyle = C.amberSoft;
    ctx.fillText('CHAMPION', x + boxW / 2, y0 + 70 + imgH + 10);
    ctx.font = font(900, 22);
    ctx.fillStyle = C.amber;
    wrap(ctx, champion.title, boxW - 32, 2).forEach((l, i) => ctx.fillText(l, x + boxW / 2, y0 + 70 + imgH + 40 + i * 26));
    const owner = owners[champion.id];
    if (owner) {
      ctx.font = font(500, 15);
      ctx.fillStyle = C.text;
      ctx.fillText(fit(ctx, `picked by ${owner}`, boxW - 32), x + boxW / 2, y0 + boxH - 16);
    }
  }

  ctx.textAlign = 'left';
  ctx.font = font(500, 14);
  ctx.fillStyle = C.dim;
  ctx.fillText('song-tournament.netlify.app', PAD, H - PAD / 2 - 6);
  return toBlob(el);
}

// ─────────────────────────────────────────────────── champion card ──

interface Placing { id: string; label: string; place: number }

/** Every song ranked by how far it got: the champion, then the final's other songs by
 *  votes, then each earlier round's losers. */
export function standings(matches: Match[]): Placing[] {
  const rounds = byRound(matches);
  const total = rounds.length;
  const final = rounds[total - 1]?.[0];
  if (!final?.winner) return [];
  const out: Placing[] = [{ id: final.winner, label: 'Champion', place: 1 }];
  const finalOthers = [
    { id: final.song_a, v: final.votes_a }, { id: final.song_b, v: final.votes_b }, { id: final.song_c, v: final.votes_c },
  ].filter((x): x is { id: string; v: number | null } => !!x.id && x.id !== final.winner)
    .sort((a, b) => (b.v ?? -1) - (a.v ?? -1));
  finalOthers.forEach((x, i) => out.push({ id: x.id, label: i === 0 ? '2nd place' : '3rd place', place: 2 + i }));
  let place = out.length + 1;
  for (let r = total - 2; r >= 0; r--) {
    const losers = rounds[r].flatMap((m) =>
      [{ id: m.song_a, v: m.votes_a }, { id: m.song_b, v: m.votes_b }, { id: m.song_c, v: m.votes_c }]
        .filter((x): x is { id: string; v: number | null } => !!x.id && !!m.winner && x.id !== m.winner))
      .sort((a, b) => (b.v ?? -1) - (a.v ?? -1));
    losers.forEach((x) => out.push({ id: x.id, label: `Out in the ${roundName(r + 1, total, rounds[r].length).toLowerCase()}`, place }));
    place += losers.length;
  }
  return out;
}

export async function drawChampionCard({ room, matches, subsById, owners, playerCount }: ExportData): Promise<Blob> {
  const W = 1080, H = 1920, PAD = 80;
  const { el, ctx } = canvas(W, H, 1);
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0b0b12');
  bg.addColorStop(0.55, '#170b1f');
  bg.addColorStop(1, '#0b0b12');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const ranked = standings(matches);
  const champ = ranked[0] ? subsById.get(ranked[0].id) : undefined;

  glowTitle(ctx, 'Song Tournament', W / 2, 150, 84, 'center');
  ctx.textAlign = 'center';
  ctx.font = font(500, 34);
  ctx.fillStyle = C.muted;
  wrap(ctx, room.params.theme || 'Results', W - PAD * 2, 2).forEach((l, i) => ctx.fillText(l, W / 2, 240 + i * 42));

  let y = 340;
  ctx.font = font(400, 110);
  ctx.fillStyle = '#fff';
  ctx.fillText('🏆', W / 2, y + 60);
  y += 150;
  if (champ?.youtube_id) {
    const img = await loadImage(youTubeThumb(champ.youtube_id));
    if (img) {
      const iw = 760, ih = Math.round(iw * 9 / 16), ix = (W - iw) / 2;
      ctx.save();
      ctx.shadowColor = 'rgba(245,158,11,0.45)';
      ctx.shadowBlur = 60;
      ctx.fillStyle = '#000';
      roundRect(ctx, ix, y, iw, ih, 28);
      ctx.fill();
      ctx.restore();
      drawCover(ctx, img, ix, y, iw, ih, 28);
      ctx.strokeStyle = 'rgba(252,211,77,0.6)';
      ctx.lineWidth = 4;
      roundRect(ctx, ix, y, iw, ih, 28);
      ctx.stroke();
      y += ih + 56;
    }
  }
  ctx.font = font(800, 26);
  ctx.fillStyle = C.amberSoft;
  ctx.fillText('CHAMPION', W / 2, y);
  y += 64;
  ctx.font = font(900, 64);
  ctx.fillStyle = C.amber;
  const titleLines = wrap(ctx, champ?.title ?? '—', W - PAD * 2, 3);
  titleLines.forEach((l, i) => ctx.fillText(l, W / 2, y + i * 74));
  y += titleLines.length * 74;
  const champOwner = champ ? owners[champ.id] : undefined;
  if (champOwner) {
    ctx.font = font(500, 36);
    ctx.fillStyle = C.text;
    ctx.fillText(fit(ctx, `picked by ${champOwner}`, W - PAD * 2), W / 2, y + 6);
    y += 60;
  }

  // standings, as many as fit above the footer
  y += 24;
  ctx.fillStyle = C.border;
  ctx.fillRect(PAD, y, W - PAD * 2, 2);
  y += 50;
  ctx.textAlign = 'left';
  ctx.font = font(800, 26);
  ctx.fillStyle = C.muted;
  ctx.fillText('FINAL STANDINGS', PAD, y);
  y += 56;
  const ROW = 60, bottom = H - 130;
  const rest = ranked.slice(1);
  const fits = Math.max(0, Math.floor((bottom - y) / ROW));
  const shown = rest.length > fits ? rest.slice(0, Math.max(0, fits - 1)) : rest;
  shown.forEach((p) => {
    const s = subsById.get(p.id);
    const owner = owners[p.id];
    ctx.textAlign = 'left';
    ctx.font = font(800, 30);
    ctx.fillStyle = p.place === 2 ? '#e5e7eb' : p.place === 3 ? '#fdba74' : C.dim;
    ctx.fillText(`${p.place}`, PAD, y);
    const left = PAD + 70;
    ctx.font = font(400, 26);
    const ownerW = owner ? Math.min(260, ctx.measureText(owner).width) : 0;
    ctx.font = font(600, 32);
    ctx.fillStyle = C.text;
    ctx.fillText(fit(ctx, s?.title ?? '?', W - PAD - left - ownerW - 24), left, y);
    if (owner) {
      ctx.textAlign = 'right';
      ctx.font = font(400, 26);
      ctx.fillStyle = C.muted;
      ctx.fillText(fit(ctx, owner, 260), W - PAD, y);
    }
    y += ROW;
  });
  if (shown.length < rest.length) {
    ctx.textAlign = 'left';
    ctx.font = font(500, 28);
    ctx.fillStyle = C.dim;
    ctx.fillText(`+ ${rest.length - shown.length} more`, PAD + 70, y);
  }

  ctx.textAlign = 'center';
  ctx.font = font(500, 26);
  ctx.fillStyle = C.dim;
  const songs = ranked.length;
  ctx.fillText(`${today()} · ${songs} songs · ${playerCount} players · Room ${room.code}`, W / 2, H - 90);
  return toBlob(el);
}

/** Shares the image on phones (so it can go straight to a group chat), downloads elsewhere. */
export async function saveImage(blob: Blob, filename: string): Promise<void> {
  const file = new File([blob], filename, { type: 'image/png' });
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Song Tournament results' }); return; }
    catch (err) { if ((err as Error).name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

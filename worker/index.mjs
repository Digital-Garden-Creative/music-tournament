// Bracketbeat rip worker.
//
// Polls the rip_jobs queue, runs yt-dlp + ffmpeg to produce an MP3 for each audio-only
// pick, uploads it to the Supabase Storage `audio` bucket, and writes the public URL back
// onto the submission. Run this on the host's machine during the event:
//
//   cd worker && npm install && cp .env.example .env  (fill in values) && npm start
//
// Requires yt-dlp and ffmpeg on PATH (both already present via Homebrew).

import { createClient } from '@supabase/supabase-js';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import 'dotenv/config';

const execFileAsync = promisify(execFile);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const POLL_MS = Number(process.env.POLL_INTERVAL_MS ?? 4000);

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in worker/.env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

/** Atomically claim one pending job by flipping it to "processing". */
async function claimJob() {
  const { data: pending } = await supabase
    .from('rip_jobs')
    .select('id, submission_id, youtube_id')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1);
  if (!pending || pending.length === 0) return null;

  const job = pending[0];
  // Guard against two workers grabbing the same job.
  const { data: claimed } = await supabase
    .from('rip_jobs')
    .update({ status: 'processing', claimed_at: new Date().toISOString() })
    .eq('id', job.id)
    .eq('status', 'pending')
    .select('id, submission_id, youtube_id');
  if (!claimed || claimed.length === 0) return null;
  return claimed[0];
}

async function rip(youtubeId) {
  const dir = await mkdtemp(join(tmpdir(), 'bracketbeat-'));
  const out = join(dir, `${youtubeId}.%(ext)s`);
  const mp3 = join(dir, `${youtubeId}.mp3`);
  try {
    await execFileAsync('yt-dlp', [
      '-x', '--audio-format', 'mp3', '--audio-quality', '0',
      '--no-playlist', '-o', out,
      `https://www.youtube.com/watch?v=${youtubeId}`,
    ], { timeout: 5 * 60 * 1000 });
    const bytes = await readFile(mp3);
    return { bytes, cleanup: () => rm(dir, { recursive: true, force: true }) };
  } catch (err) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

async function processJob(job) {
  console.log(`▶ ripping ${job.youtube_id} (submission ${job.submission_id})`);
  await supabase.from('submissions')
    .update({ rip_status: 'processing' }).eq('id', job.submission_id);

  try {
    const { bytes, cleanup } = await rip(job.youtube_id);
    const path = `${job.submission_id}.mp3`;
    const { error: upErr } = await supabase.storage
      .from('audio')
      .upload(path, bytes, { contentType: 'audio/mpeg', upsert: true });
    await cleanup();
    if (upErr) throw upErr;

    const { data: pub } = supabase.storage.from('audio').getPublicUrl(path);
    await supabase.from('submissions')
      .update({ rip_status: 'ready', audio_url: pub.publicUrl, rip_error: null })
      .eq('id', job.submission_id);
    await supabase.from('rip_jobs').update({ status: 'ready' }).eq('id', job.id);
    console.log(`✓ done ${job.youtube_id}`);
  } catch (err) {
    const message = err?.message ?? String(err);
    console.error(`✗ failed ${job.youtube_id}: ${message}`);
    await supabase.from('submissions')
      .update({ rip_status: 'failed', rip_error: message }).eq('id', job.submission_id);
    await supabase.from('rip_jobs')
      .update({ status: 'failed', error: message }).eq('id', job.id);
  }
}

async function loop() {
  for (;;) {
    try {
      const job = await claimJob();
      if (job) { await processJob(job); continue; }
    } catch (err) {
      console.error('poll error:', err?.message ?? err);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

console.log(`Bracketbeat rip worker started — polling every ${POLL_MS}ms`);
loop();

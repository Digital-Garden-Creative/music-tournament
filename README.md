# 🎵 Song Tournament

Jackbox-style song tournament app. Everyone joins a room from their own device, submits
song picks within the organizer's parameters, and the group votes head-to-head through a
single-elimination bracket until one track is crowned champion.

## Features

- **Rooms** — host creates a room, players join with a 4-character code.
- **Roles** — the organizer (TO) sets parameters and drives the tournament, and can also
  play; everyone else submits picks and votes.
- **Picks** — paste a YouTube link per song. Default to a **video** embed (great for
  music-video competitions) or flag a pick **audio-only** to have it ripped to MP3 in the
  background by a local worker.
- **Seeding** — picks are shuffled into a single-elimination bracket (with byes for
  non-power-of-two counts), kept **anonymous** until the end.
- **Voting** — TO opens a match with a countdown timer; it closes early once everyone has
  voted. **Ties** drop into a discussion state, then the TO reopens voting (a clean re-vote).
- **Reveal** — at the end, every pick is de-anonymized so you see who chose what.

## Stack

- **Web:** Astro + React + Tailwind (deploy on Netlify).
- **Backend:** Supabase — Postgres, Realtime, Storage. All mutations go through
  token-validated `SECURITY DEFINER` RPCs; song ownership is hidden via a sanitized view.
- **Rip worker:** a small local Node service (`/worker`) using `yt-dlp` + `ffmpeg`.

## Setup

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Run the migrations in `supabase/migrations/` in order (SQL editor, or
   `supabase db push` with the CLI linked to your project).
3. Grab the project URL, the **anon** key, and the **service_role** key from
   Project Settings → API.

### 2. Web app

```bash
cp .env.example .env      # fill in PUBLIC_SUPABASE_URL + PUBLIC_SUPABASE_ANON_KEY
npm install
npm run dev               # http://localhost:4321
```

Deploy by pushing to a repo connected to Netlify (config in `netlify.toml`); set the two
`PUBLIC_*` env vars in the Netlify dashboard.

### 3. Rip worker (only needed for audio-only picks)

Runs on the host's machine. Requires `yt-dlp` and `ffmpeg` on PATH.

```bash
cd worker
cp .env.example .env      # fill in SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
npm install
npm start
```

It polls for audio-only submissions, rips them to MP3, uploads to the `audio` Storage
bucket, and writes the URL back. If a rip fails, the app falls back to the YouTube embed.

## How a tournament runs

1. **Host** creates a room → shares the code.
2. Players **join**; host sets the theme, songs-per-player, timer, and toggles, then opens
   submissions.
3. Everyone **submits** their picks (video or audio-only).
4. Host **seeds the bracket** → tournament goes live.
5. Host **opens each match**; players vote; results reveal; winners advance.
6. At the final, host **reveals** who picked what. 🏆

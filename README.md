# 🎵 Song Tournament

Jackbox-style song tournament app. Everyone joins a room from their own device, submits
song picks within the organizer's parameters, and the group votes them through a bracket
until one track is crowned champion.

## Features

- **Rooms**: a host creates a room and players join with a 4-character code, an invite
  link, or (in a live game) the QR code on the TV.
- **Two ways to play**:
  - **From phones**: the organizer plays too, and everyone listens and votes on their own
    device.
  - **Live on a TV**: the TV screen is a presenter. It runs the game and plays the songs,
    but never picks or votes. Players' phones show the songs and vote buttons without
    playing anything, so nothing overlaps the TV. The organizer joins from their own phone
    to play.
- **Picks**: paste a YouTube link per song. The title fills in from YouTube, and missing
  or embed-blocked videos are flagged before they're submitted. **Video** shows the video;
  **Audio only** plays the sound through a hidden YouTube player. The host can make the
  whole room audio only.
- **Bracket**: picks are shuffled so nobody's songs meet each other in round 1, and stay
  **anonymous** until the end. There are no byes: a round with an odd number of songs gets
  one three-way match (1v1v1), so any number of songs works.
- **Setting the draw**: until the first match opens, the host can reshuffle (with an
  animated shuffle on screen), arrange the songs by hand, or copy the draw out as a text
  list and paste an edited one back in.
- **Matches**:
  - **Listening first**: opening a match starts a listening stage. The organizer starts the
    vote (and its countdown) once everyone has heard the songs.
  - **Early close**: voting closes early once every player who's allowed to vote has
    voted, online or not (otherwise the timer closes it). With self-voting off, a match's
    submitters sit it out.
  - **Ties**: a tie goes to discussion and then a re-vote. In a three-way, if two songs tie
    for first, the re-vote is between just those two.
- **Host controls mid-game**: the host can change a decided match's winner (later matches
  it fed are reset and replayed), and change self-voting, anonymity, the vote timer and
  audio-only while the tournament runs.
- **Reveal**: at the end every pick is de-anonymized. With "anonymous picks" off, names
  show throughout. The results page draws a bracket image and a champion card to save or
  share.

## Stack

- **Web:** Astro + React + Tailwind (deploy on Netlify).
- **Backend:** Supabase (Postgres + Realtime). All mutations go through token-validated
  `SECURITY DEFINER` RPCs; song ownership is hidden via a sanitized view.

## Setup

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Run the migrations in `supabase/migrations/` in order (SQL editor, or
   `supabase db push` with the CLI linked to your project). Keep quote marks out of SQL
   comments: the SQL editor splits statements on them.
3. Grab the project URL and the **anon** (publishable) key from Project Settings → API.

### 2. Web app

```bash
cp .env.example .env      # fill in PUBLIC_SUPABASE_URL + PUBLIC_SUPABASE_ANON_KEY
npm install
npm run dev               # http://localhost:4321
```

Deploy by pushing to a repo connected to Netlify (config in `netlify.toml`); set the two
`PUBLIC_*` env vars in the Netlify dashboard.

## How a tournament runs

1. **Host** creates a room, either from a phone or on a TV, and shares the code, invite
   link or QR code.
2. Players **join**; the host sets the theme, songs-per-player, timer and toggles, then
   opens submissions.
3. Everyone **submits** their picks.
4. Host **seeds the bracket**, and the tournament goes live. Until the first match opens,
   the host can redo the draw.
5. For each match the host opens it, everyone **listens**, the host **starts voting**, and
   the winner advances.
6. After the final, the host **reveals** who picked what. 🏆

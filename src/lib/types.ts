export type RoomStatus = 'lobby' | 'submitting' | 'in_progress' | 'complete';
export type MediaType = 'video' | 'audio';
export type MatchStatus = 'pending' | 'listening' | 'open' | 'discussion' | 'closed';

export interface RoomParams {
  songs_per_player: number;
  theme: string;
  vote_timer_seconds: number;
  allow_self_vote: boolean;
  anonymous: boolean;
}

export interface Room {
  id: string;
  code: string;
  status: RoomStatus;
  params: RoomParams;
  revealed: boolean;
  /** Presented on a TV: the host seat is a non-voting presenter and phones don't play audio. */
  live: boolean;
}

export interface Player {
  id: string;
  room_id: string;
  display_name: string;
  is_host: boolean;
  /** The TV seat in a live room: runs the game, never submits or votes. */
  is_presenter: boolean;
  connected: boolean;
}

/** Safe, anonymized view of a submission (no player_id). */
export interface PublicSubmission {
  id: string;
  room_id: string;
  title: string;
  source_url: string;
  youtube_id: string | null;
  /** 'audio' picks play through a hidden YouTube player, so only the sound is heard. */
  media_type: MediaType;
}

/** A submitter's own pick (full detail). */
export interface MyPick extends PublicSubmission {
  player_id: string;
}

export interface Match {
  id: string;
  room_id: string;
  round: number;
  slot: number;
  /** 2 for a head-to-head, 3 for a three-way (rounds with an odd number of songs). */
  size: 2 | 3;
  song_a: string | null;
  song_b: string | null;
  song_c: string | null;
  /** In a three-way re-vote, the song that sat out after finishing behind two tied leaders. */
  excluded: string | null;
  winner: string | null;
  status: MatchStatus;
  vote_round: number;
  voted_player_ids: string[];
  /** Voters this round is waiting on plus those who already voted (set by the server). */
  eligible_voters: number | null;
  votes_a: number | null;
  votes_b: number | null;
  votes_c: number | null;
  opened_at: string | null;
  closes_at: string | null;
}

/** Local identity persisted in localStorage so a refresh keeps your seat. */
export interface Session {
  roomId: string;
  code: string;
  playerId: string;
  sessionToken: string;
  isHost: boolean;
  hostToken: string | null;
}

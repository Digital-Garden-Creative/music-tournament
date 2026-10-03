export type RoomStatus = 'lobby' | 'submitting' | 'in_progress' | 'complete';
export type MediaType = 'video' | 'audio';
export type RipStatus = 'none' | 'pending' | 'processing' | 'ready' | 'failed';
export type MatchStatus = 'pending' | 'open' | 'discussion' | 'closed';

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
}

export interface Player {
  id: string;
  room_id: string;
  display_name: string;
  is_host: boolean;
  connected: boolean;
}

/** Safe, anonymized view of a submission (no player_id). */
export interface PublicSubmission {
  id: string;
  room_id: string;
  title: string;
  source_url: string;
  youtube_id: string | null;
  media_type: MediaType;
  rip_status: RipStatus;
  audio_url: string | null;
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
  song_a: string | null;
  song_b: string | null;
  winner: string | null;
  status: MatchStatus;
  vote_round: number;
  voted_player_ids: string[];
  /** Voters this round is waiting on plus those who already voted (set by the server). */
  eligible_voters: number | null;
  votes_a: number | null;
  votes_b: number | null;
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

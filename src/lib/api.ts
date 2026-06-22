import { supabase } from './supabase';
import type { Match, MyPick, PublicSubmission, Room, Session } from './types';

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

interface CreateResult {
  room_id: string; code: string; player_id: string;
  session_token: string; host_token: string; is_host: boolean;
}
interface JoinResult {
  room_id: string; code: string; player_id: string;
  session_token: string; is_host: boolean;
}
interface ResumeResult {
  room_id: string; code: string; player_id: string;
  is_host: boolean; host_token: string | null;
}

export async function createRoom(hostName: string): Promise<Session> {
  const r = await rpc<CreateResult>('create_room', { p_host_name: hostName });
  return {
    roomId: r.room_id, code: r.code, playerId: r.player_id,
    sessionToken: r.session_token, isHost: true, hostToken: r.host_token,
  };
}

export async function joinRoom(code: string, name: string): Promise<Session> {
  const r = await rpc<JoinResult>('join_room', {
    p_code: code.toUpperCase(), p_display_name: name,
  });
  return {
    roomId: r.room_id, code: r.code, playerId: r.player_id,
    sessionToken: r.session_token, isHost: false, hostToken: null,
  };
}

export async function resumeSession(sessionToken: string): Promise<Session> {
  const r = await rpc<ResumeResult>('resume_session', { p_session_token: sessionToken });
  return {
    roomId: r.room_id, code: r.code, playerId: r.player_id,
    sessionToken, isHost: r.is_host, hostToken: r.host_token,
  };
}

export function heartbeat(sessionToken: string, connected = true): Promise<void> {
  return rpc('heartbeat', { p_session_token: sessionToken, p_connected: connected });
}

export function updateParams(hostToken: string, params: Record<string, unknown>): Promise<unknown> {
  return rpc('update_room_params', { p_host_token: hostToken, p_params: params });
}

export function setStatus(hostToken: string, status: string): Promise<void> {
  return rpc('set_room_status', { p_host_token: hostToken, p_status: status });
}

export function submitPick(
  sessionToken: string, title: string, sourceUrl: string,
  youtubeId: string | null, mediaType: string,
): Promise<unknown> {
  return rpc('submit_pick', {
    p_session_token: sessionToken, p_title: title, p_source_url: sourceUrl,
    p_youtube_id: youtubeId, p_media_type: mediaType,
  });
}

export function deletePick(sessionToken: string, submissionId: string): Promise<void> {
  return rpc('delete_pick', { p_session_token: sessionToken, p_submission_id: submissionId });
}

export async function myPicks(sessionToken: string): Promise<MyPick[]> {
  return rpc<MyPick[]>('my_picks', { p_session_token: sessionToken });
}

export function seedBracket(hostToken: string): Promise<void> {
  return rpc('seed_bracket', { p_host_token: hostToken });
}

export function openMatch(hostToken: string, matchId: string): Promise<void> {
  return rpc('open_match', { p_host_token: hostToken, p_match_id: matchId });
}

export function castVote(sessionToken: string, matchId: string, choice: string): Promise<void> {
  return rpc('cast_vote', {
    p_session_token: sessionToken, p_match_id: matchId, p_choice: choice,
  });
}

export function closeMatch(hostToken: string, matchId: string): Promise<void> {
  return rpc('close_match', { p_host_token: hostToken, p_match_id: matchId });
}

export function startRevote(hostToken: string, matchId: string): Promise<void> {
  return rpc('start_revote', { p_host_token: hostToken, p_match_id: matchId });
}

export function revealRoom(hostToken: string): Promise<void> {
  return rpc('reveal_room', { p_host_token: hostToken });
}

export async function ownership(roomId: string): Promise<{ submission_id: string; display_name: string }[]> {
  return rpc('ownership', { p_room_id: roomId });
}

// ─── plain reads (RLS-guarded selects / views) ───

export async function getRoom(roomId: string): Promise<Room> {
  const { data, error } = await supabase
    .from('rooms').select('id, code, status, params, revealed').eq('id', roomId).single();
  if (error) throw new Error(error.message);
  return data as Room;
}

export async function getPlayers(roomId: string) {
  const { data, error } = await supabase
    .from('players').select('id, room_id, display_name, is_host, connected')
    .eq('room_id', roomId).order('joined_at');
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getSubmissions(roomId: string): Promise<PublicSubmission[]> {
  const { data, error } = await supabase
    .from('v_submissions_public').select('*').eq('room_id', roomId);
  if (error) throw new Error(error.message);
  return (data ?? []) as PublicSubmission[];
}

export async function getSubmissionCounts(roomId: string) {
  const { data, error } = await supabase
    .from('v_submission_counts').select('*').eq('room_id', roomId);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getMatches(roomId: string): Promise<Match[]> {
  const { data, error } = await supabase
    .from('matches').select('*').eq('room_id', roomId).order('round').order('slot');
  if (error) throw new Error(error.message);
  return (data ?? []) as Match[];
}

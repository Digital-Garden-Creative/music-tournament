import type { Session } from './types';

// Seats are remembered per room code, so a device can hold seats in several rooms. The
// current tab's seat also goes in sessionStorage: it wins over the device-wide one, which
// lets two tabs in one browser sit in the same room as different players.
const DEVICE_KEY = 'song-tournament-sessions';
const TAB_KEY = 'song-tournament-session';

function readDevice(): Record<string, Session> {
  try {
    return JSON.parse(localStorage.getItem(DEVICE_KEY) ?? '{}') as Record<string, Session>;
  } catch {
    return {};
  }
}

export function saveSession(s: Session): void {
  try {
    sessionStorage.setItem(TAB_KEY, JSON.stringify(s));
  } catch { /* storage unavailable */ }
  try {
    localStorage.setItem(DEVICE_KEY, JSON.stringify({ ...readDevice(), [s.code]: s }));
  } catch { /* storage unavailable */ }
}

export function loadSession(code: string): Session | null {
  try {
    const tab = JSON.parse(sessionStorage.getItem(TAB_KEY) ?? 'null') as Session | null;
    if (tab?.code === code) return tab;
  } catch { /* fall through */ }
  return readDevice()[code] ?? null;
}

export function clearSession(code: string): void {
  try {
    const tab = JSON.parse(sessionStorage.getItem(TAB_KEY) ?? 'null') as Session | null;
    if (tab?.code === code) sessionStorage.removeItem(TAB_KEY);
  } catch { /* ignore */ }
  try {
    const { [code]: _, ...rest } = readDevice();
    localStorage.setItem(DEVICE_KEY, JSON.stringify(rest));
  } catch { /* ignore */ }
}

import type { Session } from './types';

// Seats are remembered per room code, so a device can hold seats in several rooms. The
// current tab's seat also goes in sessionStorage: it wins over the device-wide one, which
// lets two tabs in one browser sit in the same room as different players.
const DEVICE_KEY = 'song-tournament-sessions';
const TAB_KEY = 'song-tournament-session';

type StoredSession = Session & { savedAt?: number };

function readDevice(): Record<string, StoredSession> {
  try {
    return JSON.parse(localStorage.getItem(DEVICE_KEY) ?? '{}') as Record<string, StoredSession>;
  } catch {
    return {};
  }
}

export function saveSession(s: Session): void {
  try {
    sessionStorage.setItem(TAB_KEY, JSON.stringify(s));
  } catch { /* storage unavailable */ }
  try {
    localStorage.setItem(DEVICE_KEY, JSON.stringify({ ...readDevice(), [s.code]: { ...s, savedAt: Date.now() } }));
  } catch { /* storage unavailable */ }
}

export function loadSession(code: string): Session | null {
  try {
    const tab = JSON.parse(sessionStorage.getItem(TAB_KEY) ?? 'null') as Session | null;
    if (tab?.code === code) return tab;
  } catch { /* fall through */ }
  return readDevice()[code] ?? null;
}

/** The seat this device used most recently, if it's from the last day (for "Rejoin"). */
export function latestSession(): Session | null {
  const recent = Object.values(readDevice())
    .filter((s) => (s.savedAt ?? 0) > Date.now() - 24 * 60 * 60 * 1000)
    .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
  return recent[0] ?? null;
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

// T21: what lets a guest that refreshes the page rejoin the same room. The room code goes in the URL (?room=CODE) and,
// with the match token, in sessionStorage (per tab, gone when the tab closes). Everything is in try/catch: private
// windows and blocked storage must never break the game.
import { SESSION_REJOIN_MS } from '../config';
import { normalizeRoomCode } from './roomCode';

const KEY = 'browser-football-session-v1';

export interface Session {
  code: string;
  /** The match token from `start` ('' while still in the lobby). */
  token: string;
  /** Date.now() when it was last saved. */
  at: number;
}

export function saveSession(code: string, token: string): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ code, token, at: Date.now() } satisfies Session));
  } catch {
    // No storage: a refresh just goes back through the invite flow.
  }
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}

/** The saved session for room `code`, if there is one that is recent enough to still be worth rejoining. */
export function loadSession(code: string, now: number = Date.now()): Session | null {
  try {
    const raw: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? 'null');
    if (typeof raw !== 'object' || raw === null) return null;
    const s = raw as Record<string, unknown>;
    if (typeof s.code !== 'string' || typeof s.token !== 'string' || typeof s.at !== 'number') return null;
    const saved = normalizeRoomCode(s.code);
    if (!saved || saved !== normalizeRoomCode(code) || now - s.at > SESSION_REJOIN_MS || s.token.length > 40) return null;
    return { code: s.code, token: s.token, at: s.at };
  } catch {
    return null;
  }
}

/** Puts `?room=CODE` in the address bar (or takes it out, with null) without reloading, so a refresh comes back here. */
export function setRoomInUrl(code: string | null): void {
  try {
    const url = new URL(window.location.href);
    if (code) url.searchParams.set('room', code);
    else url.searchParams.delete('room');
    window.history.replaceState(window.history.state, '', url);
  } catch {
    // Sandboxed frames and old browsers may refuse; not needed for anything else.
  }
}

// T21: the social side of online play. Player names, quick chat (presets, rate limit, the on-screen feed) and the
// running series score of a session. Pure: no DOM, no network, no storage (the callers pass the time in).
import { DEFAULT_PLAYER_NAME, EMOTE_BUBBLE_MS, EMOTE_FEED_LINES, EMOTE_FEED_MS, EMOTE_MAX_PER_WINDOW, EMOTE_MIN_GAP_MS, EMOTE_WINDOW_MS, NAME_MAX_LENGTH } from './config';
import type { TeamId } from './sim/types';

/* ---- Names ---------------------------------------------------------------------------------- */

/**
 * Makes a player name safe to show and send: only letters, digits, spaces and `_ - .` survive (so nothing can
 * look like markup, a command or a control character), runs of spaces collapse, and it is cut to NAME_MAX_LENGTH
 * characters. Anything (even a non-string) is accepted. May return '' (the caller picks a fallback).
 */
export function sanitizeName(raw: unknown, maxLength: number = NAME_MAX_LENGTH): string {
  if (typeof raw !== 'string') return '';
  // Letters (any script) and digits, plus the few separators; everything else, including emoji and controls, goes.
  const cleaned = raw.normalize('NFKC').replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} _.-]/gu, '').replace(/ +/g, ' ').trim();
  return Array.from(cleaned).slice(0, maxLength).join('').trim();
}

/** A name that is always usable: the sanitised one, else `fallback`. */
export function nameOr(raw: unknown, fallback: string = DEFAULT_PLAYER_NAME): string {
  return sanitizeName(raw) || fallback;
}

/** The guest's name, changed if it is the same as the host's (ignoring case): "Sam" -> "Sam 2". */
export function uniqueName(name: string, taken: string): string {
  if (name.toLowerCase() !== taken.toLowerCase()) return name;
  const suffix = ' 2';
  return Array.from(name).slice(0, Math.max(1, NAME_MAX_LENGTH - suffix.length)).join('') + suffix;
}

/* ---- Quick chat ----------------------------------------------------------------------------- */

/** The only messages there are (no free-text chat): number keys 1-6 send these. */
export const QUICK_CHAT: readonly string[] = ['Nice goal!', 'Unlucky', 'What a save!', 'Rematch?', '😂', 'GG'];

export const isEmoteId = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < QUICK_CHAT.length;

/** The quick-chat message a key (KeyboardEvent.code, "Digit1"…"Digit6" or the numpad) sends, or -1. */
export function emoteForKey(code: string): number {
  const m = /^(?:Digit|Numpad)([1-6])$/.exec(code);
  return m ? Number(m[1]) - 1 : -1;
}

/**
 * Allows a message unless it comes too soon after the last or too many have been sent lately. One per sender:
 * the sender uses it to stop itself, the receiver to ignore a modified client that doesn't.
 */
export class EmoteLimiter {
  private readonly sent: number[] = [];

  /** Records the message and returns true if it is allowed at time `now` (ms). */
  allow(now: number): boolean {
    while (this.sent.length && now - this.sent[0] > EMOTE_WINDOW_MS) this.sent.shift();
    const last = this.sent[this.sent.length - 1];
    if (last !== undefined && now - last < EMOTE_MIN_GAP_MS) return false;
    if (this.sent.length >= EMOTE_MAX_PER_WINDOW) return false;
    this.sent.push(now);
    return true;
  }

  reset(): void {
    this.sent.length = 0;
  }
}

export interface ChatItem {
  seq: number;
  /** Who said it: the host's or the guest's player. */
  from: 'host' | 'guest';
  emote: number;
  /** performance.now() when it was said. */
  at: number;
}

/** The recent quick-chat messages of a session, for the bubbles and the small feed. */
export class ChatFeed {
  private items: ChatItem[] = [];
  private seq = 0;

  push(from: 'host' | 'guest', emote: number, now: number): void {
    this.items.push({ seq: ++this.seq, from, emote, at: now });
    this.prune(now);
  }

  private prune(now: number): void {
    this.items = this.items.filter((i) => now - i.at <= EMOTE_FEED_MS).slice(-EMOTE_FEED_LINES * 2);
  }

  /** The newest message by `from` if it is still young enough to show as a bubble, else null. */
  bubble(from: 'host' | 'guest', now: number): ChatItem | null {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (it.from === from) return now - it.at <= EMOTE_BUBBLE_MS ? it : null;
    }
    return null;
  }

  /** The last few lines for the feed (oldest first). */
  feed(now: number): ChatItem[] {
    this.prune(now);
    return this.items.slice(-EMOTE_FEED_LINES);
  }

  clear(): void {
    this.items = [];
  }
}

/* ---- Series score ---------------------------------------------------------------------------- */

/** A session's running score, by player (not by team: the teams can be swapped between matches). */
export interface Series {
  host: number;
  guest: number;
  draws: number;
}

export const emptySeries = (): Series => ({ host: 0, guest: 0, draws: 0 });

export const seriesPlayed = (s: Series): number => s.host + s.guest + s.draws;

/**
 * The series after a match. `score` is by team, `hostTeam` the team the host played, and `shootoutWinner` the
 * winner of a penalty shoot-out after a draw (-1 or undefined: none, so it is a draw).
 */
export function seriesAfter(series: Series, hostTeam: TeamId, score: readonly [number, number], shootoutWinner: number | null | undefined = -1): Series {
  let winner: TeamId | -1 = score[0] > score[1] ? 0 : score[1] > score[0] ? 1 : -1;
  if (winner < 0 && (shootoutWinner === 0 || shootoutWinner === 1)) winner = shootoutWinner;
  if (winner < 0) return { ...series, draws: series.draws + 1 };
  return winner === hostTeam ? { ...series, host: series.host + 1 } : { ...series, guest: series.guest + 1 };
}

/**
 * "Series 3–2" from `mine`'s side (own count first; the draws, if any, in brackets), or '' before the first match.
 * With `names` ([mine, theirs]) it says whose is whose: "Series 3–2 (Kev – Sam)".
 */
export function seriesText(series: Series, mine: 'host' | 'guest', names?: readonly [string, string]): string {
  if (seriesPlayed(series) === 0) return '';
  const [a, b] = mine === 'host' ? [series.host, series.guest] : [series.guest, series.host];
  const who = names ? ` (${names[0]} – ${names[1]})` : '';
  return `Series ${a}–${b}${series.draws ? ` · ${series.draws} drawn` : ''}${who}`;
}

export const isSeries = (v: unknown): v is Series => {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  return [s.host, s.guest, s.draws].every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 9999);
};

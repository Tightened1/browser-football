// What MatchScene drives each frame: the host's authoritative match (also used offline) or the guest's replica.
import type { GameState, InputFrame, MatchStats } from '../sim/types';

/** A message covering the pitch: connection trouble, or why the match ended. */
export interface NetOverlay {
  title: string;
  body: string;
  /** The match is over for good (back to the menu is the only way on). */
  ended: boolean;
}

export interface MatchDriver {
  /** The state to draw (the host's real state, or the guest's interpolated copy). Read-only for callers. */
  readonly state: GameState;
  readonly online: boolean;
  /** Advance by `dt` seconds of real time; `sample` reads the local keyboard once per 60 Hz tick. */
  advance(dt: number, sample: () => InputFrame, nowMs: number): void;
  overlay(nowMs: number): NetOverlay | null;
  /** Lines for the network debug overlay. */
  debugLines(nowMs: number): string[];
  /** Offline: start a new match (online it only happens through an agreed rematch). */
  restart(): void;
  /** The match statistics once the match has ended (the guest gets them from the host at full time), else null. */
  stats(): MatchStats | null;
  /** Online: who wants a rematch; null offline. */
  rematch(): { mine: boolean; theirs: boolean } | null;
  setRematch(want: boolean): void;
}

export const seconds = (ms: number): number => Math.max(0, Math.ceil(ms / 1000));

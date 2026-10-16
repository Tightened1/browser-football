// Presentation helpers for the results screen (and the debug overlay). Pure.
import type { GameState, TeamId } from './sim/types';

export function formatTime(seconds: number): string {
  const s = Math.floor(seconds);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Possession as whole percentages that add up to 100 (50 / 50 if the ball was never touched). */
export function possessionPercent(possession: readonly [number, number]): [number, number] {
  const total = possession[0] + possession[1];
  if (total <= 0) return [50, 50];
  const home = Math.round((possession[0] / total) * 100);
  return [home, 100 - home];
}

const RESTART_NAMES = { kickoff: 'kickoff', 'throw-in': 'throw-in', 'goal-kick': 'goal kick', corner: 'corner', 'free-kick': 'free kick', penalty: 'penalty' } as const;

/**
 * Debug overlay line (T16): who touched the ball last -- team, shirt number and role -- and the restart waiting to be
 * taken, if any. `teamName` gives each team's display name.
 */
export function lastTouchText(state: GameState, teamName: (team: TeamId) => string): string {
  const t = state.lastTouch;
  const p = t ? state.players[t.player] : undefined;
  const who = t && p ? `${teamName(t.team)} #${p.number}${p.role === 'keeper' ? ' (GK)' : ''}` : 'nobody';
  const r = state.restart;
  return `last touch: ${who}${r ? `   restart: ${RESTART_NAMES[r.type]} to ${teamName(r.team)}` : ''}`;
}

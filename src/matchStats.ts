// Presentation helpers for the results screen (and the debug overlay). Pure.
import { MVP_POINTS } from './config';
import type { GameState, MatchStats, PlayerTally, TeamId } from './sim/types';

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

/** A player's man-of-the-match points: goals, assists, saves and tackles won (weights in MVP_POINTS), shots a little. */
export function mvpScore(t: PlayerTally): number {
  return t.goals * MVP_POINTS.goal + t.assists * MVP_POINTS.assist + t.saves * MVP_POINTS.save + t.tackles * MVP_POINTS.tackle + t.shots * MVP_POINTS.shot;
}

/**
 * The man of the match: the player with the most points. A tie goes to a player on the winning side (`winner`, if any),
 * then to the lower player id. Null if nobody did anything worth a point. `teamOf` says which team a player id is on.
 */
export function manOfTheMatch(stats: Pick<MatchStats, 'players'>, teamOf: (player: number) => TeamId, winner: TeamId | -1 = -1): { player: number; points: number } | null {
  let best: { player: number; points: number } | null = null;
  stats.players.forEach((t, player) => {
    const points = mvpScore(t);
    if (points <= 0) return;
    const better = !best || points > best.points || (points === best.points && winner >= 0 && teamOf(player) === winner && teamOf(best.player) !== winner);
    if (better) best = { player, points };
  });
  return best;
}

/** "2 goals · 1 assist · 3 saves · 4 tackles · 5 shots" (zeros left out; "no stats" when empty). */
export function tallyText(t: PlayerTally): string {
  const part = (n: number, one: string): string => (n ? `${n} ${one}${n === 1 ? '' : 's'}` : '');
  return [part(t.goals, 'goal'), part(t.assists, 'assist'), part(t.saves, 'save'), part(t.tackles, 'tackle'), part(t.shots, 'shot')].filter(Boolean).join(' · ') || 'no stats';
}

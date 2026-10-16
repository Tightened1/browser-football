// T21: per-player statistics (goals, assists, saves, tackles won, shots) for the results screen's man of the match
// and the human players' stat lines. Worked out by watching what changed between two ticks (`trackStats`), so none of
// the rules code has to know about it. Pure.
import { ASSIST_WINDOW, SIM_HZ } from '../config';
import type { GameState, PlayerTally, TeamId } from './types';

export const emptyTally = (): PlayerTally => ({ goals: 0, assists: 0, saves: 0, tackles: 0, shots: 0 });

/** Credits `what` to the player, and to their team's human too if that human was controlling them this tick. */
function credit(state: GameState, player: number, what: keyof PlayerTally): void {
  const p = state.players[player];
  const tally = state.stats.players[player];
  if (!p || !tally) return;
  tally[what] += 1;
  if (state.controlled[p.team] === player) state.stats.humans[p.team][what] += 1;
}

/**
 * Called once per tick with the state before (`prev`) and after (`next`) the step; updates `next.stats.players`,
 * `next.stats.humans` and `next.track`.
 *
 * - shot: the shot count of a team went up; the player who touched the ball last struck it (and it stays "live").
 * - save: a keeper touches the ball while an opponent's shot is live.
 * - tackle won: the ball carrier's touch is taken over by an opponent in open play.
 * - goal / assist: a goal was recorded; the scorer is the last toucher (not an own goal), and the assist goes to the
 *   toucher before them if on the same side and within ASSIST_WINDOW seconds (never from a penalty).
 */
export function trackStats(prev: GameState, next: GameState): void {
  const track = next.track;
  const touch = next.lastTouch;
  const changed = !!touch && (!prev.lastTouch || prev.lastTouch.player !== touch.player);
  const live = next.phase === 'playing';
  const carrier = prev.possession ? prev.possession.player : -1;

  if (changed && touch) {
    const before = prev.lastTouch;
    // A tackle won: the ball was on the carrier's feet (they touched it last) and now an opponent has it.
    if (live && prev.phase === 'playing' && before && before.player === carrier && before.team !== touch.team) credit(next, touch.player, 'tackles');
    const last = track.touches[track.touches.length - 1];
    if (!last || last.player !== touch.player) {
      track.touches.push({ team: touch.team, player: touch.player, tick: next.tick });
      if (track.touches.length > 2) track.touches.shift();
    }
  }

  if (next.stats.shots[0] + next.stats.shots[1] > prev.stats.shots[0] + prev.stats.shots[1] && touch) {
    credit(next, touch.player, 'shots');
    track.liveShot = { team: touch.team, player: touch.player };
  } else if (track.liveShot && changed && touch) {
    const keeper = next.players[touch.player]?.role === 'keeper';
    if (keeper && touch.team !== track.liveShot.team) credit(next, touch.player, 'saves');
    if (touch.player !== track.liveShot.player) track.liveShot = null;
  }
  if (!live) track.liveShot = null;

  if (next.stats.goals.length > prev.stats.goals.length) {
    const goal = next.stats.goals[next.stats.goals.length - 1];
    track.liveShot = null;
    if (!goal.ownGoal && goal.player >= 0) {
      credit(next, goal.player, 'goals');
      const [from, to] = [track.touches[track.touches.length - 2], track.touches[track.touches.length - 1]];
      const fresh = !!from && !!to && to.player === goal.player && next.tick - from.tick <= ASSIST_WINDOW * SIM_HZ;
      if (fresh && from.team === goal.team && from.player !== goal.player && !prev.penalty) credit(next, from.player, 'assists');
    }
    track.touches.length = 0;
  }
}

/** Sum of a tally's counters per team (the keeper's saves count for their side). */
export function teamTotals(players: readonly PlayerTally[], teamOf: (player: number) => TeamId): [PlayerTally, PlayerTally] {
  const out: [PlayerTally, PlayerTally] = [emptyTally(), emptyTally()];
  players.forEach((t, i) => {
    const team = teamOf(i);
    for (const k of Object.keys(t) as (keyof PlayerTally)[]) out[team][k] += t[k];
  });
  return out;
}

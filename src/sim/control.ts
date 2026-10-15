// Which player each human controls: switching and auto-switch on pass reception. Pure.
import { KICK_REACH, SWITCH_GOALSIDE_BIAS } from '../config';
import type { BallState, GameState, InputFrame, PlayerState, TeamId } from './types';

/** True if the player is close enough to the ball to kick or dribble it. */
export function hasBall(p: PlayerState, ball: BallState): boolean {
  return Math.hypot(ball.pos.x - p.pos.x, ball.pos.y - p.pos.y) <= p.radius + ball.radius + KICK_REACH;
}

/** True if the player carries the ball (sticky dribbling) or, with nobody carrying it, has it within reach. */
export function onBall(state: GameState, p: PlayerState): boolean {
  return state.possession ? state.possession.player === p.id : hasBall(p, state.ball);
}

/**
 * The teammate best placed to reach the ball: closest outfield player (excluding the current one), where
 * players between the ball and their own goal count as SWITCH_GOALSIDE_BIAS closer. Returns -1 if none.
 */
export function chooseSwitchTarget(state: GameState, team: TeamId): number {
  const current = state.controlled[team];
  const dir = state.attackDir[team];
  let best = -1;
  let bestScore = Infinity;
  for (const p of state.players) {
    if (p.team !== team || p.role === 'keeper' || p.id === current) continue;
    let score = Math.hypot(state.ball.pos.x - p.pos.x, state.ball.pos.y - p.pos.y);
    if ((p.pos.x - state.ball.pos.x) * dir < 0) score -= SWITCH_GOALSIDE_BIAS; // goal-side of the ball
    if (score < bestScore) {
      bestScore = score;
      best = p.id;
    }
  }
  return best;
}

/** Handles the switch button (on press only, and only when the controlled player is not on the ball). */
export function applySwitching(state: GameState, inputs: readonly (InputFrame | undefined)[]): void {
  for (const team of [0, 1] as const) {
    const input = inputs[team];
    const pressed = !!input?.switchPlayer && !state.prevSwitch[team];
    state.prevSwitch[team] = !!input?.switchPlayer;
    const cur = state.controlled[team];
    if (!pressed || cur < 0 || onBall(state, state.players[cur])) continue;
    const target = chooseSwitchTarget(state, team);
    if (target >= 0) state.controlled[team] = target;
  }
}

/**
 * Keeps the carrier as the last toucher, and moves each human's control to a teammate who receives
 * a pass (ball in reach, last touched by a different player of the same team) or, with sticky dribbling,
 * to whichever teammate is carrying the ball.
 */
export function updateTouches(state: GameState): void {
  const { ball } = state;
  const poss = state.possession;
  if (poss) {
    const carrier = state.players[poss.player];
    const team = carrier.team;
    if (state.controlled[team] >= 0 && carrier.role !== 'keeper') state.controlled[team] = carrier.id;
    state.lastTouch = { team, player: carrier.id };
    return;
  }
  for (const team of [0, 1] as const) {
    const cur = state.controlled[team];
    const last = state.lastTouch;
    if (cur < 0 || !last || last.team !== team || hasBall(state.players[cur], ball)) continue;
    let receiver = -1;
    let bestD = Infinity;
    for (const p of state.players) {
      if (p.team !== team || p.role === 'keeper' || p.id === cur || p.id === last.player) continue;
      if (!hasBall(p, ball)) continue;
      const d = Math.hypot(ball.pos.x - p.pos.x, ball.pos.y - p.pos.y);
      if (d < bestD) {
        bestD = d;
        receiver = p.id;
      }
    }
    if (receiver >= 0) state.controlled[team] = receiver;
  }
  // Being near the ball is not a touch (T16: a ball rolling out past an attacker was called theirs, so defenders'
  // balls behind became goal kicks). Only contacts, kicks, tackles and possession set lastTouch, in step().
}

// Goals, kickoff, out of play, timer, halves. Full rules come in T05.
import { GOAL_RESET_DELAY, PITCH_LEFT, PITCH_RIGHT } from '../config';
import { formationPosition, resetAiPlans } from './ai';
import type { GameState } from './types';

/**
 * Temporary until T05: once the whole ball has crossed a goal line, wait GOAL_RESET_DELAY seconds and then
 * reset everyone to the kickoff positions, so play (and AI vs AI) keeps going. No score is kept yet.
 */
export function updateGoalReset(state: GameState, dt: number): void {
  const { ball } = state;
  const inNet = ball.pos.x < PITCH_LEFT - ball.radius || ball.pos.x > PITCH_RIGHT + ball.radius;
  if (!inNet && state.goalTimer === 0) return;
  state.goalTimer += dt;
  if (state.goalTimer >= GOAL_RESET_DELAY) resetForKickoff(state);
}

/** Players back to formation, ball on the centre spot. */
export function resetForKickoff(state: GameState): void {
  for (const p of state.players) {
    p.pos = formationPosition(p.slot, state.attackDir[p.team]);
    p.vel = { x: 0, y: 0 };
    p.facing = state.attackDir[p.team] > 0 ? 0 : Math.PI;
    p.charge = 0;
    p.tackleTimer = 0;
    p.touchTimer = 0;
  }
  state.ball.pos = { x: (PITCH_LEFT + PITCH_RIGHT) / 2, y: formationPosition(0, 1).y };
  state.ball.vel = { x: 0, y: 0 };
  state.lastTouch = null;
  state.goalTimer = 0;
  resetAiPlans(state.ai);
}

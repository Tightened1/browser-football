// step(state, inputs, dt) -> state. The only way the game advances. Pure: returns a new state.
import {
  BALL_MAX_SPEED,
  BALL_RADIUS,
  DEBUG_KICK_MAX_SPEED,
  DEBUG_KICK_MIN_SPEED,
  DEBUG_KICK_SPEED_PER_PX,
  MAX_STEP_FRACTION,
  MAX_SUBSTEPS,
  PITCH_HEIGHT,
  PITCH_LEFT,
  PITCH_TOP,
  PITCH_WIDTH,
  WALL_TANGENT_KEEP,
} from '../config';
import { applyRollingFriction, capSpeed, collideWithBoundary, moveCircle, speedOf } from './physics';
import type { GameState, InputFrame, Vec2 } from './types';

export function createInitialState(): GameState {
  return {
    tick: 0,
    ball: {
      pos: { x: PITCH_LEFT + PITCH_WIDTH / 2, y: PITCH_TOP + PITCH_HEIGHT / 2 },
      vel: { x: 0, y: 0 },
      radius: BALL_RADIUS,
    },
    players: [],
  };
}

export function cloneState(s: GameState): GameState {
  return {
    tick: s.tick,
    ball: { pos: { ...s.ball.pos }, vel: { ...s.ball.vel }, radius: s.ball.radius },
    players: s.players.map((p) => ({ ...p, pos: { ...p.pos }, vel: { ...p.vel } })),
  };
}

/** Temporary debug: set the ball moving towards a target point; farther click = harder kick. */
function debugKick(state: GameState, target: Vec2): void {
  const dx = target.x - state.ball.pos.x;
  const dy = target.y - state.ball.pos.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-6) return;
  const speed = Math.min(DEBUG_KICK_MAX_SPEED, Math.max(DEBUG_KICK_MIN_SPEED, dist * DEBUG_KICK_SPEED_PER_PX));
  state.ball.vel.x = (dx / dist) * speed;
  state.ball.vel.y = (dy / dist) * speed;
}

export function step(state: GameState, inputs: readonly InputFrame[], dt: number): GameState {
  const next = cloneState(state);
  const ball = next.ball;

  for (const input of inputs) {
    if (input.kickTarget) debugKick(next, input.kickTarget);
  }

  applyRollingFriction(ball, dt);
  capSpeed(ball, BALL_MAX_SPEED);

  // Substep so a fast ball can never skip through a wall or post.
  const maxMove = ball.radius * MAX_STEP_FRACTION;
  const substeps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil((speedOf(ball.vel) * dt) / maxMove)));
  const subDt = dt / substeps;
  for (let i = 0; i < substeps; i++) {
    moveCircle(ball, subDt);
    collideWithBoundary(ball, undefined, WALL_TANGENT_KEEP);
  }

  next.tick = state.tick + 1;
  return next;
}

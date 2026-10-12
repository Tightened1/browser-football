// AI decisions -> InputFrames. T03: basic positioning only (formation shifted by the ball, simple keeper).
// T04 builds the real role/state-based AI on top of aiInput().
import {
  AI_ARRIVE_RADIUS,
  AI_DEADZONE,
  AI_EDGE_MARGIN,
  AI_MOVE_FACTOR,
  BALL_PULL_X,
  BALL_PULL_Y,
  FORMATION,
  KEEPER_ARRIVE_RADIUS,
  KEEPER_LINE_OFFSET,
  KEEPER_RANGE,
  PITCH_BOTTOM,
  PITCH_HEIGHT,
  PITCH_LEFT,
  PITCH_RIGHT,
  PITCH_TOP,
  PITCH_WIDTH,
} from '../config';
import type { GameState, InputFrame, PlayerState, Vec2 } from './types';

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** X of the goal line a team defends. */
export function ownGoalX(attackDir: number): number {
  return attackDir > 0 ? PITCH_LEFT : PITCH_RIGHT;
}

/** Formation spot for a slot (0 = keeper) for a team attacking in `attackDir`. */
export function formationPosition(slot: number, attackDir: number): Vec2 {
  const midY = PITCH_TOP + PITCH_HEIGHT / 2;
  if (slot === 0) return { x: ownGoalX(attackDir) + attackDir * KEEPER_LINE_OFFSET, y: midY };
  const f = FORMATION[slot - 1];
  return { x: ownGoalX(attackDir) + attackDir * f.fx * PITCH_WIDTH, y: PITCH_TOP + f.fy * PITCH_HEIGHT };
}

/** Where an idle outfield player wants to be: its formation spot, pulled part-way towards the ball. */
export function outfieldTarget(state: GameState, p: PlayerState): Vec2 {
  const home = formationPosition(p.slot, state.attackDir[p.team]);
  const { ball } = state;
  return {
    x: clamp(home.x + (ball.pos.x - home.x) * BALL_PULL_X, PITCH_LEFT + AI_EDGE_MARGIN, PITCH_RIGHT - AI_EDGE_MARGIN),
    y: clamp(home.y + (ball.pos.y - home.y) * BALL_PULL_Y, PITCH_TOP + AI_EDGE_MARGIN, PITCH_BOTTOM - AI_EDGE_MARGIN),
  };
}

/** Keeper stays on its line and tracks the ball side to side. */
export function keeperTarget(state: GameState, p: PlayerState): Vec2 {
  const home = formationPosition(0, state.attackDir[p.team]);
  return { x: home.x, y: home.y + clamp(state.ball.pos.y - home.y, -KEEPER_RANGE, KEEPER_RANGE) };
}

/** Proportional move towards a target: full speed far away, slowing to a stop on arrival. */
export function moveToward(p: PlayerState, target: Vec2, arriveRadius: number, maxMove = 1): InputFrame {
  const dx = target.x - p.pos.x;
  const dy = target.y - p.pos.y;
  const d = Math.hypot(dx, dy);
  const idle: InputFrame = { seq: 0, moveX: 0, moveY: 0, pass: false, shoot: false, tackle: false, switchPlayer: false };
  if (d < AI_DEADZONE) return idle;
  const k = (Math.min(1, d / arriveRadius) * maxMove) / d;
  return { ...idle, moveX: dx * k, moveY: dy * k };
}

/** The InputFrame an AI-driven player produces this tick. */
export function aiInput(state: GameState, p: PlayerState): InputFrame {
  if (p.role === 'keeper') return moveToward(p, keeperTarget(state, p), KEEPER_ARRIVE_RADIUS);
  return moveToward(p, outfieldTarget(state, p), AI_ARRIVE_RADIUS, AI_MOVE_FACTOR);
}

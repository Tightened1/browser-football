// Set pieces (T14): throw-ins are thrown, not dribbled; every restart is aimed into the pitch; auto-throw / auto-pass
// for a taker who does nothing; the grace period after a restart. Pure (shared by the sim, the AI and the renderer).
import {
  KICK_FLASH_TIME,
  KICK_TOUCH_LOCKOUT,
  PASS_SPEED,
  PITCH_BOTTOM,
  PITCH_LEFT,
  PITCH_RIGHT,
  PITCH_TOP,
  RESTART_GRACE_TIME,
  SHOT_MAX_CHARGE_TIME,
  SHOT_MAX_SPEED,
  THROW_AIM_EDGE,
  THROW_LONG_MAX_SPEED,
  THROW_LONG_MIN_SPEED,
  THROW_MARKED_DISTANCE,
  THROW_SHORT_SPEED,
} from '../config';
import { angleDiff } from './dribble';
import { kickSpeedForDistance } from './physics';
import type { GameState, InputFrame, PlayerState, Restart, RestartType, Vec2 } from './types';

const MID_X = (PITCH_LEFT + PITCH_RIGHT) / 2;
const MID_Y = (PITCH_TOP + PITCH_BOTTOM) / 2;

/** The throw-in waiting to be taken, if any (the ball is held on its spot until it is thrown). */
export function pendingThrowIn(state: GameState): Restart | null {
  return state.restart?.type === 'throw-in' ? state.restart : null;
}

/**
 * The direction into the pitch from a set piece's spot (unit vector), which its throw or kick is clamped around:
 * away from the touchline, out of the corner, or away from the goal. Null for a kickoff (aimed anywhere).
 */
export function inwardDirection(type: RestartType, pos: Vec2): Vec2 | null {
  const sx = pos.x < MID_X ? 1 : -1;
  const sy = pos.y < MID_Y ? 1 : -1;
  switch (type) {
    case 'throw-in':
      return { x: 0, y: sy };
    case 'corner':
      return { x: sx * Math.SQRT1_2, y: sy * Math.SQRT1_2 };
    case 'goal-kick':
      return { x: sx, y: 0 };
    case 'kickoff':
      return null;
  }
}

/**
 * `aim` (radians) kept in the half-circle facing `inward`, at least THROW_AIM_EDGE off the line itself. An aim out of
 * the pitch is mirrored back in across the line (straight out becomes straight in), then clamped.
 */
export function clampAim(aim: number, inward: Vec2 | null): number {
  if (!inward) return aim;
  const base = Math.atan2(inward.y, inward.x);
  const max = Math.PI / 2 - THROW_AIM_EDGE;
  let d = angleDiff(aim, base);
  if (Math.abs(d) > Math.PI / 2) d = Math.sign(d) * (Math.PI - Math.abs(d));
  return base + Math.max(-max, Math.min(max, d));
}

/** Where a set piece taker's throw/kick goes: the move keys (else the facing), clamped into the pitch. */
export function restartAim(r: Restart, input: Pick<InputFrame, 'moveX' | 'moveY'>, facing: number): number {
  const moving = Math.hypot(input.moveX, input.moveY) > 1e-6;
  return clampAim(moving ? Math.atan2(input.moveY, input.moveX) : facing, inwardDirection(r.type, r.pos));
}

/** Long throw speed for a charge (s), like a shot but shorter. */
export function throwSpeed(charge: number): number {
  const f = Math.min(1, Math.max(0, charge / SHOT_MAX_CHARGE_TIME));
  return THROW_LONG_MIN_SPEED + (THROW_LONG_MAX_SPEED - THROW_LONG_MIN_SPEED) * f;
}

/** The charge (s) that throws at `speed` (for the AI). */
export function throwChargeFor(speed: number): number {
  const f = (speed - THROW_LONG_MIN_SPEED) / (THROW_LONG_MAX_SPEED - THROW_LONG_MIN_SPEED);
  return Math.max(0.02, Math.min(1, f)) * SHOT_MAX_CHARGE_TIME;
}

/**
 * Who an automatic throw-in / pass goes to: the nearest teammate (outfield first) the throw can reach, preferring one
 * with no opponent within THROW_MARKED_DISTANCE. Aim is clamped into the pitch; speed suits the distance.
 */
export function restartTarget(state: GameState, r: Restart, taker: PlayerState): { aim: number; speed: number; receiver: number } {
  const ball = state.ball.pos;
  const inward = inwardDirection(r.type, r.pos);
  const throwing = r.type === 'throw-in';
  let best: PlayerState | null = null;
  let bestScore = Infinity;
  for (const t of state.players) {
    if (t.team !== taker.team || t.id === taker.id) continue;
    const d = Math.hypot(t.pos.x - ball.x, t.pos.y - ball.y);
    let marked = Infinity;
    for (const o of state.players) if (o.team !== taker.team) marked = Math.min(marked, Math.hypot(o.pos.x - t.pos.x, o.pos.y - t.pos.y));
    let score = d;
    if (marked < THROW_MARKED_DISTANCE) score += 1000;
    if (t.role === 'keeper') score += 2000;
    // Behind the line we throw from (can't be aimed at): last resort.
    if (inward && (t.pos.x - ball.x) * inward.x + (t.pos.y - ball.y) * inward.y <= 0) score += 4000;
    if (score < bestScore) {
      bestScore = score;
      best = t;
    }
  }
  const towards = best ? Math.atan2(best.pos.y - ball.y, best.pos.x - ball.x) : inward ? Math.atan2(inward.y, inward.x) : taker.facing;
  const d = best ? Math.hypot(best.pos.x - ball.x, best.pos.y - ball.y) : 150;
  const speed = throwing
    ? Math.max(THROW_SHORT_SPEED * 0.8, kickSpeedForDistance(d, undefined, THROW_LONG_MAX_SPEED))
    : Math.max(PASS_SPEED * 0.8, kickSpeedForDistance(d, undefined, SHOT_MAX_SPEED));
  return { aim: clampAim(towards, inward), speed, receiver: best ? best.id : -1 };
}

/** The restart is under way: it stops holding the opposition off, and its grace period starts. */
export function releaseRestart(state: GameState): void {
  const r = state.restart;
  if (!r) return;
  state.restart = null;
  state.grace = RESTART_GRACE_TIME > 0 ? { type: r.type, team: r.team, pos: { ...r.pos }, taker: r.taker, timer: RESTART_GRACE_TIME } : null;
}

/** The taker throws (or kicks) the set piece at `speed` towards `aim`, and the restart is released. */
export function playRestart(state: GameState, taker: PlayerState, speed: number, aim: number): void {
  const { ball } = state;
  state.possession = null;
  taker.facing = aim;
  taker.charge = 0;
  taker.kickQueue = 0;
  taker.touchTimer = KICK_TOUCH_LOCKOUT;
  taker.kickFlash = KICK_FLASH_TIME;
  ball.vel = { x: Math.cos(aim) * speed, y: Math.sin(aim) * speed };
  state.lastTouch = { team: taker.team, player: taker.id };
  releaseRestart(state);
}

/**
 * One tick of a throw-in taker: stands still with the ball held over their head, aims with the move keys (clamped into
 * the pitch) and throws on a pass press (short) or a shoot release (long, charged). Returns whether it was thrown.
 */
export function takeThrowIn(state: GameState, p: PlayerState, input: InputFrame, dt: number): boolean {
  const r = state.restart!;
  p.tackleCooldown = Math.max(0, p.tackleCooldown - dt);
  p.touchTimer = Math.max(0, p.touchTimer - dt);
  p.kickFlash = Math.max(0, p.kickFlash - dt);
  p.tackleTimer = 0;
  p.kickQueue = 0;
  p.vel = { x: 0, y: 0 };
  const aim = restartAim(r, input, p.facing);
  p.facing = aim;
  if (input.shoot) p.charge = Math.min(SHOT_MAX_CHARGE_TIME, p.charge + dt);
  const passPressed = input.pass && !p.prevPass;
  const shootReleased = !input.shoot && p.prevShoot;
  if (passPressed || shootReleased) {
    playRestart(state, p, passPressed ? THROW_SHORT_SPEED : throwSpeed(p.charge), aim);
    return true;
  }
  if (!input.shoot) p.charge = 0;
  return false;
}

/**
 * The restart's timer ran out with the ball still on its spot. A throw-in is thrown for the taker (a long throw if they
 * are charging one, else to the nearest unmarked teammate); a human's kick is passed to a teammate for them.
 * Returns false if it should just be released (an AI's kicked restart, as before T14).
 */
export function autoPlayRestart(state: GameState, humanTaker: boolean): boolean {
  const r = state.restart;
  if (!r || r.taker < 0) return false;
  const taker = state.players[r.taker];
  if (!taker) return false;
  if (r.type !== 'throw-in' && !humanTaker) return false;
  if (r.type === 'throw-in' && taker.charge > 0) {
    playRestart(state, taker, throwSpeed(taker.charge), taker.facing);
    return true;
  }
  const t = restartTarget(state, r, taker);
  playRestart(state, taker, t.speed, t.aim);
  return true;
}

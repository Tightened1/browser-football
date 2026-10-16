// Set pieces (T14): throw-ins are thrown, not dribbled (and corners crossed from a standing start, T16, free kicks and
// penalties kicked from it, T19); every restart is aimed into the pitch (a penalty at the goal); auto-throw / auto-pass
// for a taker who does nothing; the grace period after a restart. Pure (shared by the sim, the AI and the renderer).
import {
  CORNER_HARD_MAX_SPEED,
  CORNER_HARD_MIN_SPEED,
  CORNER_LOW_SPEED,
  KICK_FLASH_TIME,
  KICK_TOUCH_LOCKOUT,
  PASS_SPEED,
  PENALTY_AIM_INSET,
  PENALTY_PLACED_INSET,
  PENALTY_PLACED_SPEED,
  PENALTY_BOX_HEIGHT,
  PENALTY_BOX_WIDTH,
  PENALTY_SPOT_DISTANCE,
  PITCH_BOTTOM,
  PITCH_LEFT,
  PITCH_RIGHT,
  PITCH_TOP,
  RESTART_GRACE_TIME,
  SHOT_MAX_CHARGE_TIME,
  SHOT_MAX_SPEED,
  SHOT_MIN_SPEED,
  THROW_AIM_EDGE,
  THROW_LONG_MAX_SPEED,
  THROW_LONG_MIN_SPEED,
  THROW_MARKED_DISTANCE,
  THROW_SHORT_SPEED,
} from '../config';
import { angleDiff } from './dribble';
import { kickSpeedForDistance } from './physics';
import { assistAim } from './shooting';
import type { GameState, InputFrame, PlayerState, Restart, RestartType, Vec2 } from './types';

const MID_X = (PITCH_LEFT + PITCH_RIGHT) / 2;
const MID_Y = (PITCH_TOP + PITCH_BOTTOM) / 2;

/** The throw-in waiting to be taken, if any (the ball is held on its spot until it is thrown). */
export function pendingThrowIn(state: GameState): Restart | null {
  return state.restart?.type === 'throw-in' ? state.restart : null;
}

/** Set pieces whose ball stays on its spot until the taker plays it: see pendingHeldRestart. */
export function isHeldType(type: RestartType): boolean {
  return type === 'throw-in' || type === 'corner' || type === 'free-kick' || type === 'penalty';
}

/**
 * A set piece whose ball stays on its spot until the taker plays it (no dribbling it, nobody else can move it): a
 * throw-in, a corner (T16: aimed with the arrow and crossed, low or hard), a free kick or a penalty (T19).
 */
export function pendingHeldRestart(state: GameState): Restart | null {
  const r = state.restart;
  return r && isHeldType(r.type) ? r : null;
}

/** The penalty waiting to be taken, if any. */
export function pendingPenalty(state: GameState): Restart | null {
  return state.restart?.type === 'penalty' ? state.restart : null;
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
    case 'penalty':
      return { x: -sx, y: 0 }; // at the goal it is taken at
    case 'kickoff':
    case 'free-kick':
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

/**
 * A penalty's aim (T19): left, centre or right of the goal it is taken at, from the part of the move keys across the
 * goal (else from the facing, which keeps the last aim). A placed kick (pass) goes PENALTY_PLACED_INSET px inside the
 * post, a power kick (shoot) PENALTY_AIM_INSET px.
 */
export function penaltyAim(r: Pick<Restart, 'pos'>, input: Pick<InputFrame, 'moveX' | 'moveY'>, facing: number, goalWidth: number, placed = false): number {
  const goalX = r.pos.x < MID_X ? PITCH_LEFT : PITCH_RIGHT;
  const ml = Math.hypot(input.moveX, input.moveY);
  const across = ml > 1e-6 ? input.moveY / ml : Math.sin(facing);
  const side = across > 0.3 ? 1 : across < -0.3 ? -1 : 0;
  const y = MID_Y + side * (goalWidth / 2 - (placed ? PENALTY_PLACED_INSET : PENALTY_AIM_INSET));
  return Math.atan2(y - r.pos.y, goalX - r.pos.x);
}

/** Where a held set piece's taker is aiming: a penalty at the goal (penaltyAim), anything else as restartAim. */
export function heldAim(state: GameState, r: Restart, input: Pick<InputFrame, 'moveX' | 'moveY'>, facing: number, placed = false): number {
  return r.type === 'penalty' ? penaltyAim(r, input, facing, state.rules.goalWidth, placed) : restartAim(r, input, facing);
}

/** A held set piece's speeds: [short (pass), charged min, charged max] -- throw-ins thrown, corners crossed, free kicks and penalties kicked. */
function heldSpeeds(type: RestartType): [number, number, number] {
  if (type === 'corner') return [CORNER_LOW_SPEED, CORNER_HARD_MIN_SPEED, CORNER_HARD_MAX_SPEED];
  if (type === 'free-kick') return [PASS_SPEED, SHOT_MIN_SPEED, SHOT_MAX_SPEED];
  if (type === 'penalty') return [PENALTY_PLACED_SPEED, SHOT_MIN_SPEED, SHOT_MAX_SPEED];
  return [THROW_SHORT_SPEED, THROW_LONG_MIN_SPEED, THROW_LONG_MAX_SPEED];
}

/** How long a held set piece's charge takes to fill: a shot's (the rules') for free kicks and penalties, else SHOT_MAX_CHARGE_TIME. */
export function heldChargeTime(state: GameState, type: RestartType): number {
  return type === 'free-kick' || type === 'penalty' ? state.rules.shotChargeTime : SHOT_MAX_CHARGE_TIME;
}

/** The pass-button (short throw / low cross) speed of a held set piece. */
export function heldShortSpeed(type: RestartType = 'throw-in'): number {
  return heldSpeeds(type)[0];
}

/** Long throw (or hard cross, for a corner; a shot for a free kick or penalty) speed for a charge (s) out of `chargeTime`. */
export function throwSpeed(charge: number, type: RestartType = 'throw-in', chargeTime = SHOT_MAX_CHARGE_TIME): number {
  const [, lo, hi] = heldSpeeds(type);
  const f = Math.min(1, Math.max(0, charge / chargeTime));
  return lo + (hi - lo) * f;
}

/** The charge (s) that throws (or crosses, or shoots) at `speed` (for the AI). */
export function throwChargeFor(speed: number, type: RestartType = 'throw-in', chargeTime = SHOT_MAX_CHARGE_TIME): number {
  const [, lo, hi] = heldSpeeds(type);
  const f = (speed - lo) / (hi - lo);
  return Math.max(0.02, Math.min(1, f)) * chargeTime;
}

/**
 * Where a corner is crossed to: the most open teammate in the box (the one furthest from an opponent, nearer the
 * penalty spot breaking ties), else the penalty spot. Speed suits the distance, between a low and a hard cross.
 */
export function cornerTarget(state: GameState, r: Restart, taker: PlayerState): { aim: number; speed: number; receiver: number; to: Vec2 } {
  const ball = state.ball.pos;
  const goalX = r.pos.x < MID_X ? PITCH_LEFT : PITCH_RIGHT;
  const inX = goalX === PITCH_LEFT ? 1 : -1;
  const spot = { x: goalX + inX * PENALTY_SPOT_DISTANCE, y: MID_Y };
  let best: PlayerState | null = null;
  let bestScore = -Infinity;
  for (const t of state.players) {
    if (t.team !== taker.team || t.id === taker.id || t.role === 'keeper') continue;
    if (Math.abs(t.pos.x - goalX) > PENALTY_BOX_WIDTH || Math.abs(t.pos.y - MID_Y) > PENALTY_BOX_HEIGHT / 2) continue;
    let marked = Infinity;
    for (const o of state.players) if (o.team !== taker.team) marked = Math.min(marked, Math.hypot(o.pos.x - t.pos.x, o.pos.y - t.pos.y));
    const score = Math.min(marked, 120) - 0.2 * Math.hypot(t.pos.x - spot.x, t.pos.y - spot.y);
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  let to = best ? best.pos : spot;
  let d = Math.hypot(to.x - ball.x, to.y - ball.y);
  let speed = Math.max(CORNER_LOW_SPEED, Math.min(CORNER_HARD_MAX_SPEED, kickSpeedForDistance(d, undefined, CORNER_HARD_MAX_SPEED)));
  if (best) {
    // A runner still on the move (T17: they sprint in) is crossed to where they'll be when the ball gets there.
    // (Kept in the box, and off the goal line.)
    const t = d / (speed * 0.8);
    const out = Math.max(45, Math.min(PENALTY_BOX_WIDTH, (best.pos.x + best.vel.x * t - goalX) * inX));
    to = { x: goalX + inX * out, y: Math.max(MID_Y - PENALTY_BOX_HEIGHT / 2, Math.min(MID_Y + PENALTY_BOX_HEIGHT / 2, best.pos.y + best.vel.y * t)) };
    d = Math.hypot(to.x - ball.x, to.y - ball.y);
    speed = Math.max(CORNER_LOW_SPEED, Math.min(CORNER_HARD_MAX_SPEED, kickSpeedForDistance(d, undefined, CORNER_HARD_MAX_SPEED)));
  }
  return { aim: clampAim(Math.atan2(to.y - ball.y, to.x - ball.x), inwardDirection(r.type, r.pos)), speed, receiver: best ? best.id : -1, to };
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
  // (A free kick or penalty is a deliberate kick: one that goes straight out is not retaken.)
  const graced = RESTART_GRACE_TIME > 0 && r.type !== 'free-kick' && r.type !== 'penalty';
  state.grace = graced ? { type: r.type, team: r.team, pos: { ...r.pos }, taker: r.taker, timer: RESTART_GRACE_TIME } : null;
}

/** The taker throws (or kicks) the set piece at `speed` towards `aim`, and the restart is released. */
export function playRestart(state: GameState, taker: PlayerState, speed: number, aim: number): void {
  const { ball } = state;
  const r = state.restart;
  if (r?.type === 'penalty') {
    // Struck: now it is decided (goal, save or miss: rules.ts).
    const keeper = state.players.find((p) => p.team !== r.team && p.role === 'keeper');
    state.penalty = { team: r.team, taker: taker.id, keeper: keeper ? keeper.id : -1, timer: 0, keeperTouched: false, shootout: state.phase === 'shootout' };
  }
  state.possession = null;
  taker.facing = aim;
  taker.charge = 0;
  taker.kickQueue = 0;
  taker.touchTimer = KICK_TOUCH_LOCKOUT;
  taker.kickFlash = KICK_FLASH_TIME;
  taker.kickAge = 0;
  ball.vel = { x: Math.cos(aim) * speed, y: Math.sin(aim) * speed };
  state.lastTouch = { team: taker.team, player: taker.id };
  releaseRestart(state);
}

/**
 * One tick of a held set piece's taker: stands still with the ball (held over their head, or at their feet), aims with
 * the move keys (clamped into the pitch; a penalty left / centre / right) and plays it on a pass press (short throw /
 * low cross / pass / placed penalty) or a shoot release (long throw / hard cross / shot, charged). A free kick shot gets
 * the aim assist. Returns whether it was played, and as a shot (a free kick or penalty struck at goal).
 */
export function takeHeldRestart(state: GameState, p: PlayerState, input: InputFrame, dt: number): 'none' | 'played' | 'shot' {
  const r = state.restart!;
  p.tackleCooldown = Math.max(0, p.tackleCooldown - dt);
  p.touchTimer = Math.max(0, p.touchTimer - dt);
  p.kickFlash = Math.max(0, p.kickFlash - dt);
  p.tackleTimer = 0;
  p.kickQueue = 0;
  p.vel = { x: 0, y: 0 };
  const aim = heldAim(state, r, input, p.facing);
  p.facing = aim;
  const full = heldChargeTime(state, r.type);
  if (input.shoot) p.charge = Math.min(full, p.charge + dt);
  const passPressed = input.pass && !p.prevPass;
  const shootReleased = !input.shoot && p.prevShoot;
  if (passPressed || shootReleased) {
    let a = aim;
    if (r.type === 'penalty' && passPressed) a = heldAim(state, r, input, aim, true);
    else if (r.type === 'free-kick' && shootReleased) a = assistAim(state, p.team, state.ball.pos, aim);
    const type = r.type;
    playRestart(state, p, passPressed ? heldShortSpeed(type) : throwSpeed(p.charge, type, full), a);
    return type === 'penalty' || (type === 'free-kick' && shootReleased) ? 'shot' : 'played';
  }
  if (!input.shoot) p.charge = 0;
  return 'none';
}

/**
 * The restart's timer ran out with the ball still on its spot. A throw-in is thrown for the taker (a long throw if they
 * are charging one, else to the nearest unmarked teammate) and a corner crossed (into the box); a human's kick is
 * passed to a teammate for them. Returns false if it should just be released (an AI's goal kick or kickoff).
 */
export function autoPlayRestart(state: GameState, humanTaker: boolean): boolean {
  const r = state.restart;
  if (!r || r.taker < 0) return false;
  const taker = state.players[r.taker];
  if (!taker) return false;
  const held = isHeldType(r.type);
  if (!held && !humanTaker) return false;
  if (held && taker.charge > 0) {
    playRestart(state, taker, throwSpeed(taker.charge, r.type, heldChargeTime(state, r.type)), taker.facing);
    return true;
  }
  if (r.type === 'penalty') {
    // Nobody pressed anything: a placed kick where the taker is aiming.
    playRestart(state, taker, heldShortSpeed('penalty'), heldAim(state, r, { moveX: 0, moveY: 0 }, taker.facing, true));
    return true;
  }
  const t = r.type === 'corner' ? cornerTarget(state, r, taker) : restartTarget(state, r, taker);
  playRestart(state, taker, t.speed, t.aim);
  return true;
}

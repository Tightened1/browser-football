// Shooting helpers (T15): charge -> speed, aim assist, the finesse (curled) shot and the ball's curl. Pure.
// Shared by the sim (simulation.ts), the AI (ai.ts), the online guest's kick prediction (net/client.ts) and the aim
// line (render/MatchScene.ts), so they all agree on where a shot goes.
import {
  AIM_ASSIST_CONE,
  AIM_ASSIST_CORNER_INSET,
  AIM_ASSIST_MAX_BEND,
  AIM_ASSIST_MAX_BEND_OUT,

  AIM_ASSIST_RANGE,
  AIM_ASSIST_STRENGTH,
  BALL_RADIUS,
  FINESSE_POST_INSET,
  FINESSE_SPEED,
  FINESSE_SPIN,
  FINESSE_SPIN_DECAY,
  PITCH_HEIGHT,
  PITCH_LEFT,
  PITCH_RIGHT,
  PITCH_TOP,
  SHOT_MAX_CHARGE_TIME,
  SHOT_MAX_SPEED,
  SHOT_MIN_SPEED,
  SIM_DT,
} from '../config';
import { applyRollingFriction } from './physics';
import type { BallState, GameState, MatchRules, TeamId, Vec2 } from './types';

const MID_Y = PITCH_TOP + PITCH_HEIGHT / 2;

/** Wraps an angle difference to -PI..PI. */
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Charge (seconds) -> kick speed. A tap (tiny charge) is about SHOT_MIN_SPEED; `chargeTime` gives full power. */
export function shotSpeed(charge: number, chargeTime = SHOT_MAX_CHARGE_TIME): number {
  const f = Math.min(1, Math.max(0, charge / chargeTime));
  return SHOT_MIN_SPEED + (SHOT_MAX_SPEED - SHOT_MIN_SPEED) * f;
}

/** X of the goal line `team` attacks. */
export function attackedGoalX(state: GameState, team: TeamId): number {
  return state.attackDir[team] > 0 ? PITCH_RIGHT : PITCH_LEFT;
}

/** Is `from` within shooting range of the goal `team` attacks (and in front of it)? */
export function inShootingRange(state: GameState, team: TeamId, from: Vec2): boolean {
  const goalX = attackedGoalX(state, team);
  const dx = goalX - from.x;
  return dx * state.attackDir[team] > 0 && Math.hypot(dx, MID_Y - from.y) <= AIM_ASSIST_RANGE;
}

/** Where a ball struck from `from` at angle `aim` crosses the goal line x = goalX (null if it heads away from it). */
export function yAtGoalLine(from: Vec2, aim: number, goalX: number): number | null {
  const c = Math.cos(aim);
  const dx = goalX - from.x;
  if (Math.abs(c) < 1e-6 || dx * c <= 0) return null;
  return from.y + (Math.sin(aim) * dx) / c;
}

/** The keeper `team` shoots at (null if none). */
function opposingKeeper(state: GameState, team: TeamId): { pos: Vec2; radius: number } | null {
  for (const p of state.players) if (p.team !== team && p.role === 'keeper') return p;
  return null;
}

/**
 * Mild aim assist (rules.aimAssist): a shot struck from `from` within shooting range and aimed at the goal (or within
 * AIM_ASSIST_CONE of it) is bent a little towards the nearer open corner -- by AIM_ASSIST_STRENGTH of the difference,
 * at most AIM_ASSIST_MAX_BEND -- so it is never put fully onto the corner. Anything else is returned unchanged.
 */
export function assistAim(state: GameState, team: TeamId, from: Vec2, aim: number, rules: MatchRules = state.rules): number {
  if (!rules.aimAssist || !inShootingRange(state, team, from)) return aim;
  const goalX = attackedGoalX(state, team);
  const dx = goalX - from.x;
  const centre = Math.atan2(MID_Y - from.y, dx);
  const half = rules.goalWidth / 2;
  const rel = wrap(aim - centre);
  const postA = wrap(Math.atan2(MID_Y - half - from.y, dx) - centre);
  const postB = wrap(Math.atan2(MID_Y + half - from.y, dx) - centre);
  if (rel < Math.min(postA, postB) - AIM_ASSIST_CONE || rel > Math.max(postA, postB) + AIM_ASSIST_CONE) return aim; // not at goal
  const corners = [MID_Y - half + AIM_ASSIST_CORNER_INSET, MID_Y + half - AIM_ASSIST_CORNER_INSET].map((y) => ({
    y,
    rel: wrap(Math.atan2(y - from.y, dx) - centre),
  }));
  corners.sort((a, b) => Math.abs(rel - a.rel) - Math.abs(rel - b.rel));
  // "Open": a shot between the corners whose nearer corner the keeper's body blocks goes for the other one instead.
  // (A shot heading wide always goes for the nearer corner, so it can never be swung right across it.)
  const keeper = opposingKeeper(state, team);
  let target = corners[0];
  const between = rel > Math.min(corners[0].rel, corners[1].rel) && rel < Math.max(corners[0].rel, corners[1].rel);
  if (keeper && between) {

    const blocked = (y: number): boolean => segmentDistance(keeper.pos, from, { x: goalX, y }) < keeper.radius + BALL_RADIUS;
    if (blocked(corners[0].y) && !blocked(corners[1].y)) target = corners[1];
  }
  // Pulling a shot in from wide gets more help than pushing one out from the middle towards the corner.
  const want = (target.rel - rel) * AIM_ASSIST_STRENGTH;
  const max = Math.abs(target.rel) > Math.abs(rel) ? AIM_ASSIST_MAX_BEND_OUT : AIM_ASSIST_MAX_BEND;
  return aim + clamp(want, -max, max);
}

function segmentDistance(q: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  const t = len2 > 0 ? clamp(((q.x - a.x) * abx + (q.y - a.y) * aby) / len2, 0, 1) : 0;
  return Math.hypot(q.x - (a.x + abx * t), q.y - (a.y + aby * t));
}

/** One tick of curl: the ball's direction of travel turns by its spin, and the spin fades. */
export function curlBall(ball: BallState, dt = SIM_DT): void {
  const spin = ball.spin ?? 0;
  if (spin === 0) return;
  const a = spin * dt;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const vx = ball.vel.x;
  ball.vel.x = vx * c - ball.vel.y * s;
  ball.vel.y = vx * s + ball.vel.y * c;
  const next = spin * Math.exp(-FINESSE_SPIN_DECAY * dt);
  ball.spin = Math.abs(next) < 0.02 || Math.hypot(ball.vel.x, ball.vel.y) < 60 ? 0 : next;
}

/** Where a curled ball launched from `from` at (speed, angle, spin) crosses x = goalX (null if it never does). */
function curledYAtLine(from: Vec2, speed: number, angle: number, spin: number, goalX: number): number | null {
  const ball: BallState = { pos: { ...from }, vel: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed }, radius: BALL_RADIUS, spin };
  const side = Math.sign(goalX - from.x);
  for (let i = 0; i < 180; i++) {
    curlBall(ball);
    applyRollingFriction(ball, SIM_DT);
    const px = ball.pos.x;
    const py = ball.pos.y;
    ball.pos.x += ball.vel.x * SIM_DT;
    ball.pos.y += ball.vel.y * SIM_DT;
    if ((ball.pos.x - goalX) * side >= 0) {
      const t = (goalX - px) / (ball.pos.x - px || 1e-9);
      return py + (ball.pos.y - py) * t;
    }
    if (ball.vel.x * side <= 0) return null;
  }
  return null;
}

/**
 * The finesse shot (rules.finesse): hold shoot and tap pass. In shooting range it goes FINESSE_POST_INSET inside the
 * post on the side the aim points to (straight at goal: the side away from the keeper), launched wide and curled back
 * in; out of range it curls along the aim. Returns the launch angle and spin; the speed is FINESSE_SPEED.
 */
export function finesseShot(state: GameState, team: TeamId, from: Vec2, aim: number, rules: MatchRules = state.rules): { aim: number; spin: number } {
  const goalX = attackedGoalX(state, team);
  if (!inShootingRange(state, team, from)) {
    // Out of range: curl it in towards the middle of the pitch.
    const turn = wrap(Math.atan2(MID_Y - from.y, goalX - from.x) - aim);
    return { aim, spin: (turn >= 0 ? 1 : -1) * FINESSE_SPIN * 0.6 };
  }
  const half = rules.goalWidth / 2;
  const yAim = yAtGoalLine(from, aim, goalX);
  let side: number;
  if (yAim !== null && Math.abs(yAim - MID_Y) > 8) side = Math.sign(yAim - MID_Y);
  else {
    const keeper = opposingKeeper(state, team);
    side = keeper && keeper.pos.y > MID_Y ? -1 : 1;
  }
  const ty = MID_Y + side * (half - FINESSE_POST_INSET);
  const direct = Math.atan2(ty - from.y, goalX - from.x);
  // Curl back in towards the goal centre: the ball starts outside the post's line.
  const centre = Math.atan2(MID_Y - from.y, goalX - from.x);
  const inward = wrap(centre - direct) >= 0 ? 1 : -1;
  const spin = inward * FINESSE_SPIN;
  // Solve for the launch angle that lands on the target (a few secant steps on the real ball model).
  let a0 = direct - inward * 0.12;
  let a1 = direct - inward * 0.2;
  let e0 = errorAt(a0);
  let e1 = errorAt(a1);
  for (let i = 0; i < 6 && e0 !== null && e1 !== null && Math.abs(e1) > 0.5 && e1 !== e0; i++) {
    const a2 = a1 - (e1 * (a1 - a0)) / (e1 - e0);
    a0 = a1;
    e0 = e1;
    a1 = a2;
    e1 = errorAt(a1);
  }
  return { aim: e1 === null ? direct : a1, spin };

  function errorAt(a: number): number | null {
    const y = curledYAtLine(from, FINESSE_SPEED, a, spin, goalX);
    return y === null ? null : y - ty;
  }
}

/**
 * Where (y) and when (s) a loose ball, curling as it goes, crosses x = `x` (null if it doesn't within `maxTime`).
 * Friction and curl only, no bounces: for a keeper reading a curled shot (sim/ai.ts predictShot).
 */
export function curledCrossing(ball: BallState, x: number, maxTime: number): { y: number; time: number } | null {
  const b: BallState = { pos: { ...ball.pos }, vel: { ...ball.vel }, radius: ball.radius, spin: ball.spin ?? 0 };
  const side = Math.sign(x - b.pos.x);
  if (side === 0) return { y: b.pos.y, time: 0 };
  for (let t = 0; t <= maxTime; t += SIM_DT) {
    curlBall(b);
    applyRollingFriction(b, SIM_DT);
    const px = b.pos.x;
    const py = b.pos.y;
    b.pos.x += b.vel.x * SIM_DT;
    b.pos.y += b.vel.y * SIM_DT;
    if ((b.pos.x - x) * side >= 0) {
      const f = (x - px) / (b.pos.x - px || 1e-9);
      return { y: py + (b.pos.y - py) * f, time: t + f * SIM_DT };
    }
    if (b.vel.x * side <= 0) return null;
  }
  return null;
}

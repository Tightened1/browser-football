// Sticky dribbling (T13): taking control of a loose ball, carrying it in front of you, and losing it. Pure.
// The rules live here so the sim (simulation.ts) and the online guest's prediction (net/client.ts) share them.
import {
  DRIBBLE_CHECK_CONE,
  DRIBBLE_CHECK_KNOCK_SPEED,
  DRIBBLE_CHECK_REACH,
  DRIBBLE_CONTROL_REACH,
  DRIBBLE_CONTROL_SPEED,
  DRIBBLE_HOLD_GAP,
  DRIBBLE_HOLD_STIFFNESS,
  DRIBBLE_MODE,
  DRIBBLE_PASS_CONTROL_SPEED,
  DRIBBLE_REGAIN_LOCKOUT,
  DRIBBLE_ROLL_AMPLITUDE,
  DRIBBLE_ROLL_PERIOD,
  DRIBBLE_SHARP_TURN_ANGLE,
  DRIBBLE_SHARP_TURN_LOSS,
  DRIBBLE_SHARP_TURN_SPEED,
  DRIBBLE_SPEED_FACTOR,
  DRIBBLE_SPRINT_ROLL_AMPLITUDE,
  DRIBBLE_SPRINT_TURN_RATE,
  DRIBBLE_TURN_RATE,
  FEINT_COOLDOWN,
  FEINT_MAX_SHIFT,
  FEINT_SPEED,
  FEINT_TIME,
  SHIELD_AWARE_RADIUS,
  SHIELD_CHECK_CONE,
  SHIELD_FRONT_ANGLE,
  SHIELD_SLIDE_WIN,
  STAND_TACKLE_COOLDOWN,
  GOAL_WIDTH,
  PENALTY_BOX_HEIGHT,
  PENALTY_BOX_WIDTH,
  PITCH_BOTTOM,
  PITCH_LEFT,
  PITCH_RIGHT,
  PITCH_TOP,
  PITCH_HEIGHT,
  PLAYER_MAX_SPEED,
  BALL_MAX_SPEED,
  SIM_DT,
  TOUCHLINE_HOLDS_DRIBBLE,
  TOUCHLINE_HOLD_MAX_PUSH,
  TOUCHLINE_HOLD_SPEED_FACTOR,
  WALL_TANGENT_KEEP,
} from '../config';
import { applyRollingFriction, BALL_BOUNDARY, capSpeed, collideWithBoundary, moveCircle, type Boundary } from './physics';
import { defendingProfile } from './matchRules';
import { nextRandom } from './random';
import { curlBall } from './shooting';
import type { BallState, GameState, InputFrame, PlayerState, Possession, TeamId, Vec2 } from './types';

export const stickyDribbling = (): boolean => DRIBBLE_MODE === 'sticky';

/** Wraps an angle difference to -PI..PI. */
export function angleDiff(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

/** Top speed of a player running with the ball. */
export const CARRY_SPEED = PLAYER_MAX_SPEED * DRIBBLE_SPEED_FACTOR;

/**
 * Where the held ball sits relative to the carrier's centre: in front at `angle`, rolling a little out and back in --
 * further out when sprinting (bigger touches, T17).
 */
export function holdOffset(poss: Possession, p: PlayerState, ballRadius: number): Vec2 {
  const roll = 0.5 - 0.5 * Math.cos((2 * Math.PI * poss.roll) / DRIBBLE_ROLL_PERIOD);
  const d = p.radius + ballRadius + DRIBBLE_HOLD_GAP + (p.sprinting ? DRIBBLE_SPRINT_ROLL_AMPLITUDE : DRIBBLE_ROLL_AMPLITUDE) * roll;
  return { x: Math.cos(poss.angle) * d, y: Math.sin(poss.angle) * d };
}

/**
 * One tick of carrying: the ball swings round towards `towards` (default the carrier's facing; rate-limited, slower
 * when sprinting) and rolls with the distance run.
 */
export function advanceHold(poss: Possession, p: PlayerState, dt: number, towards = p.facing): void {
  const turn = angleDiff(towards, poss.angle);
  const max = (p.sprinting ? DRIBBLE_SPRINT_TURN_RATE : DRIBBLE_TURN_RATE) * dt;
  poss.angle += Math.max(-max, Math.min(max, turn));
  poss.roll = (poss.roll + Math.hypot(p.vel.x, p.vel.y) * dt) % DRIBBLE_ROLL_PERIOD;
}

const MID_Y = PITCH_TOP + PITCH_HEIGHT / 2;

/**
 * How far (x, y) a held ball centred at (x, y) is over the limit of the lines it may not be carried across: the whole
 * ball stays inside the touchlines and the goal lines (except in the goal mouth, where it can be walked in to score).
 */
function overLines(x: number, y: number, r: number, goalWidth: number): Vec2 {
  const over = { x: 0, y: 0 };
  if (y < PITCH_TOP + r) over.y = y - (PITCH_TOP + r);
  else if (y > PITCH_BOTTOM - r) over.y = y - (PITCH_BOTTOM - r);
  if (Math.abs(y - MID_Y) > goalWidth / 2) {
    if (x < PITCH_LEFT + r) over.x = x - (PITCH_LEFT + r);
    else if (x > PITCH_RIGHT - r) over.x = x - (PITCH_RIGHT - r);
  }
  return over;
}

/**
 * Arcade touchline (T14, TOUCHLINE_HOLDS_DRIBBLE): the carrier can't take the ball over a line. If its spot is over one,
 * the carrier is held back off the line (at most TOUCHLINE_HOLD_MAX_PUSH a tick), stops running into it and slides
 * along it, slower. Run after the carrier has moved, before the ball is steered. Returns whether it held them.
 */
export function holdOffLines(poss: Possession, p: PlayerState, ballRadius: number, goalWidth = GOAL_WIDTH): boolean {
  if (!TOUCHLINE_HOLDS_DRIBBLE) return false;
  const off = holdOffset(poss, p, ballRadius);
  const over = overLines(p.pos.x + off.x, p.pos.y + off.y, ballRadius, goalWidth);
  if (over.x === 0 && over.y === 0) return false;
  const clampPush = (v: number): number => Math.max(-TOUCHLINE_HOLD_MAX_PUSH, Math.min(TOUCHLINE_HOLD_MAX_PUSH, v));
  p.pos.x -= clampPush(over.x);
  p.pos.y -= clampPush(over.y);
  if (over.x * p.vel.x > 0) p.vel.x = 0;
  if (over.y * p.vel.y > 0) p.vel.y = 0;
  const sp = Math.hypot(p.vel.x, p.vel.y);
  const max = CARRY_SPEED * TOUCHLINE_HOLD_SPEED_FACTOR;
  if (sp > max) {
    p.vel.x *= max / sp;
    p.vel.y *= max / sp;
  }
  return true;
}

/**
 * Pulls the held ball towards its spot (the carrier has already moved this tick): it is given the velocity that covers
 * most of the gap during this tick, so it follows closely, never overshoots and never jumps. With the arcade touchline
 * the spot is kept inside the lines.
 */
export function steerHeldBall(poss: Possession, p: PlayerState, ball: BallState, dt = SIM_DT, goalWidth = GOAL_WIDTH): void {
  const spot = heldBallSpot(poss, p, ball.radius, goalWidth);
  const k = (1 - Math.exp(-DRIBBLE_HOLD_STIFFNESS * dt)) / dt;
  ball.vel.x = (spot.x - ball.pos.x) * k;
  ball.vel.y = (spot.y - ball.pos.y) * k;
}

/** Where the held ball belongs: in front of the carrier (holdOffset), kept inside the lines with the arcade touchline. */
export function heldBallSpot(poss: Possession, p: PlayerState, ballRadius: number, goalWidth = GOAL_WIDTH): Vec2 {
  const off = holdOffset(poss, p, ballRadius);
  const spot = { x: p.pos.x + off.x, y: p.pos.y + off.y };
  if (TOUCHLINE_HOLDS_DRIBBLE) {
    const over = overLines(spot.x, spot.y, ballRadius, goalWidth);
    spot.x -= over.x;
    spot.y -= over.y;
  }
  return spot;
}

/**
 * Shield (T17): where a shielding carrier holds the ball -- on the far side of their body from the nearest opponent
 * within SHIELD_AWARE_RADIUS (else in front, as usual). `players` may be the drawn state's (the online guest).
 */
export function shieldHoldAngle(players: readonly PlayerState[], p: PlayerState): number {
  let best: PlayerState | null = null;
  let bestD = SHIELD_AWARE_RADIUS;
  for (const o of players) {
    if (o.team === p.team) continue;
    const d = Math.hypot(o.pos.x - p.pos.x, o.pos.y - p.pos.y);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best ? Math.atan2(p.pos.y - best.pos.y, p.pos.x - best.pos.x) : p.facing;
}

/** Where the carrier's ball swings towards this tick: out of a keeper's goal, away from an opponent when shielding, else the facing. */
export function holdTarget(state: GameState, p: PlayerState): number {
  if (p.role === 'keeper') return keeperHoldAngle(state, p);
  return p.shielding ? shieldHoldAngle(state.players, p) : p.facing;
}

/**
 * Feint / drag-back (T17, a double-tapped move key while carrying): the ball is dragged round towards the move keys (at
 * most FEINT_MAX_SHIFT) and the carrier steps that way at FEINT_SPEED for FEINT_TIME. Returns whether it happened.
 * Shared with the online guest's prediction.
 */
export function startFeint(poss: Possession, p: PlayerState, input: InputFrame): boolean {
  if (p.feintCooldown > 0 || p.tackleTimer > 0 || p.role === 'keeper') return false;
  if (Math.hypot(input.moveX, input.moveY) < 0.5) return false;
  const a = Math.atan2(input.moveY, input.moveX);
  poss.angle += Math.max(-FEINT_MAX_SHIFT, Math.min(FEINT_MAX_SHIFT, angleDiff(a, poss.angle)));
  p.facing = a;
  p.vel.x = Math.cos(a) * FEINT_SPEED;
  p.vel.y = Math.sin(a) * FEINT_SPEED;
  p.feintTimer = FEINT_TIME;
  p.feintCooldown = FEINT_COOLDOWN;
  return true;
}

/**
 * A slide reaching a shielding carrier's ball from behind or beside them (more than SHIELD_FRONT_ANGLE off the side the
 * ball is on) goes through the body: it wins the ball only SHIELD_SLIDE_WIN of the time (seeded roll).
 */
export function shieldBlocksSlide(state: GameState, carrier: PlayerState, tackler: PlayerState): boolean {
  const poss = state.possession;
  if (!poss || !carrier.shielding) return false;
  const from = Math.atan2(tackler.pos.y - carrier.pos.y, tackler.pos.x - carrier.pos.x);
  if (Math.abs(angleDiff(from, poss.angle)) <= SHIELD_FRONT_ANGLE) return false;
  return nextRandom(state.ai) >= SHIELD_SLIDE_WIN;
}

/** A turn of almost straight back at full carrying speed: the ball runs on and is lost (not during a feint). */
export function sharpTurnLosesBall(p: PlayerState, input: InputFrame): boolean {
  if (!DRIBBLE_SHARP_TURN_LOSS || p.feintTimer > 0) return false;
  const sp = Math.hypot(p.vel.x, p.vel.y);
  const ml = Math.hypot(input.moveX, input.moveY);
  if (sp < DRIBBLE_SHARP_TURN_SPEED * CARRY_SPEED || ml < 0.5) return false;
  const cos = (p.vel.x * input.moveX + p.vel.y * input.moveY) / (sp * ml);
  return Math.acos(Math.max(-1, Math.min(1, cos))) >= DRIBBLE_SHARP_TURN_ANGLE;
}

/** The carrier loses the ball (it keeps its current motion) and can't take it straight back. */
export function loseBall(state: GameState, lockout = DRIBBLE_REGAIN_LOCKOUT): void {
  const poss = state.possession;
  if (!poss) return;
  const p = state.players[poss.player];
  if (p) p.touchTimer = Math.max(p.touchTimer, lockout);
  state.possession = null;
}

/** Is `p` a keeper inside its own penalty box (where it may hold the ball)? */
export function keeperInBox(state: GameState, p: PlayerState): boolean {
  if (p.role !== 'keeper') return false;
  const goalX = state.attackDir[p.team] > 0 ? PITCH_LEFT : PITCH_RIGHT;
  return Math.abs(p.pos.x - goalX) <= PENALTY_BOX_WIDTH && Math.abs(p.pos.y - (PITCH_TOP + PITCH_HEIGHT / 2)) <= PENALTY_BOX_HEIGHT / 2;
}

/** A keeper holding the ball faces it out of its goal, towards the pitch. */
export function keeperHoldAngle(state: GameState, p: PlayerState): number {
  return state.attackDir[p.team] > 0 ? 0 : Math.PI;
}

/** Can `p` take control of the ball right now? (A teammate's pass may arrive faster than a loose ball; a keeper catches.) */
export function canControl(state: GameState, p: PlayerState): boolean {
  const { ball } = state;
  if (p.tackleTimer > 0 || p.windup > 0 || p.touchTimer > 0 || p.kickFlash > 0 || p.sentOff) return false;
  if (p.role === 'keeper' && !keeperInBox(state, p)) return false;
  const gap = Math.hypot(ball.pos.x - p.pos.x, ball.pos.y - p.pos.y) - p.radius - ball.radius;
  if (gap > DRIBBLE_CONTROL_REACH) return false;
  return relativeSpeed(p, ball) <= controlSpeed(state, p);
}

export function relativeSpeed(p: PlayerState, ball: BallState): number {
  return Math.hypot(ball.vel.x - p.vel.x, ball.vel.y - p.vel.y);
}

/** Fastest ball (relative speed) `p` can control: higher for a teammate's pass. */
export function controlSpeed(state: GameState, p: PlayerState): number {
  if (p.role === 'keeper') return state.rules.keeperCatchSpeed;
  const last = state.lastTouch;
  return last && last.team === p.team && last.player !== p.id ? DRIBBLE_PASS_CONTROL_SPEED : DRIBBLE_CONTROL_SPEED;
}

/** Gives `p` the ball where it lies (the hold then swings it round to the front, no teleport). */
export function takePossession(state: GameState, p: PlayerState): void {
  const { ball } = state;
  state.possession = { player: p.id, angle: Math.atan2(ball.pos.y - p.pos.y, ball.pos.x - p.pos.x), roll: 0 };
  state.lastTouch = { team: p.team, player: p.id };
}

/** Counts one of `team`'s AI challenges on a carrier (`tried`) and/or its winning the ball (AiTeamMemory.duel*, for tuning). */
export function recordDuel(state: GameState, team: TeamId, humanCarrier: boolean, tried: boolean, won: boolean): void {
  const tm = state.ai.teams[team];
  if (humanCarrier) {
    tm.duelTriesHuman += tried ? 1 : 0;
    tm.duelWinsHuman += won ? 1 : 0;
  } else {
    tm.duelTries += tried ? 1 : 0;
    tm.duelWins += won ? 1 : 0;
  }
}

/**
 * Standing tackle (T17): does `o`'s body check win the ball off carrier `c`? Never against a feint; an AI challenger on a
 * human carrier wins with the rules' AI-defending standWin chance (a seeded roll), anyone else always. A failed one
 * costs the challenger STAND_TACKLE_COOLDOWN.
 */
function standingTackleWins(state: GameState, o: PlayerState, c: PlayerState, humanDriven: readonly boolean[]): boolean {
  const aiChallenger = !humanDriven[o.id];
  const humanCarrier = !!humanDriven[c.id];
  const chance = c.feintTimer > 0 ? 0 : aiChallenger ? defendingProfile(state.rules, humanCarrier).standWin : 1;
  const wins = chance >= 1 || (chance > 0 && nextRandom(state.ai) < chance);
  if (!wins) o.standCooldown = STAND_TACKLE_COOLDOWN;
  if (aiChallenger) recordDuel(state, o.team, humanCarrier, true, wins);
  return wins;
}

/**
 * Once per tick, after everyone has moved: the carrier loses the ball to an opponent body-checking them from the front
 * (a standing tackle, which can fail: standingTackleWins), or if it has been pushed away from them; otherwise the closest player able to control a loose ball takes it.
 * Then the held ball is steered to its spot. Sticky mode, open play only. `humanDriven[id]`: that player is a human's this tick.
 */
export function updatePossession(state: GameState, humanDriven: readonly boolean[] = []): void {
  if (!stickyDribbling()) return;
  // (Nobody can pick up a throw-in, corner, free kick or penalty: it is played from its spot. A shoot-out is all penalties.)
  const t = state.restart?.type;
  const held = t === 'throw-in' || t === 'corner' || t === 'free-kick' || t === 'penalty';
  if ((state.phase !== 'playing' && state.phase !== 'shootout') || held) {
    state.possession = null;
    return;
  }
  const { ball, players } = state;
  let poss = state.possession;
  if (poss) {
    const c = players[poss.player];
    const gap = Math.hypot(ball.pos.x - c.pos.x, ball.pos.y - c.pos.y) - c.radius - ball.radius;
    if (c.tackleTimer > 0 || gap > 20) loseBall(state);
    else if (c.role !== 'keeper') {
      // (A keeper holding the ball can't be challenged.)
      for (const o of players) {
        if (o.team === c.team || o.tackleTimer > 0 || o.windup > 0 || o.standCooldown > 0) continue;
        const og = Math.hypot(ball.pos.x - o.pos.x, ball.pos.y - o.pos.y) - o.radius - ball.radius;
        if (og > DRIBBLE_CHECK_REACH) continue;
        const front = Math.abs(angleDiff(Math.atan2(o.pos.y - c.pos.y, o.pos.x - c.pos.x), poss.angle));
        if (front > (c.shielding ? SHIELD_CHECK_CONE : DRIBBLE_CHECK_CONE)) continue; // from behind or the side: the carrier's body is in the way
        if (!standingTackleWins(state, o, c, humanDriven)) continue;
        // Knocked loose, sideways off the line between the two players.
        const ux = o.pos.x - c.pos.x;
        const uy = o.pos.y - c.pos.y;
        const ul = Math.hypot(ux, uy) || 1;
        const side = ux * (ball.pos.y - c.pos.y) - uy * (ball.pos.x - c.pos.x) >= 0 ? 1 : -1;
        ball.vel.x = (c.vel.x + o.vel.x) / 2 - (uy / ul) * side * DRIBBLE_CHECK_KNOCK_SPEED;
        ball.vel.y = (c.vel.y + o.vel.y) / 2 + (ux / ul) * side * DRIBBLE_CHECK_KNOCK_SPEED;
        loseBall(state);
        // The challenger's touch knocked it loose: if it runs out of play, it's off them (T16).
        state.lastTouch = { team: o.team, player: o.id };
        break;
      }
    }
    poss = state.possession;
  }
  if (!poss) {
    let best: PlayerState | null = null;
    let bestD = Infinity;
    for (const p of players) {
      if (!canControl(state, p)) continue;
      const d = Math.hypot(ball.pos.x - p.pos.x, ball.pos.y - p.pos.y);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (best) takePossession(state, best);
    poss = state.possession;
  }
  if (poss) {
    state.lastTouch = { team: players[poss.player].team, player: poss.player };
    holdOffLines(poss, players[poss.player], ball.radius, state.rules.goalWidth);
    steerHeldBall(poss, players[poss.player], ball, SIM_DT, state.rules.goalWidth);
  }
}

/**
 * A loose ball rolling on its own for `ticks` fixed steps: curl, friction, nets and posts, no players. Used to draw the
 * online guest's own kick before the host's version of it arrives (net/client.ts).
 */
export function rollFreeBall(ball: BallState, ticks: number, dt = SIM_DT, boundary: Boundary = BALL_BOUNDARY): void {
  for (let i = 0; i < ticks; i++) {
    curlBall(ball, dt);
    applyRollingFriction(ball, dt);
    capSpeed(ball, BALL_MAX_SPEED);
    for (let k = 0; k < 4; k++) {
      moveCircle(ball, dt / 4);
      if (collideWithBoundary(ball, boundary, WALL_TANGENT_KEEP)) ball.spin = 0;
    }
  }
}

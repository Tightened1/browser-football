// step(state, inputs, dt) -> state. The only way the game advances. Pure: returns a new state.
import {
  BALL_MAX_SPEED,
  BALL_RADIUS,
  DRIBBLE_BOOST,
  DRIBBLE_CONE,
  DRIBBLE_MODE,
  DRIBBLE_REACH,
  DRIBBLE_SPEED_FACTOR,
  COLLISION_ITERATIONS,
  DRIBBLE_TOUCH_INTERVAL,
  KEEPER_BALL_RESTITUTION,
  KEEPER_CLEAR_SPEED,
  KEEPER_INV_MASS,
  KEEPER_RADIUS,
  HALF_LENGTH_SECONDS,
  KICKOFF_DELAY,
  PLAYERS_PER_TEAM,
  PLAYER_PLAYER_RESTITUTION,
  KICK_BUFFER_TIME,
  KICK_FLASH_TIME,
  KICK_PLAYER_VEL_FACTOR,
  KICK_REACH,
  KICK_TOUCH_LOCKOUT,
  MAX_STEP_FRACTION,
  MAX_SUBSTEPS,
  PASS_SPEED,
  PITCH_HEIGHT,
  PITCH_LEFT,
  PITCH_TOP,
  PITCH_WIDTH,
  PLAYER_ACCEL,
  PLAYER_BALL_RESTITUTION,
  PLAYER_DECEL,
  PLAYER_MAX_SPEED,
  PLAYER_RADIUS,
  SHOT_MAX_CHARGE_TIME,
  SHOT_MAX_SPEED,
  SHOT_MIN_SPEED,
  STAT_SHOT_MIN_FORWARD,
  STAT_SHOT_RANGE,
  TACKLE_COOLDOWN,
  TACKLE_HIT_COOLDOWN,
  KEEPER_DIVE_COOLDOWN,
  TACKLE_DURATION,
  TACKLE_KNOCK_SPEED,
  TACKLE_SPEED,
  WALL_TANGENT_KEEP,
} from '../config';
import {
  applyRollingFriction,
  capSpeed,
  collideCircles,
  BALL_BOUNDARY,
  collideWithBoundary,
  moveCircle,
  speedOf,
} from './physics';
import { cloneAiState, computeAiInputs, createAiState, formationPosition } from './ai';
import { applySwitching, updateTouches } from './control';
import { advanceHold, canControl, controlSpeed, keeperHoldAngle, loseBall, relativeSpeed, sharpTurnLosesBall, stickyDribbling, takePossession, updatePossession } from './dribble';
import { isFrozen, updateRules } from './rules';
import type { Difficulty, GameState, InputFrame, MatchPhase, PlayerRole, PlayerState, TeamId } from './types';

export const NEUTRAL_INPUT: InputFrame = {
  seq: 0,
  moveX: 0,
  moveY: 0,
  pass: false,
  shoot: false,
  tackle: false,
  switchPlayer: false,
};

export function createPlayer(
  id: number,
  team: TeamId,
  x: number,
  y: number,
  role: PlayerRole = 'outfield',
  slot = 1,
): PlayerState {
  return {
    id,
    team,
    role,
    slot,
    number: slot + 1,
    pos: { x, y },
    vel: { x: 0, y: 0 },
    radius: role === 'keeper' ? KEEPER_RADIUS : PLAYER_RADIUS,
    facing: team === 0 ? 0 : Math.PI,
    charge: 0,
    tackleTimer: 0,
    tackleCooldown: 0,
    touchTimer: 0,
    kickQueue: 0,
    queuedSpeed: 0,
    queuedAim: 0,
    queuedShot: false,
    kickFlash: 0,
    prevPass: false,
    prevShoot: false,
    prevTackle: false,
  };
}

export interface MatchOptions {
  /** No human on either team (spectate). Default: home is human-controlled. */
  aiVsAi?: boolean;
  /** Which teams have a human (default: home only). Ignored if aiVsAi. */
  humans?: [boolean, boolean];
  /** AI difficulty per team (default from config.ts). */
  difficulty?: [Difficulty, Difficulty];
  /** Seed for the AI's random number generator. */
  seed?: number;
  /** Team that kicks off (default home). */
  kickoffTeam?: TeamId;
  /** Seconds per half (default HALF_LENGTH_SECONDS). */
  halfLength?: number;
}

/**
 * A real match: two full teams in formation, in the pre-kickoff phase. Play starts after KICKOFF_DELAY with
 * the kickoff team on the centre spot. Team 0 (home) is human-controlled unless `humans` or aiVsAi say otherwise.
 */
export function createMatchState(options: MatchOptions = {}): GameState {
  const s = createInitialState(options);
  s.phase = 'pre-kickoff';
  s.phaseTimer = KICKOFF_DELAY;
  return s;
}

/**
 * Two full teams in formation, ball on the centre spot, already in open play (phase 'playing', no restart
 * pending) -- handy for tests and debugging. Use createMatchState for a real match.
 */
export function createInitialState(options: MatchOptions = {}): GameState {
  const midX = PITCH_LEFT + PITCH_WIDTH / 2;
  const midY = PITCH_TOP + PITCH_HEIGHT / 2;
  const attackDir: [number, number] = [1, -1];
  const players: PlayerState[] = [];
  for (const team of [0, 1] as const) {
    for (let slot = 0; slot < PLAYERS_PER_TEAM; slot++) {
      const pos = formationPosition(slot, attackDir[team]);
      players.push(createPlayer(players.length, team, pos.x, pos.y, slot === 0 ? 'keeper' : 'outfield', slot));
    }
  }
  // Each human starts on their team's front-most outfield player (home only, by default).
  const humans = options.aiVsAi ? [false, false] : (options.humans ?? [true, false]);
  const controlled: [number, number] = [0, 1].map((t) => (humans[t] ? t * PLAYERS_PER_TEAM + PLAYERS_PER_TEAM - 1 : -1)) as [number, number];
  return {
    tick: 0,
    ball: { pos: { x: midX, y: midY }, vel: { x: 0, y: 0 }, radius: BALL_RADIUS },
    players,
    controlled,
    attackDir,
    possession: null,
    lastTouch: null,
    prevSwitch: [false, false],
    ai: createAiState(players, controlled, options.difficulty, options.seed),
    phase: 'playing' as MatchPhase,
    phaseTimer: 0,
    halfLength: options.halfLength ?? HALF_LENGTH_SECONDS,
    half: 1,
    clock: 0,
    score: [0, 0],
    kickoffTeam: options.kickoffTeam ?? 0,
    firstKickoffTeam: options.kickoffTeam ?? 0,
    restart: null,
    events: [],
    nextEventId: 1,
    stats: { shots: [0, 0], possession: [0, 0], goals: [] },
  };
}

/** One human-controlled player alone on the pitch (for tests and debugging). */
export function createSoloState(x: number, y: number): GameState {
  const s = createInitialState();
  s.players = [createPlayer(0, 0, x, y)];
  s.controlled = [0, -1];
  s.ai = createAiState(s.players, s.controlled);
  return s;
}

export function cloneState(s: GameState): GameState {
  return {
    tick: s.tick,
    ball: { pos: { ...s.ball.pos }, vel: { ...s.ball.vel }, radius: s.ball.radius },
    players: s.players.map((p) => ({ ...p, pos: { ...p.pos }, vel: { ...p.vel } })),
    controlled: [s.controlled[0], s.controlled[1]],
    attackDir: [s.attackDir[0], s.attackDir[1]],
    possession: s.possession ? { ...s.possession } : null,
    lastTouch: s.lastTouch ? { ...s.lastTouch } : null,
    prevSwitch: [s.prevSwitch[0], s.prevSwitch[1]],
    ai: cloneAiState(s.ai),
    phase: s.phase,
    phaseTimer: s.phaseTimer,
    halfLength: s.halfLength,
    half: s.half,
    clock: s.clock,
    score: [s.score[0], s.score[1]],
    kickoffTeam: s.kickoffTeam,
    firstKickoffTeam: s.firstKickoffTeam,
    restart: s.restart ? { ...s.restart, pos: { ...s.restart.pos } } : null,
    events: s.events.map((e) => ({ ...e, score: [e.score[0], e.score[1]] as [number, number] })),
    nextEventId: s.nextEventId,
    stats: { shots: [s.stats.shots[0], s.stats.shots[1]], possession: [s.stats.possession[0], s.stats.possession[1]], goals: s.stats.goals.map((g) => ({ ...g })) },
  };
}

/** Move `vel` towards the target by at most `maxDelta` (straight line in velocity space). */
function approachVelocity(vel: { x: number; y: number }, tx: number, ty: number, maxDelta: number): void {
  const dx = tx - vel.x;
  const dy = ty - vel.y;
  const d = Math.hypot(dx, dy);
  if (d <= maxDelta) {
    vel.x = tx;
    vel.y = ty;
  } else {
    vel.x += (dx / d) * maxDelta;
    vel.y += (dy / d) * maxDelta;
  }
}

/** Charge (seconds) -> kick speed. A tap (tiny charge) is about SHOT_MIN_SPEED. */
export function shotSpeed(charge: number): number {
  const f = Math.min(1, Math.max(0, charge / SHOT_MAX_CHARGE_TIME));
  return SHOT_MIN_SPEED + (SHOT_MAX_SPEED - SHOT_MIN_SPEED) * f;
}

function distance(a: { pos: { x: number; y: number } }, b: { pos: { x: number; y: number } }): number {
  return Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y);
}

/** True if `p` may kick the ball now: it carries it (sticky), or the ball is loose and within KICK_REACH. */
export function canKick(state: GameState, p: PlayerState): boolean {
  if (p.tackleTimer > 0) return false;
  const poss = state.possession;
  if (poss) return poss.player === p.id;
  return distance(p, state.ball) <= p.radius + state.ball.radius + KICK_REACH;
}

/** Start a tackle if requested, off cooldown, and the player is not already on the ball. */
function maybeStartTackle(state: GameState, p: PlayerState, input: InputFrame): void {
  const pressed = input.tackle && !p.prevTackle;
  if (!pressed || p.tackleTimer > 0 || p.tackleCooldown > 0) return;
  if (canKick(state, p)) return; // has the ball: shoot/pass instead
  if (Math.hypot(input.moveX, input.moveY) > 1e-6) p.facing = Math.atan2(input.moveY, input.moveX); // slide where steered
  p.tackleTimer = TACKLE_DURATION;
  p.tackleCooldown = p.role === 'keeper' ? KEEPER_DIVE_COOLDOWN : TACKLE_COOLDOWN;
  p.kickQueue = 0; // a slide replaces any queued kick
}

/**
 * Movement, facing and timers for one player. Does not touch the ball or other players. `speedFactor` scales the
 * top speed (a player carrying the ball runs at DRIBBLE_SPEED_FACTOR).
 * Exported for the online guest's prediction of its own player (net/client.ts).
 */
export function updatePlayer(p: PlayerState, input: InputFrame, dt: number, speedFactor = 1): void {
  p.tackleCooldown = Math.max(0, p.tackleCooldown - dt);
  p.touchTimer = Math.max(0, p.touchTimer - dt);
  p.kickFlash = Math.max(0, p.kickFlash - dt);

  let mx = input.moveX;
  let my = input.moveY;
  const mlen = Math.hypot(mx, my);
  if (mlen > 1) {
    mx /= mlen;
    my /= mlen;
  }
  const hasMove = mlen > 1e-6;

  if (p.tackleTimer > 0) {
    // Sliding: committed to the facing direction, decaying speed, steering ignored.
    p.tackleTimer = Math.max(0, p.tackleTimer - dt);
    const k = 0.35 + 0.65 * (p.tackleTimer / TACKLE_DURATION);
    p.vel.x = Math.cos(p.facing) * TACKLE_SPEED * k;
    p.vel.y = Math.sin(p.facing) * TACKLE_SPEED * k;
  } else {
    if (hasMove) p.facing = Math.atan2(my, mx);
    const top = PLAYER_MAX_SPEED * speedFactor;
    approachVelocity(p.vel, mx * top, my * top, (hasMove ? PLAYER_ACCEL : PLAYER_DECEL) * dt);
  }

  moveCircle(p, dt);
  collideWithBoundary(p, undefined, 1, 0);
}

/** Strike the ball at `speed` towards `aim` (radians), plus some of the kicker's own velocity. */
function kickBall(state: GameState, p: PlayerState, speed: number, aim: number): void {
  const { ball } = state;
  if (state.possession?.player === p.id) state.possession = null;
  p.facing = aim;
  ball.vel.x = Math.cos(aim) * speed + p.vel.x * KICK_PLAYER_VEL_FACTOR;
  ball.vel.y = Math.sin(aim) * speed + p.vel.y * KICK_PLAYER_VEL_FACTOR;
  p.touchTimer = KICK_TOUCH_LOCKOUT;
  p.kickFlash = KICK_FLASH_TIME;
  p.kickQueue = 0;
}

/**
 * Charging, kicks (through the kick buffer), tackle knocks and classic dribble touches for one player.
 * Returns whether the player touched the ball, and whether that touch was a shoot-button kick.
 */
function interactWithBall(state: GameState, p: PlayerState, input: InputFrame, dt: number): { touched: boolean; shot: boolean } {
  const { ball } = state;
  const result = { touched: false, shot: false };
  const d = distance(p, ball);
  const contact = p.radius + ball.radius;
  const sliding = p.tackleTimer > 0;

  if (sliding) {
    p.charge = 0;
    p.kickQueue = 0;
    // A keeper's slide is a dive: it blocks the ball with its body (see step) rather than knocking it on.
    if (p.role !== 'keeper' && d <= contact + DRIBBLE_REACH && p.touchTimer === 0) {
      // Slide hits the ball: knock it away (winning it off a carrier), mostly along the slide, partly towards where it sits.
      const held = state.possession;
      if (held && state.players[held.player].role === 'keeper') return result; // a keeper's ball can't be tackled
      if (held && held.player !== p.id) loseBall(state);
      const tx = d > 1e-9 ? (ball.pos.x - p.pos.x) / d : Math.cos(p.facing);
      const ty = d > 1e-9 ? (ball.pos.y - p.pos.y) / d : Math.sin(p.facing);
      let kx = Math.cos(p.facing) * 0.6 + tx * 0.4;
      let ky = Math.sin(p.facing) * 0.6 + ty * 0.4;
      const kl = Math.hypot(kx, ky) || 1;
      kx /= kl;
      ky /= kl;
      ball.vel.x = kx * TACKLE_KNOCK_SPEED;
      ball.vel.y = ky * TACKLE_KNOCK_SPEED;
      p.touchTimer = KICK_TOUCH_LOCKOUT;
      p.tackleCooldown = Math.min(p.tackleCooldown, TACKLE_HIT_COOLDOWN); // a slide that wins the ball is forgiven
      result.touched = true;
    }
    return result;
  }

  // Shoot: hold to charge (capped), release to kick. Pass: press to kick at medium power. Either goes into the kick
  // buffer, aimed where the move keys point (else the facing), and fires the moment the player can kick the ball:
  // straight away if they have it, or when it arrives within KICK_BUFFER_TIME.
  p.kickQueue = Math.max(0, p.kickQueue - dt);
  if (input.shoot) p.charge = Math.min(SHOT_MAX_CHARGE_TIME, p.charge + dt);
  const shootReleased = !input.shoot && p.prevShoot;
  const passPressed = input.pass && !p.prevPass;
  if (passPressed || shootReleased) {
    const moving = Math.hypot(input.moveX, input.moveY) > 1e-6;
    p.kickQueue = KICK_BUFFER_TIME;
    p.queuedSpeed = passPressed ? PASS_SPEED : shotSpeed(p.charge);
    p.queuedShot = !passPressed;
    p.queuedAim = moving ? Math.atan2(input.moveY, input.moveX) : p.facing;
  }
  if (!input.shoot) p.charge = 0;
  if (p.kickQueue > 1e-9 && canKick(state, p)) {
    result.shot = p.queuedShot;
    kickBall(state, p, p.queuedSpeed, p.queuedAim);
    result.touched = true;
    return result;
  }

  // Classic dribble: a touch while running nudges the ball ahead; it then runs free until the next touch.
  if (DRIBBLE_MODE !== 'classic') return result;
  const speed = speedOf(p.vel);
  if (p.role !== 'keeper' && p.touchTimer === 0 && speed > 20 && d <= contact + DRIBBLE_REACH && d > 1e-9) {
    const dirX = p.vel.x / speed;
    const dirY = p.vel.y / speed;
    const toBallX = (ball.pos.x - p.pos.x) / d;
    const toBallY = (ball.pos.y - p.pos.y) / d;
    const angle = Math.acos(Math.max(-1, Math.min(1, dirX * toBallX + dirY * toBallY)));
    if (angle <= DRIBBLE_CONE) {
      const out = speed + DRIBBLE_BOOST;
      ball.vel.x = dirX * out;
      ball.vel.y = dirY * out;
      p.touchTimer = DRIBBLE_TOUCH_INTERVAL;
      result.touched = true;
    }
  }
  return result;
}
/** A shoot-button kick counts as a shot from the attacking end of the pitch, aimed roughly at goal (keepers never shoot). */
function countsAsShot(p: PlayerState, attackDir: number): boolean {
  if (p.role === 'keeper') return false;
  const goalX = attackDir > 0 ? PITCH_LEFT + PITCH_WIDTH : PITCH_LEFT;
  return Math.abs(goalX - p.pos.x) <= STAT_SHOT_RANGE && Math.cos(p.facing) * attackDir > STAT_SHOT_MIN_FORWARD;
}

/** Soft pushing: separate overlapping players (no overlap afterwards) and exchange a little momentum. */
function resolvePlayerCollisions(players: PlayerState[]): void {
  for (let iter = 0; iter < COLLISION_ITERATIONS; iter++) {
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        collideCircles(players[i], players[j], PLAYER_PLAYER_RESTITUTION, 1, 1);
      }
    }
    for (const p of players) collideWithBoundary(p, undefined, 1, 0);
  }
}

/** inputs[team] is that team's human input; teams without one (or players not controlled) use the AI. */
export function step(state: GameState, inputs: readonly (InputFrame | undefined)[], dt: number): GameState {
  const next = cloneState(state);
  const ball = next.ball;

  // Before kickoff, at half-time and at full time nothing moves; only the rules' timers run.
  if (isFrozen(next.phase)) {
    next.tick = state.tick + 1;
    updateRules(next, dt);
    return next;
  }

  applySwitching(next, inputs);
  // The AI produces InputFrames like a human would; a controlled player with no human input this tick is AI-driven.
  const human: [boolean, boolean] = [next.controlled[0] >= 0 && !!inputs[0], next.controlled[1] >= 0 && !!inputs[1]];
  const ai = computeAiInputs(next, human, dt);
  const used = next.players.map((p, i) => (human[p.team] && next.controlled[p.team] === p.id ? inputs[p.team]! : ai[i]));

  // When two players touch the ball in the same tick the later one wins, so alternate the order each tick
  // to keep contests fair between the teams (still deterministic).
  const order = next.players.map((_, i) => i);
  if (state.tick % 2 === 1) order.reverse();
  for (const i of order) {
    const p = next.players[i];
    const input = used[i];
    const kicking = (input.pass && !p.prevPass) || (!input.shoot && p.prevShoot);
    // Turning almost straight back at full speed loses the ball (unless the turn comes with a kick, which wins).
    if (next.possession?.player === p.id && !kicking && sharpTurnLosesBall(p, input)) loseBall(next);
    maybeStartTackle(next, p, input);
    const carrying = next.possession?.player === p.id;
    updatePlayer(p, input, dt, carrying ? DRIBBLE_SPEED_FACTOR : 1);
    if (carrying) advanceHold(next.possession!, p, dt, p.role === 'keeper' ? keeperHoldAngle(next, p) : p.facing);
    const touch = interactWithBall(next, p, input, dt);
    if (touch.touched) next.lastTouch = { team: p.team, player: p.id };
    if (touch.shot && countsAsShot(p, next.attackDir[p.team])) next.stats.shots[p.team] += 1;
    p.prevPass = input.pass;
    p.prevShoot = input.shoot;
    p.prevTackle = input.tackle;
  }
  resolvePlayerCollisions(next.players);
  // Sticky dribbling: body checks, taking control of a loose ball, and steering the held ball to its spot.
  updatePossession(next);

  if (!next.possession) applyRollingFriction(ball, dt);
  capSpeed(ball, BALL_MAX_SPEED);

  // Substep so a fast ball can never skip through a wall, post or player.
  const sticky = stickyDribbling();
  const maxMove = ball.radius * MAX_STEP_FRACTION;
  const substeps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil((speedOf(ball.vel) * dt) / maxMove)));
  const subDt = dt / substeps;
  for (let i = 0; i < substeps; i++) {
    moveCircle(ball, subDt);
    for (const p of next.players) {
      // The carrier's own body doesn't push the ball it holds, and a ball just kicked passes through the kicker.
      if (next.possession?.player === p.id || p.kickFlash > 0) continue;
      if (p.role === 'keeper') {
        // Keepers block: nearly dead bounce, barely moved by the ball, and the ball always leaves the goal.
        // Sticky: in the box a keeper catches what it can hold instead.
        const caught = sticky && !next.possession && canControl(next, p);
        if (caught && collideCircles(p, ball, 0, 0, 1)) {
          takePossession(next, p);
          ball.vel.x = p.vel.x;
          ball.vel.y = p.vel.y;
        } else if (collideCircles(p, ball, KEEPER_BALL_RESTITUTION, KEEPER_INV_MASS, 1)) {
          const dir = next.attackDir[p.team];
          if (ball.vel.x * dir < KEEPER_CLEAR_SPEED) ball.vel.x = dir * KEEPER_CLEAR_SPEED;
          next.lastTouch = { team: p.team, player: p.id };
        }
        continue;
      }
      // Sticky: a loose ball arriving slowly enough is controlled on contact; a faster one bounces off (and can't be
      // trapped straight after the bounce).
      const control = sticky && !next.possession && canControl(next, p);
      const tooFast = sticky && !control && relativeSpeed(p, ball) > controlSpeed(next, p);
      if (collideCircles(p, ball, PLAYER_BALL_RESTITUTION, 1, 1)) {
        next.lastTouch = { team: p.team, player: p.id };
        if (control) {
          takePossession(next, p);
          ball.vel.x = p.vel.x;
          ball.vel.y = p.vel.y;
        } else if (tooFast) p.touchTimer = Math.max(p.touchTimer, KICK_TOUCH_LOCKOUT);
      }
    }
    collideWithBoundary(ball, BALL_BOUNDARY, WALL_TANGENT_KEEP);
  }

  updateTouches(next);
  next.tick = state.tick + 1;
  updateRules(next, dt);
  return next;
}

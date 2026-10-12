// step(state, inputs, dt) -> state. The only way the game advances. Pure: returns a new state.
import {
  BALL_MAX_SPEED,
  BALL_RADIUS,
  DRIBBLE_BOOST,
  DRIBBLE_CONE,
  DRIBBLE_REACH,
  COLLISION_ITERATIONS,
  DRIBBLE_TOUCH_INTERVAL,
  KEEPER_BALL_RESTITUTION,
  KEEPER_CLEAR_SPEED,
  KEEPER_INV_MASS,
  KEEPER_RADIUS,
  KICKOFF_DELAY,
  PLAYERS_PER_TEAM,
  PLAYER_PLAYER_RESTITUTION,
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
  TACKLE_COOLDOWN,
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
import { isFrozen, updateRules } from './rules';
import type { BallState, Difficulty, GameState, InputFrame, MatchPhase, PlayerRole, PlayerState, TeamId } from './types';

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
    prevPass: false,
    prevShoot: false,
    prevTackle: false,
  };
}

export interface MatchOptions {
  /** No human on either team (spectate). Default: home is human-controlled. */
  aiVsAi?: boolean;
  /** AI difficulty per team (default from config.ts). */
  difficulty?: [Difficulty, Difficulty];
  /** Seed for the AI's random number generator. */
  seed?: number;
  /** Team that kicks off (default home). */
  kickoffTeam?: TeamId;
}

/**
 * A real match: two full teams in formation, in the pre-kickoff phase. Play starts after KICKOFF_DELAY with
 * the kickoff team on the centre spot. Team 0 (home) is human-controlled unless aiVsAi.
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
  // Home's human starts on its front-most outfield player; away has no human.
  const controlled: [number, number] = options.aiVsAi ? [-1, -1] : [PLAYERS_PER_TEAM - 1, -1];
  return {
    tick: 0,
    ball: { pos: { x: midX, y: midY }, vel: { x: 0, y: 0 }, radius: BALL_RADIUS },
    players,
    controlled,
    attackDir,
    lastTouch: null,
    prevSwitch: [false, false],
    ai: createAiState(players, controlled, options.difficulty, options.seed),
    phase: 'playing' as MatchPhase,
    phaseTimer: 0,
    half: 1,
    clock: 0,
    score: [0, 0],
    kickoffTeam: options.kickoffTeam ?? 0,
    firstKickoffTeam: options.kickoffTeam ?? 0,
    restart: null,
    events: [],
    nextEventId: 1,
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
    lastTouch: s.lastTouch ? { ...s.lastTouch } : null,
    prevSwitch: [s.prevSwitch[0], s.prevSwitch[1]],
    ai: cloneAiState(s.ai),
    phase: s.phase,
    phaseTimer: s.phaseTimer,
    half: s.half,
    clock: s.clock,
    score: [s.score[0], s.score[1]],
    kickoffTeam: s.kickoffTeam,
    firstKickoffTeam: s.firstKickoffTeam,
    restart: s.restart ? { ...s.restart, pos: { ...s.restart.pos } } : null,
    events: s.events.map((e) => ({ ...e, score: [e.score[0], e.score[1]] as [number, number] })),
    nextEventId: s.nextEventId,
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

/** Start a tackle if requested, off cooldown, and the player is not already on the ball. */
function maybeStartTackle(p: PlayerState, input: InputFrame, ball: BallState): void {
  const pressed = input.tackle && !p.prevTackle;
  if (!pressed || p.tackleTimer > 0 || p.tackleCooldown > 0) return;
  if (distance(p, ball) <= p.radius + ball.radius + KICK_REACH) return; // has the ball: shoot/pass instead
  if (Math.hypot(input.moveX, input.moveY) > 1e-6) p.facing = Math.atan2(input.moveY, input.moveX); // slide where steered
  p.tackleTimer = TACKLE_DURATION;
  p.tackleCooldown = TACKLE_COOLDOWN;
}

/** Movement, facing and timers for one player. Does not touch the ball. */
function updatePlayer(p: PlayerState, input: InputFrame, dt: number): void {
  p.tackleCooldown = Math.max(0, p.tackleCooldown - dt);
  p.touchTimer = Math.max(0, p.touchTimer - dt);

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
    approachVelocity(
      p.vel,
      mx * PLAYER_MAX_SPEED,
      my * PLAYER_MAX_SPEED,
      (hasMove ? PLAYER_ACCEL : PLAYER_DECEL) * dt,
    );
  }

  moveCircle(p, dt);
  collideWithBoundary(p, undefined, 1, 0);
}

function kickBall(p: PlayerState, ball: BallState, speed: number): void {
  ball.vel.x = Math.cos(p.facing) * speed + p.vel.x * KICK_PLAYER_VEL_FACTOR;
  ball.vel.y = Math.sin(p.facing) * speed + p.vel.y * KICK_PLAYER_VEL_FACTOR;
  p.touchTimer = KICK_TOUCH_LOCKOUT;
}

/** Charging, kicks, tackle knocks and dribble touches for one player. */
/** Returns true if the player touched the ball (kick, knock or dribble nudge). */
function interactWithBall(p: PlayerState, input: InputFrame, ball: BallState, dt: number): boolean {
  let touched = false;
  const d = distance(p, ball);
  const contact = p.radius + ball.radius;
  const sliding = p.tackleTimer > 0;

  if (sliding) {
    p.charge = 0;
    // A keeper's slide is a dive: it blocks the ball with its body (see step) rather than knocking it on.
    if (p.role !== 'keeper' && d <= contact + DRIBBLE_REACH && p.touchTimer === 0) {
      // Slide hits the ball: knock it away, mostly along the slide, partly towards where it sits.
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
      touched = true;
    }
    return touched;
  }

  // Shoot: hold to charge (capped), release to kick. Pass: press to kick at medium power.
  if (input.shoot) p.charge = Math.min(SHOT_MAX_CHARGE_TIME, p.charge + dt);
  const shootReleased = !input.shoot && p.prevShoot;
  const passPressed = input.pass && !p.prevPass;
  if (d <= contact + KICK_REACH) {
    if (passPressed) {
      kickBall(p, ball, PASS_SPEED);
      touched = true;
    } else if (shootReleased) {
      kickBall(p, ball, shotSpeed(p.charge));
      touched = true;
    }
  }
  if (!input.shoot) p.charge = 0;

  // Dribble: a touch while running nudges the ball ahead; it then runs free until the next touch.
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
      touched = true;
    }
  }
  return touched;
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
    maybeStartTackle(p, input, ball);
    updatePlayer(p, input, dt);
    if (interactWithBall(p, input, ball, dt)) next.lastTouch = { team: p.team, player: p.id };
    p.prevPass = input.pass;
    p.prevShoot = input.shoot;
    p.prevTackle = input.tackle;
  }
  resolvePlayerCollisions(next.players);

  applyRollingFriction(ball, dt);
  capSpeed(ball, BALL_MAX_SPEED);

  // Substep so a fast ball can never skip through a wall, post or player.
  const maxMove = ball.radius * MAX_STEP_FRACTION;
  const substeps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil((speedOf(ball.vel) * dt) / maxMove)));
  const subDt = dt / substeps;
  for (let i = 0; i < substeps; i++) {
    moveCircle(ball, subDt);
    for (const p of next.players) {
      if (p.role === 'keeper') {
        // Keepers block: nearly dead bounce, barely moved by the ball, and the ball always leaves the goal.
        if (collideCircles(p, ball, KEEPER_BALL_RESTITUTION, KEEPER_INV_MASS, 1)) {
          const dir = next.attackDir[p.team];
          if (ball.vel.x * dir < KEEPER_CLEAR_SPEED) ball.vel.x = dir * KEEPER_CLEAR_SPEED;
          next.lastTouch = { team: p.team, player: p.id };
        }
      } else {
        collideCircles(p, ball, PLAYER_BALL_RESTITUTION, 1, 1);
      }
    }
    collideWithBoundary(ball, BALL_BOUNDARY, WALL_TANGENT_KEEP);
  }

  updateTouches(next);
  next.tick = state.tick + 1;
  updateRules(next, dt);
  return next;
}

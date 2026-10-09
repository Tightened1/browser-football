// step(state, inputs, dt) -> state. The only way the game advances. Pure: returns a new state.
import {
  BALL_MAX_SPEED,
  BALL_RADIUS,
  DRIBBLE_BOOST,
  DRIBBLE_CONE,
  DRIBBLE_REACH,
  DRIBBLE_TOUCH_INTERVAL,
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
  collideWithBoundary,
  moveCircle,
  speedOf,
} from './physics';
import type { BallState, GameState, InputFrame, PlayerState, TeamId } from './types';

export const NEUTRAL_INPUT: InputFrame = {
  seq: 0,
  moveX: 0,
  moveY: 0,
  pass: false,
  shoot: false,
  tackle: false,
  switchPlayer: false,
};

export function createPlayer(id: number, team: TeamId, x: number, y: number): PlayerState {
  return {
    id,
    team,
    pos: { x, y },
    vel: { x: 0, y: 0 },
    radius: PLAYER_RADIUS,
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

export function createInitialState(): GameState {
  const midX = PITCH_LEFT + PITCH_WIDTH / 2;
  const midY = PITCH_TOP + PITCH_HEIGHT / 2;
  return {
    tick: 0,
    ball: {
      pos: { x: midX, y: midY },
      vel: { x: 0, y: 0 },
      radius: BALL_RADIUS,
    },
    players: [createPlayer(0, 0, midX - 150, midY)],
  };
}

export function cloneState(s: GameState): GameState {
  return {
    tick: s.tick,
    ball: { pos: { ...s.ball.pos }, vel: { ...s.ball.vel }, radius: s.ball.radius },
    players: s.players.map((p) => ({ ...p, pos: { ...p.pos }, vel: { ...p.vel } })),
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
function interactWithBall(p: PlayerState, input: InputFrame, ball: BallState, dt: number): void {
  const d = distance(p, ball);
  const contact = p.radius + ball.radius;
  const sliding = p.tackleTimer > 0;

  if (sliding) {
    p.charge = 0;
    if (d <= contact + DRIBBLE_REACH && p.touchTimer === 0) {
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
    }
    return;
  }

  // Shoot: hold to charge (capped), release to kick. Pass: press to kick at medium power.
  if (input.shoot) p.charge = Math.min(SHOT_MAX_CHARGE_TIME, p.charge + dt);
  const shootReleased = !input.shoot && p.prevShoot;
  const passPressed = input.pass && !p.prevPass;
  if (d <= contact + KICK_REACH) {
    if (passPressed) kickBall(p, ball, PASS_SPEED);
    else if (shootReleased) kickBall(p, ball, shotSpeed(p.charge));
  }
  if (!input.shoot) p.charge = 0;

  // Dribble: a touch while running nudges the ball ahead; it then runs free until the next touch.
  const speed = speedOf(p.vel);
  if (p.touchTimer === 0 && speed > 20 && d <= contact + DRIBBLE_REACH && d > 1e-9) {
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
    }
  }
}

export function step(state: GameState, inputs: readonly InputFrame[], dt: number): GameState {
  const next = cloneState(state);
  const ball = next.ball;

  next.players.forEach((p, i) => {
    const input = inputs[i] ?? NEUTRAL_INPUT;
    maybeStartTackle(p, input, ball);
    updatePlayer(p, input, dt);
    interactWithBall(p, input, ball, dt);
    p.prevPass = input.pass;
    p.prevShoot = input.shoot;
    p.prevTackle = input.tackle;
  });

  applyRollingFriction(ball, dt);
  capSpeed(ball, BALL_MAX_SPEED);

  // Substep so a fast ball can never skip through a wall, post or player.
  const maxMove = ball.radius * MAX_STEP_FRACTION;
  const substeps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil((speedOf(ball.vel) * dt) / maxMove)));
  const subDt = dt / substeps;
  for (let i = 0; i < substeps; i++) {
    moveCircle(ball, subDt);
    for (const p of next.players) collideCircles(p, ball, PLAYER_BALL_RESTITUTION, 0, 1);
    collideWithBoundary(ball, undefined, WALL_TANGENT_KEEP);
  }

  next.tick = state.tick + 1;
  return next;
}

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
  KEEPER_PARRY_WIDE_MARGIN,
  KEEPER_INV_MASS,
  KEEPER_RADIUS,
  HALF_LENGTH_SECONDS,
  KICKOFF_DELAY,
  PLAYERS_PER_TEAM,
  PLAYER_PLAYER_RESTITUTION,
  KICK_BUFFER_TIME,
  KICK_FLASH_TIME,
  KICK_AGE_MAX,
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
  FINESSE_SPEED,
  FEINT_SPEED,
  SHIELD_SPEED_FACTOR,
  SPRINT_DRAIN,
  SPRINT_RECOVER,
  SPRINT_RESUME,
  SPRINT_SPEED_FACTOR,
  STAT_SHOT_MIN_FORWARD,
  WINDUP_SPEED_FACTOR,

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
  boundaryFor,
  collideWithBoundary,
  moveCircle,
  speedOf,
} from './physics';
import { cloneAiState, computeAiInputs, createAiState, formationPosition } from './ai';
import { applySwitching, updateTouches } from './control';
import {
  advanceHold,
  canControl,
  controlSpeed,
  holdTarget,
  loseBall,
  recordDuel,
  relativeSpeed,
  sharpTurnLosesBall,
  shieldBlocksSlide,
  startFeint,
  stickyDribbling,
  takePossession,
  updatePossession,
} from './dribble';
import { awardFoul, isFrozen, updateRules } from './rules';
import { detectFoul } from './fouls';
import { pendingHeldRestart, pendingPenalty, restartAim, takeHeldRestart } from './setpiece';
import { CLASSIC_RULES, copyRules } from './matchRules';
import { assistAim, curlBall, finesseShot, shotSpeed } from './shooting';
import { defendingProfile } from './matchRules';
import type { Boundary } from './physics';
import type { BallState, Difficulty, GameState, InputFrame, MatchPhase, MatchRules, MatchStats, PlayerRole, PlayerState, TeamId } from './types';

export { shotSpeed };

export const NEUTRAL_INPUT: InputFrame = {
  seq: 0,
  moveX: 0,
  moveY: 0,
  pass: false,
  shoot: false,
  tackle: false,
  switchPlayer: false,
  sprint: false,
  shield: false,
  feint: false,
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
    queuedFinesse: false,
    shootSpent: false,
    kickFlash: 0,
    prevPass: false,
    prevShoot: false,
    prevTackle: false,
    prevFeint: false,
    windup: 0,
    standCooldown: 0,
    stamina: 1,
    sprintLock: false,
    sprinting: false,
    shielding: false,
    feintTimer: 0,
    feintCooldown: 0,
    slideBall: false,
    slideJudged: false,
    slideVictim: -1,
    slideContactTick: 0,
    slideSpotX: 0,
    slideSpotY: 0,
    kickAge: KICK_AGE_MAX,
    yellow: 0,
    sentOff: false,
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
  /** Match rules (T15). Default: classic (the game before T15). */
  rules?: MatchRules;
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
    rules: copyRules(options.rules ?? CLASSIC_RULES),
    ball: { pos: { x: midX, y: midY }, vel: { x: 0, y: 0 }, radius: BALL_RADIUS, spin: 0 },
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
    grace: null,
    events: [],
    nextEventId: 1,
    stats: { shots: [0, 0], possession: [0, 0], goals: [], fouls: [0, 0], cards: [], penalties: [], shootout: null },
    penalty: null,
    shootout: null,
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
    rules: s.rules, // fixed for the match, never changed
    ball: { pos: { ...s.ball.pos }, vel: { ...s.ball.vel }, radius: s.ball.radius, spin: s.ball.spin ?? 0 },
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
    restart: s.restart ? { ...s.restart, pos: { ...s.restart.pos }, wall: s.restart.wall ? [...s.restart.wall] : undefined } : null,
    grace: s.grace ? { ...s.grace, pos: { ...s.grace.pos } } : null,
    events: s.events.map((e) => ({ ...e, score: [e.score[0], e.score[1]] as [number, number] })),
    nextEventId: s.nextEventId,
    stats: cloneStats(s.stats),
    penalty: s.penalty ? { ...s.penalty } : null,
    shootout: s.shootout ? { ...s.shootout, kicks: [...s.shootout.kicks] } : null,
  };
}

export function cloneStats(st: MatchStats): MatchStats {
  return {
    shots: [st.shots[0], st.shots[1]],
    possession: [st.possession[0], st.possession[1]],
    goals: st.goals.map((g) => ({ ...g })),
    fouls: [st.fouls[0], st.fouls[1]],
    cards: st.cards.map((c) => ({ ...c })),
    penalties: st.penalties.map((x) => ({ ...x })),
    shootout: st.shootout ? { ...st.shootout, kicks: [...st.shootout.kicks] } : null,
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

/** What players bump into, and what the ball bounces off (no touchlines), for the match's goal width. */
export const playerBoundary = (rules: MatchRules): Boundary => boundaryFor(rules.goalWidth, false);
export const ballBoundary = (rules: MatchRules): Boundary => boundaryFor(rules.goalWidth, true);

function distance(a: { pos: { x: number; y: number } }, b: { pos: { x: number; y: number } }): number {
  return Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y);
}

/** An AI slide started within this distance (px) of an opposing carrier counts as a challenge on them (duel counters). */
const DUEL_RANGE = 150;

/** True if `p` may kick the ball now: it carries it (sticky), or the ball is loose and within KICK_REACH. */
export function canKick(state: GameState, p: PlayerState): boolean {
  if (p.tackleTimer > 0 || p.windup > 0) return false;
  const poss = state.possession;
  if (poss) return poss.player === p.id;
  return distance(p, state.ball) <= p.radius + state.ball.radius + KICK_REACH;
}

/**
 * Start a tackle if requested, off cooldown, and the player is not already on the ball. An AI outfield player's slide at
 * a human carrier is telegraphed (T17): it winds up first (the rules' DefendingProfile.windup), committed to the
 * direction it chose (see updatePlayer).
 */
function maybeStartTackle(state: GameState, p: PlayerState, input: InputFrame, humanDriven: readonly boolean[]): void {
  const pressed = input.tackle && !p.prevTackle;
  if (!pressed || p.tackleTimer > 0 || p.windup > 0 || p.tackleCooldown > 0) return;
  if (canKick(state, p)) return; // has the ball: shoot/pass instead
  if (Math.hypot(input.moveX, input.moveY) > 1e-6) p.facing = Math.atan2(input.moveY, input.moveX); // slide where steered
  const held = state.possession;
  const c = held ? state.players[held.player] : null;
  const atHuman = !!c && c.team !== p.team && !!humanDriven[c.id];
  const windup = p.role !== 'keeper' && !humanDriven[p.id] && atHuman ? defendingProfile(state.rules, true).windup : 0;
  p.slideBall = false; // a new slide, for the referee (T19)
  p.slideJudged = false;
  p.slideVictim = -1;
  if (windup > 0) p.windup = windup;
  else p.tackleTimer = TACKLE_DURATION;
  p.tackleCooldown = (p.role === 'keeper' ? KEEPER_DIVE_COOLDOWN : TACKLE_COOLDOWN) + windup;
  p.kickQueue = 0; // a slide replaces any queued kick
  if (c && c.team !== p.team && p.role !== 'keeper' && !humanDriven[p.id] && distance(p, c) < DUEL_RANGE) recordDuel(state, p.team, !!humanDriven[c.id], true, false);
}

/**
 * Sprint and shield for this tick (T17): who is shielding (carrying, shield held) and sprinting (moving with sprint held,
 * not shielding, stamina left), and the stamina drained or recovered. Returns the top-speed factor they give.
 */
function updateSprint(p: PlayerState, input: InputFrame, dt: number, carrying: boolean, moving: boolean): number {
  const busy = p.tackleTimer > 0 || p.windup > 0;
  p.shielding = carrying && !!input.shield && !busy;
  if (p.stamina <= 0) p.sprintLock = true;
  else if (p.sprintLock && p.stamina >= SPRINT_RESUME) p.sprintLock = false;
  p.sprinting = !!input.sprint && moving && !p.shielding && !p.sprintLock && !busy;
  p.stamina = Math.max(0, Math.min(1, p.stamina + (p.sprinting ? -SPRINT_DRAIN : SPRINT_RECOVER) * dt));
  return (p.sprinting ? SPRINT_SPEED_FACTOR : 1) * (p.shielding ? SHIELD_SPEED_FACTOR : 1);
}

/**
 * Movement, facing and timers for one player. Does not touch the ball or other players. A player `carrying` the ball
 * runs at DRIBBLE_SPEED_FACTOR; sprinting, shielding and feinting change the top speed (T17), and an AI slide's wind-up
 * turns into the slide here.
 * Exported for the online guest's prediction of its own player (net/client.ts).
 */
export function updatePlayer(p: PlayerState, input: InputFrame, dt: number, carrying = false, boundary?: Boundary): void {
  p.tackleCooldown = Math.max(0, p.tackleCooldown - dt);
  p.touchTimer = Math.max(0, p.touchTimer - dt);
  p.kickFlash = Math.max(0, p.kickFlash - dt);
  p.standCooldown = Math.max(0, p.standCooldown - dt);
  p.feintTimer = Math.max(0, p.feintTimer - dt);
  p.feintCooldown = Math.max(0, p.feintCooldown - dt);
  p.kickAge = Math.min(KICK_AGE_MAX, p.kickAge + dt);
  if (p.windup > 0) {
    p.windup = Math.max(0, p.windup - dt);
    if (p.windup === 0) p.tackleTimer = TACKLE_DURATION; // wound up: the slide goes, the way it was aimed
  }

  let mx = input.moveX;
  let my = input.moveY;
  const mlen = Math.hypot(mx, my);
  if (mlen > 1) {
    mx /= mlen;
    my /= mlen;
  }
  const hasMove = mlen > 1e-6;
  const speedFactor = (carrying ? DRIBBLE_SPEED_FACTOR : 1) * updateSprint(p, input, dt, carrying, hasMove);

  if (p.tackleTimer > 0) {
    // Sliding: committed to the facing direction, decaying speed, steering ignored.
    p.tackleTimer = Math.max(0, p.tackleTimer - dt);
    const k = 0.35 + 0.65 * (p.tackleTimer / TACKLE_DURATION);
    p.vel.x = Math.cos(p.facing) * TACKLE_SPEED * k;
    p.vel.y = Math.sin(p.facing) * TACKLE_SPEED * k;
  } else if (p.windup > 0) {
    // Winding up a slide: crouched, committed to its direction, drifting on slowly (the telegraph a human can read).
    const top = PLAYER_MAX_SPEED * WINDUP_SPEED_FACTOR;
    approachVelocity(p.vel, Math.cos(p.facing) * top, Math.sin(p.facing) * top, PLAYER_DECEL * dt);
  } else {
    if (hasMove) p.facing = Math.atan2(my, mx);
    let top = PLAYER_MAX_SPEED * speedFactor;
    if (p.feintTimer > 0) top = Math.max(top, FEINT_SPEED); // the feint's side-step
    approachVelocity(p.vel, mx * top, my * top, (hasMove ? PLAYER_ACCEL : PLAYER_DECEL) * dt);
  }

  moveCircle(p, dt);
  collideWithBoundary(p, boundary, 1, 0);
}

/** Strike the ball at `speed` towards `aim` (radians), plus some of the kicker's own velocity, with optional curl. */
function kickBall(state: GameState, p: PlayerState, speed: number, aim: number, spin = 0): void {
  const { ball } = state;
  if (state.possession?.player === p.id) state.possession = null;
  p.facing = aim;
  ball.vel.x = Math.cos(aim) * speed + p.vel.x * KICK_PLAYER_VEL_FACTOR;
  ball.vel.y = Math.sin(aim) * speed + p.vel.y * KICK_PLAYER_VEL_FACTOR;
  ball.spin = spin;
  p.touchTimer = KICK_TOUCH_LOCKOUT;
  p.kickFlash = KICK_FLASH_TIME;
  p.kickQueue = 0;
  p.kickAge = 0;
}

/**
 * Charging, kicks (through the kick buffer), tackle knocks and classic dribble touches for one player.
 * Returns whether the player touched the ball, and whether that touch was a shoot-button kick.
 */
function interactWithBall(state: GameState, p: PlayerState, input: InputFrame, dt: number, humanDriven: readonly boolean[]): { touched: boolean; shot: boolean } {
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
      if (held && held.player !== p.id) {
        const c = state.players[held.player];
        if (c.team !== p.team && shieldBlocksSlide(state, c, p)) {
          // Into a shielding carrier from behind or the side: the slide is stopped by the body (T17).
          p.tackleTimer = 0;
          p.vel.x *= 0.2;
          p.vel.y *= 0.2;
          p.touchTimer = KICK_TOUCH_LOCKOUT;
          return result;
        }
        if (c.team !== p.team && !humanDriven[p.id]) recordDuel(state, p.team, !!humanDriven[c.id], false, true);
        loseBall(state);
      }
      const tx = d > 1e-9 ? (ball.pos.x - p.pos.x) / d : Math.cos(p.facing);
      const ty = d > 1e-9 ? (ball.pos.y - p.pos.y) / d : Math.sin(p.facing);
      let kx = Math.cos(p.facing) * 0.6 + tx * 0.4;
      let ky = Math.sin(p.facing) * 0.6 + ty * 0.4;
      const kl = Math.hypot(kx, ky) || 1;
      kx /= kl;
      ky /= kl;
      ball.vel.x = kx * TACKLE_KNOCK_SPEED;
      ball.vel.y = ky * TACKLE_KNOCK_SPEED;
      p.slideBall = true; // got the ball first (T19)
      p.touchTimer = KICK_TOUCH_LOCKOUT;
      p.tackleCooldown = Math.min(p.tackleCooldown, TACKLE_HIT_COOLDOWN); // a slide that wins the ball is forgiven
      result.touched = true;
    }
    return result;
  }

  // Shoot: hold to charge (capped), release to kick. Pass: press to kick at medium power. Either goes into the kick
  // buffer, aimed where the move keys point (else the facing), and fires the moment the player can kick the ball:
  // straight away if they have it, or when it arrives within KICK_BUFFER_TIME. Shots get the aim assist (rules.aimAssist).
  // Finesse (rules.finesse): tapping pass while holding shoot queues a curled, placed shot; releasing shoot then does nothing.
  const rules = state.rules;
  p.kickQueue = Math.max(0, p.kickQueue - dt);
  if (input.shoot && !p.shootSpent) p.charge = Math.min(rules.shotChargeTime, p.charge + dt);
  const shootReleased = !input.shoot && p.prevShoot && !p.shootSpent;
  const passPressed = input.pass && !p.prevPass;
  const finesse = rules.finesse && passPressed && input.shoot && !p.shootSpent;
  if (passPressed || shootReleased) {
    const moving = Math.hypot(input.moveX, input.moveY) > 1e-6;
    p.kickQueue = KICK_BUFFER_TIME;
    p.queuedSpeed = finesse ? FINESSE_SPEED : passPressed ? PASS_SPEED : shotSpeed(p.charge, rules.shotChargeTime);
    p.queuedShot = finesse || !passPressed;
    p.queuedFinesse = finesse;
    p.queuedAim = moving ? Math.atan2(input.moveY, input.moveX) : p.facing;
    if (finesse) {
      p.shootSpent = true;
      p.charge = 0;
    }
  }
  if (!input.shoot) {
    p.charge = 0;
    p.shootSpent = false;
  }
  if (p.kickQueue > 1e-9 && canKick(state, p)) {
    result.shot = p.queuedShot;
    const r = state.restart;
    if (r && r.taker === p.id) {
      // A kicked set piece (goal kick, kickoff) always goes into the pitch.
      kickBall(state, p, p.queuedSpeed, restartAim(r, { moveX: Math.cos(p.queuedAim), moveY: Math.sin(p.queuedAim) }, p.facing));
    } else if (p.queuedFinesse) {
      const f = finesseShot(state, p.team, state.ball.pos, p.queuedAim);
      kickBall(state, p, p.queuedSpeed, f.aim, f.spin);
    } else {
      kickBall(state, p, p.queuedSpeed, p.queuedShot ? assistAim(state, p.team, state.ball.pos, p.queuedAim) : p.queuedAim);
    }
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

/**
 * A keeper's touch sends the ball behind its own goal line (dir: the keeper's attacking direction) clear of the goal:
 * where it crosses the line it is more than KEEPER_PARRY_WIDE_MARGIN outside a post.
 */
function parriedWide(state: GameState, ball: BallState, dir: number): boolean {
  if (ball.vel.x * dir >= 0) return false; // not heading for the goal line
  const lineX = dir > 0 ? PITCH_LEFT : PITCH_LEFT + PITCH_WIDTH;
  const y = ball.pos.y + (ball.vel.y * (lineX - ball.pos.x)) / ball.vel.x;
  return Math.abs(y - (PITCH_TOP + PITCH_HEIGHT / 2)) > state.rules.goalWidth / 2 + KEEPER_PARRY_WIDE_MARGIN;
}

/** Soft pushing: separate overlapping players (no overlap afterwards) and exchange a little momentum. (Not sent-off ones: they are off the pitch.) */
function resolvePlayerCollisions(all: PlayerState[], boundary: Boundary): void {
  const players = all.filter((p) => !p.sentOff);
  for (let iter = 0; iter < COLLISION_ITERATIONS; iter++) {
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        collideCircles(players[i], players[j], PLAYER_PLAYER_RESTITUTION, 1, 1);
      }
    }
    for (const p of players) collideWithBoundary(p, boundary, 1, 0);
  }
}

/**
 * At a penalty (T19) everyone but the taker and the keeper facing it waits where they were put, still; in a shoot-out
 * the taker waits too once the kick is struck, and between kicks everyone does.
 */
function waitsAtPenalty(state: GameState, p: PlayerState): boolean {
  const r = pendingPenalty(state);
  if (state.phase !== 'shootout') return !!r && p.id !== r.taker && !(p.role === 'keeper' && p.team !== r.team);
  const team = r ? r.team : state.penalty ? state.penalty.team : -1;
  if (team < 0) return true;
  if (r && p.id === r.taker) return false;
  return !(p.role === 'keeper' && p.team !== team);
}

/** Before a penalty is struck the keeper stays on its line: it may only dive (move + tackle), not walk. */
function keeperOnLine(state: GameState, p: PlayerState, input: InputFrame): InputFrame {
  const r = pendingPenalty(state);
  if (!r || p.role !== 'keeper' || p.team === r.team || p.tackleTimer > 0) return input;
  return input.tackle && !p.prevTackle ? input : { ...input, moveX: 0, moveY: 0 };
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

  // (No switching away from a penalty taker or keeper while a penalty is on.)
  if (!pendingPenalty(next) && !next.penalty && next.phase !== 'shootout') applySwitching(next, inputs);
  // The AI produces InputFrames like a human would; a controlled player with no human input this tick is AI-driven.
  const human: [boolean, boolean] = [next.controlled[0] >= 0 && !!inputs[0], next.controlled[1] >= 0 && !!inputs[1]];
  const ai = computeAiInputs(next, human, dt);
  const humanDriven = next.players.map((p) => human[p.team] && next.controlled[p.team] === p.id);
  const used = next.players.map((p, i) => (humanDriven[i] ? inputs[p.team]! : ai[i]));

  // When two players touch the ball in the same tick the later one wins, so alternate the order each tick
  // to keep contests fair between the teams (still deterministic).
  const order = next.players.map((_, i) => i);
  if (state.tick % 2 === 1) order.reverse();
  for (const i of order) {
    const p = next.players[i];
    const input = keeperOnLine(next, p, used[i]);
    if (p.sentOff || waitsAtPenalty(next, p)) {
      // Off the pitch (sent off), or waiting for a penalty to be taken (T19).
      p.vel = { x: 0, y: 0 };
      p.prevPass = input.pass;
      p.prevShoot = input.shoot;
      p.prevTackle = input.tackle;
      p.prevFeint = !!input.feint;
      continue;
    }
    if (pendingHeldRestart(next)?.taker === p.id) {
      // A throw-in is thrown, a corner crossed and a free kick or penalty struck, not dribbled: the taker stands still,
      // aims and plays it (sim/setpiece.ts).
      const played = takeHeldRestart(next, p, input, dt);
      if (played !== 'none') next.lastTouch = { team: p.team, player: p.id };
      // (A shoot-out kick is not a match shot.)
      if (played === 'shot' && next.phase === 'playing' && countsAsShot(p, next.attackDir[p.team])) next.stats.shots[p.team] += 1;
      p.prevPass = input.pass;
      p.prevShoot = input.shoot;
      p.prevTackle = input.tackle;
      p.prevFeint = !!input.feint;
      continue;
    }
    const kicking = (input.pass && !p.prevPass) || (!input.shoot && p.prevShoot);
    // A double-tapped move key with the ball: the feint / drag-back (T17).
    if (next.possession?.player === p.id && input.feint && !p.prevFeint) startFeint(next.possession, p, input);
    // Turning almost straight back at full speed loses the ball (unless the turn comes with a kick, which wins).
    if (next.possession?.player === p.id && !kicking && sharpTurnLosesBall(p, input)) loseBall(next);
    maybeStartTackle(next, p, input, humanDriven);
    const carrying = next.possession?.player === p.id;
    updatePlayer(p, input, dt, carrying, playerBoundary(next.rules));
    if (carrying) advanceHold(next.possession!, p, dt, holdTarget(next, p));
    const touch = interactWithBall(next, p, input, dt, humanDriven);
    if (touch.touched) next.lastTouch = { team: p.team, player: p.id };
    if (touch.shot && countsAsShot(p, next.attackDir[p.team])) next.stats.shots[p.team] += 1;
    p.prevPass = input.pass;
    p.prevShoot = input.shoot;
    p.prevTackle = input.tackle;
    p.prevFeint = !!input.feint;
  }
  // The referee (T19): a slide into the player before the ball or from behind, or a clearly late challenge, is a foul.
  const foul = detectFoul(next);
  if (foul) awardFoul(next, foul);
  resolvePlayerCollisions(next.players, playerBoundary(next.rules));
  // Sticky dribbling: body checks, taking control of a loose ball, and steering the held ball to its spot.
  updatePossession(next, humanDriven);

  if (!next.possession) applyRollingFriction(ball, dt);
  capSpeed(ball, BALL_MAX_SPEED);

  // A throw-in or corner not yet taken: the ball stays on its spot (in the taker's hands / at their feet); players can't move it.
  const held = pendingHeldRestart(next);
  if (held) {
    ball.pos = { ...held.pos };
    ball.vel = { x: 0, y: 0 };
    for (const p of next.players) if (p.id !== held.taker && !p.sentOff) collideCircles(p, ball, 0, 1, 0);
    updateTouches(next);
    next.tick = state.tick + 1;
    updateRules(next, dt);
    return next;
  }

  // Substep so a fast ball can never skip through a wall, post or player. A curled ball turns first; any contact ends the curl.
  if (!next.possession) curlBall(ball, dt);
  else ball.spin = 0;
  const bounds = ballBoundary(next.rules);
  const sticky = stickyDribbling();
  const maxMove = ball.radius * MAX_STEP_FRACTION;
  const substeps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil((speedOf(ball.vel) * dt) / maxMove)));
  const subDt = dt / substeps;
  for (let i = 0; i < substeps; i++) {
    moveCircle(ball, subDt);
    for (const p of next.players) {
      // The carrier's own body doesn't push the ball it holds, and a ball just kicked passes through the kicker.
      if (next.possession?.player === p.id || p.kickFlash > 0 || p.sentOff) continue;
      if (p.role === 'keeper') {
        // Keepers block: nearly dead bounce, barely moved by the ball, and the ball always leaves the goal.
        // Sticky: in the box a keeper catches what it can hold instead.
        const caught = sticky && !next.possession && canControl(next, p);
        if (caught && collideCircles(p, ball, 0, 0, 1)) {
          ball.spin = 0;
          takePossession(next, p);
          ball.vel.x = p.vel.x;
          ball.vel.y = p.vel.y;
        } else if (collideCircles(p, ball, KEEPER_BALL_RESTITUTION, KEEPER_INV_MASS, 1)) {
          ball.spin = 0;
          const dir = next.attackDir[p.team];
          // Pushed out of the goal -- unless the save turns it behind, wide of the posts (a corner, T16).
          if (ball.vel.x * dir < KEEPER_CLEAR_SPEED && !parriedWide(next, ball, dir)) ball.vel.x = dir * KEEPER_CLEAR_SPEED;
          next.lastTouch = { team: p.team, player: p.id };
        }
        continue;
      }
      // Sticky: a loose ball arriving slowly enough is controlled on contact; a faster one bounces off (and can't be
      // trapped straight after the bounce).
      const control = sticky && !next.possession && canControl(next, p);
      const tooFast = sticky && !control && relativeSpeed(p, ball) > controlSpeed(next, p);
      if (collideCircles(p, ball, PLAYER_BALL_RESTITUTION, 1, 1)) {
        ball.spin = 0;
        next.lastTouch = { team: p.team, player: p.id };
        if (control) {
          takePossession(next, p);
          ball.vel.x = p.vel.x;
          ball.vel.y = p.vel.y;
        } else if (tooFast) p.touchTimer = Math.max(p.touchTimer, KICK_TOUCH_LOCKOUT);
      }
    }
    if (collideWithBoundary(ball, bounds, WALL_TANGENT_KEEP)) ball.spin = 0;
  }

  updateTouches(next);
  next.tick = state.tick + 1;
  updateRules(next, dt);
  return next;
}

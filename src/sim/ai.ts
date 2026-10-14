// AI decisions -> InputFrames. Pure TypeScript: reads the GameState, writes only state.ai (its own memory and
// seeded RNG) and returns one InputFrame per player, exactly what a keyboard would produce. It never moves
// players or the ball directly, so an AI player can do nothing a human couldn't.
//
// Layers, top to bottom:
//   1. analyse()        who has the ball, where it is going, who can reach it first
//   2. updateTeams()    team mode: attacking / defending / transitioning
//   3. decisions        each player re-thinks every `reactionTime` seconds and picks an intent
//                       (support, run, press, mark, dribble, pass, shoot, save, ...)
//   4. steering         every tick the intent is turned into an InputFrame (move + buttons)
import {
  AI_ATT_AHEAD_OF_BALL,
  AI_DANGER_ZONE,
  AI_DEF_BEHIND_BALL,
  AI_DEF_MAX_ADVANCE,
  AI_DEADZONE,
  AI_DIFFICULTY,
  AI_EDGE_MARGIN,
  AI_GOAL_MOUTH_DEPTH,
  AI_GOAL_MOUTH_MARGIN,
  AI_OWN_GOAL_DANGER,
  AI_KEEPER_MAX_OUT,
  AI_KEEPER_RUSH_RANGE,
  AI_KICK_TIMEOUT,
  AI_LANE_GROWTH,
  AI_LANE_WIDTH,
  AI_MARK_DISTANCE_ATT,
  AI_MARK_DISTANCE_DEF,
  AI_MIN_SHOT_ANGLE,
  AI_PASS_MAX,
  AI_PASS_MIN,
  AI_PASS_TO_HUMAN_BONUS,
  AI_POSSESSION_SLACK,
  AI_PREDICT_HORIZON,
  AI_PREDICT_STEP,
  AI_PRESS_ENGAGE,
  AI_PRESS_OFFSET,
  AI_PRESSURE_RADIUS,
  AI_QUICK_SHOT_CHARGE,
  AI_PROFILES,
  AI_RUN_CHANCE,
  AI_RUN_TIME,
  AI_SEED,
  AI_SEPARATION,
  AI_SHAPE_SPEED,
  AI_SHOOT_RANGE,
  AI_SHOT_DETECT_SPEED,
  AI_SHOT_DETECT_TIME,
  AI_SPACE_SEARCH_RADIUS,
  AI_TACKLE_RANGE,
  AI_TEAMMATE_DIFFICULTY,
  AI_TRANSITION_TIME,
  BALL_DRAG,
  BALL_FRICTION,
  BALL_RADIUS,
  BALL_STOP_SPEED,
  DRIBBLE_SHARP_TURN_ANGLE,
  FORMATION,
  GOAL_WIDTH,
  KEEPER_LINE_OFFSET,
  KICK_PLAYER_VEL_FACTOR,
  KICK_REACH,
  KICK_FLASH_TIME,
  PASS_SPEED,
  THROW_LONG_MAX_SPEED,
  THROW_SHORT_SPEED,
  PENALTY_BOX_HEIGHT,
  PITCH_BOTTOM,
  PITCH_HEIGHT,
  PITCH_LEFT,
  PITCH_RIGHT,
  PITCH_TOP,
  PITCH_WIDTH,
  PLAYER_MAX_SPEED,
  SHOT_MAX_CHARGE_TIME,
  SHOT_MAX_SPEED,
  SHOT_MIN_SPEED,
  SIM_DT,
  TACKLE_DURATION,
  TACKLE_SPEED,
  WALL_RESTITUTION,
  type AiProfile,
} from '../config';
import { angleDiff, CARRY_SPEED } from './dribble';
import { kickSpeedForDistance } from './physics';
import { inwardDirection, pendingThrowIn, restartTarget, throwChargeFor } from './setpiece';
import type {
  AiIntent,
  AiPlayerMemory,
  AiRole,
  AiState,
  AiTeamMemory,
  Difficulty,
  BallState,
  GameState,
  InputFrame,
  PlayerState,
  TeamId,
  Vec2,
} from './types';

/* ------------------------------------------------------------------------------------------------
 * Small helpers
 * ---------------------------------------------------------------------------------------------- */

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const dist = (a: Vec2, b: Vec2): number => Math.hypot(b.x - a.x, b.y - a.y);
const MID_Y = PITCH_TOP + PITCH_HEIGHT / 2;

function unit(x: number, y: number): Vec2 {
  const l = Math.hypot(x, y);
  return l > 1e-9 ? { x: x / l, y: y / l } : { x: 0, y: 0 };
}

function clampToPitch(v: Vec2, margin = AI_EDGE_MARGIN): Vec2 {
  return { x: clamp(v.x, PITCH_LEFT + margin, PITCH_RIGHT - margin), y: clamp(v.y, PITCH_TOP + margin, PITCH_BOTTOM - margin) };
}

const IDLE: InputFrame = { seq: 0, moveX: 0, moveY: 0, pass: false, shoot: false, tackle: false, switchPlayer: false };

/** Seeded PRNG (mulberry32) stored in the state: returns [0, 1) and advances ai.rng. */
export function nextRandom(ai: AiState): number {
  let t = (ai.rng = (ai.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** A decision interval around `base` (±30%), so players don't all think on the same tick. */
function jitter(ai: AiState, base: number): number {
  return base * (0.7 + 0.6 * nextRandom(ai));
}

/* ------------------------------------------------------------------------------------------------
 * Geometry of the pitch, per team
 * ---------------------------------------------------------------------------------------------- */

/** X of the goal line a team defends. */
export function ownGoalX(attackDir: number): number {
  return attackDir > 0 ? PITCH_LEFT : PITCH_RIGHT;
}

/** Distance of a point from a team's own goal line, measured along the pitch. */
function along(x: number, attackDir: number): number {
  return (x - ownGoalX(attackDir)) * attackDir;
}

/** Formation spot for a slot (0 = keeper) for a team attacking in `attackDir`. */
export function formationPosition(slot: number, attackDir: number): Vec2 {
  if (slot === 0) return { x: ownGoalX(attackDir) + attackDir * KEEPER_LINE_OFFSET, y: MID_Y };
  const f = FORMATION[slot - 1];
  return { x: ownGoalX(attackDir) + attackDir * f.fx * PITCH_WIDTH, y: PITCH_TOP + f.fy * PITCH_HEIGHT };
}

/** Keeper, defenders (slots 1-2) or attackers (slots 3-4). */
export function roleOf(p: PlayerState): AiRole {
  if (p.role === 'keeper') return 'keeper';
  return p.slot <= 2 ? 'defender' : 'attacker';
}

export function profileOf(state: GameState, team: TeamId): AiProfile {
  return AI_PROFILES[state.ai.difficulty[team]];
}

/** Angle (radians) the goal mouth covers, seen from `pos`, for the goal at x = goalX. */
export function goalAngle(pos: Vec2, goalX: number): number {
  const a1 = Math.atan2(MID_Y - GOAL_WIDTH / 2 - pos.y, goalX - pos.x);
  const a2 = Math.atan2(MID_Y + GOAL_WIDTH / 2 - pos.y, goalX - pos.x);
  let d = Math.abs(a1 - a2);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d;
}

/**
 * Smallest margin by which the opponents of `team` miss the straight lane from a to b (px). Negative means
 * someone can cut it out. The allowed gap grows along the lane, since a slower ball gives more time to react.
 */
export function laneClearance(state: GameState, team: TeamId, a: Vec2, b: Vec2, growth = AI_LANE_GROWTH, skipKeeper = false): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len = Math.hypot(abx, aby);
  let best = Infinity;
  for (const o of state.players) {
    if (o.team === team || (skipKeeper && o.role === 'keeper')) continue;
    const s = len > 0 ? ((o.pos.x - a.x) * abx + (o.pos.y - a.y) * aby) / len : 0; // distance along the lane
    if (s < 0) continue; // behind the ball
    const t = len > 0 ? Math.min(1, s / len) : 0;
    const perp = Math.hypot(o.pos.x - (a.x + abx * t), o.pos.y - (a.y + aby * t));
    // Right next to the ball only a body actually in the way blocks it; further on, anyone who can step across.
    const allowance = o.radius + BALL_RADIUS + Math.min(1, s / 60) * (AI_LANE_WIDTH - BALL_RADIUS) + t * len * growth;
    best = Math.min(best, perp - allowance);
  }
  return best;
}

/** Distance from point q to the segment a-b. */
function segmentDistance(q: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  const t = len2 > 0 ? clamp(((q.x - a.x) * abx + (q.y - a.y) * aby) / len2, 0, 1) : 0;
  return Math.hypot(q.x - (a.x + abx * t), q.y - (a.y + aby * t));
}

/** Distance from `pos` to the nearest player of the team opposing `team`. */
function nearestOpponentDist(state: GameState, team: TeamId, pos: Vec2): number {
  let best = Infinity;
  for (const o of state.players) if (o.team !== team) best = Math.min(best, dist(o.pos, pos));
  return best;
}

/* ------------------------------------------------------------------------------------------------
 * AI state
 * ---------------------------------------------------------------------------------------------- */

function createMemory(p: PlayerState): AiPlayerMemory {
  return {
    intent: p.role === 'keeper' ? 'position' : 'support',
    target: { ...p.pos },
    thinkTimer: 0,
    kickTarget: { x: 0, y: 0 },
    kickError: 0,
    kickSpeed: 0,
    receiver: -1,
    kickTimer: 0,
    cooldown: 0,
    markId: -1,
    offset: { x: 0, y: 0 },
    runTimer: 0,
    tackleArmed: false,
    kickPending: false,
    shotReact: -1,
    saveError: 0,
  };
}

function createTeamMemory(): AiTeamMemory {
  return { mode: 'transitioning', modeTimer: 0, lastPossession: -1, passReceiver: -1, passTimer: 0, shotLive: false, passes: 0, shots: 0, tackles: 0, saves: 0 };
}

/** Fresh AI memory for these players. By default a team with a human uses the teammate difficulty. */
export function createAiState(
  players: PlayerState[],
  controlled: [number, number],
  difficulty?: [Difficulty, Difficulty],
  seed = AI_SEED,
): AiState {
  const diff = difficulty ?? ([0, 1] as const).map((t) => (controlled[t] >= 0 ? AI_TEAMMATE_DIFFICULTY : AI_DIFFICULTY));
  return {
    rng: seed | 0,
    difficulty: [diff[0], diff[1]],
    teams: [createTeamMemory(), createTeamMemory()],
    players: players.map(createMemory),
    lastToucher: -1,
  };
}

export function cloneAiState(ai: AiState): AiState {
  return {
    rng: ai.rng,
    difficulty: [ai.difficulty[0], ai.difficulty[1]],
    teams: [{ ...ai.teams[0] }, { ...ai.teams[1] }],
    players: ai.players.map((m) => ({ ...m, target: { ...m.target }, kickTarget: { ...m.kickTarget }, offset: { ...m.offset } })),
    lastToucher: ai.lastToucher,
  };
}

/** Forget plans that no longer make sense after a restart (e.g. kickoff). */
export function resetAiPlans(ai: AiState): void {
  for (const t of ai.teams) {
    t.passReceiver = -1;
    t.passTimer = 0;
    t.shotLive = false;
    t.modeTimer = 0;
    t.lastPossession = -1;
  }
  for (const m of ai.players) {
    m.thinkTimer = 0;
    m.kickTimer = 0;
    m.kickSpeed = 0;
    m.cooldown = 0;
    m.runTimer = 0;
    m.shotReact = -1;
    m.intent = m.intent === 'position' || m.intent === 'save' || m.intent === 'rush' || m.intent === 'distribute' ? 'position' : 'support';
  }
}

/* ------------------------------------------------------------------------------------------------
 * 1. Analysis: possession, ball path, interceptions
 * ---------------------------------------------------------------------------------------------- */

export interface AiContext {
  /** Player in possession (-1 = loose ball). */
  owner: number;
  /** Team in possession, counting one of its passes in flight (-1 = loose). */
  possTeam: number;
  /** Predicted ball positions every AI_PREDICT_STEP seconds, starting now. */
  ballPath: Vec2[];
  /** Per player: earliest time it can reach the ball, and where. */
  intercept: { time: number; point: Vec2 }[];
  /** Per team: outfield player (human included) who reaches the ball first (-1 = none). */
  chaser: [number, number];
  /** Per team: is that team's controlled player driven by a human this tick? */
  human: [boolean, boolean];
}

/** Ball positions over the next AI_PREDICT_HORIZON seconds, with friction and pitch-edge bounces. */
export function predictBallPath(state: GameState): Vec2[] {
  const pos = { ...state.ball.pos };
  const vel = { ...state.ball.vel };
  const r = state.ball.radius;
  const path: Vec2[] = [{ ...pos }];
  const ticksPerSample = Math.round(AI_PREDICT_STEP / SIM_DT);
  const samples = Math.round(AI_PREDICT_HORIZON / AI_PREDICT_STEP);
  for (let s = 0; s < samples; s++) {
    for (let k = 0; k < ticksPerSample; k++) {
      const sp = Math.hypot(vel.x, vel.y);
      if (sp > 0) {
        const ns = sp - (BALL_FRICTION + BALL_DRAG * sp) * SIM_DT;
        const f = ns <= BALL_STOP_SPEED ? 0 : ns / sp;
        vel.x *= f;
        vel.y *= f;
      }
      pos.x += vel.x * SIM_DT;
      pos.y += vel.y * SIM_DT;
      // Treat the goal lines as walls too: close enough for choosing where to run.
      if (pos.x < PITCH_LEFT + r || pos.x > PITCH_RIGHT - r) {
        pos.x = clamp(pos.x, PITCH_LEFT + r, PITCH_RIGHT - r);
        vel.x *= -WALL_RESTITUTION;
      }
      if (pos.y < PITCH_TOP + r || pos.y > PITCH_BOTTOM - r) {
        pos.y = clamp(pos.y, PITCH_TOP + r, PITCH_BOTTOM - r);
        vel.y *= -WALL_RESTITUTION;
      }
    }
    path.push({ ...pos });
  }
  return path;
}

/** Earliest sample on the ball path the player can get to (allowing a moment to turn and accelerate). */
function interceptFor(p: PlayerState, path: Vec2[], speed: number): { time: number; point: Vec2 } {
  const reach = p.radius + BALL_RADIUS + KICK_REACH * 0.5;
  for (let k = 0; k < path.length; k++) {
    const t = k * AI_PREDICT_STEP;
    if (dist(p.pos, path[k]) - reach <= speed * Math.max(0, t - 0.1)) return { time: t, point: path[k] };
  }
  const last = path[path.length - 1];
  return { time: AI_PREDICT_HORIZON + (dist(p.pos, last) - reach) / speed, point: last };
}

/**
 * The ball is in or right in front of `team`'s own goal mouth: the keeper's ball. An outfield player upfield of it
 * can only hit it towards the net (players can't get behind it), so they leave it to the keeper.
 */
export function ballInOwnGoalMouth(state: GameState, team: TeamId): boolean {
  const dir = state.attackDir[team];
  return along(state.ball.pos.x, dir) < AI_GOAL_MOUTH_DEPTH && Math.abs(state.ball.pos.y - MID_Y) < GOAL_WIDTH / 2 + AI_GOAL_MOUTH_MARGIN;
}

export function analyse(state: GameState, human: [boolean, boolean]): AiContext {
  const { ball, players, lastTouch } = state;
  let owner = -1;
  if (state.possession) owner = state.possession.player;
  else if (lastTouch) {
    const p = players[lastTouch.player];
    if (p && dist(p.pos, ball.pos) <= p.radius + ball.radius + AI_POSSESSION_SLACK) owner = p.id;
  }
  let possTeam = owner >= 0 ? players[owner].team : -1;
  if (possTeam < 0 && lastTouch) {
    // Still ours while one of our passes is travelling, or while we're nearest to a ball that's just run on.
    let nearest: PlayerState | null = null;
    for (const p of players) if (!nearest || dist(p.pos, ball.pos) < dist(nearest.pos, ball.pos)) nearest = p;
    const close = nearest !== null && nearest.team === lastTouch.team && dist(nearest.pos, ball.pos) < 90;
    if (state.ai.teams[lastTouch.team].passTimer > 0 || close) possTeam = lastTouch.team;
  }

  const ballPath = predictBallPath(state);
  const intercept = players.map((p) => interceptFor(p, ballPath, PLAYER_MAX_SPEED * profileOf(state, p.team).speed));
  const chaser: [number, number] = [-1, -1];
  for (const p of players) {
    if (p.role === 'keeper') continue;
    if (ballInOwnGoalMouth(state, p.team) && along(p.pos.x, state.attackDir[p.team]) > along(ball.pos.x, state.attackDir[p.team])) continue;
    const c = chaser[p.team];
    if (c < 0 || intercept[p.id].time < intercept[c].time) chaser[p.team] = p.id;
  }
  return { owner, possTeam, ballPath, intercept, chaser, human };
}

/* ------------------------------------------------------------------------------------------------
 * 2. Team modes
 * ---------------------------------------------------------------------------------------------- */

function updateTeams(state: GameState, ctx: AiContext, dt: number): void {
  const { ai, lastTouch } = state;
  // A save is the keeper touching the ball straight after an opponent's shot.
  const toucher = lastTouch ? lastTouch.player : -1;
  if (toucher !== ai.lastToucher && toucher >= 0) {
    const tp = state.players[toucher];
    const opp = ai.teams[1 - tp.team];
    if (tp.role === 'keeper' && opp.shotLive) ai.teams[tp.team].saves++;
    for (const t of ai.teams) t.shotLive = false;
  }
  ai.lastToucher = toucher;

  for (const team of [0, 1] as const) {
    const tm = ai.teams[team];
    if (tm.passTimer > 0) {
      tm.passTimer = Math.max(0, tm.passTimer - dt);
      // The pass is over once anyone other than the passer has it, or it runs out of time.
      if (tm.passTimer === 0 || (ctx.owner >= 0 && lastTouch && ctx.owner === lastTouch.player && state.players[ctx.owner].team !== team)) {
        tm.passReceiver = -1;
        tm.passTimer = 0;
      }
      if (ctx.owner >= 0 && ctx.owner === tm.passReceiver) {
        tm.passReceiver = -1;
        tm.passTimer = 0;
      }
    }
    if (ctx.possTeam !== tm.lastPossession) {
      tm.modeTimer = AI_TRANSITION_TIME;
      tm.lastPossession = ctx.possTeam;
    }
    tm.modeTimer = Math.max(0, tm.modeTimer - dt);
    tm.mode = ctx.possTeam < 0 || tm.modeTimer > 0 ? 'transitioning' : ctx.possTeam === team ? 'attacking' : 'defending';
  }
}

/* ------------------------------------------------------------------------------------------------
 * Steering: intents -> InputFrames
 * ---------------------------------------------------------------------------------------------- */

/** Proportional move towards a target: full speed far away, slowing to a stop on arrival. */
export function moveToward(p: PlayerState, target: Vec2, arriveRadius: number, maxMove = 1): InputFrame {
  const dx = target.x - p.pos.x;
  const dy = target.y - p.pos.y;
  const d = Math.hypot(dx, dy);
  if (d < AI_DEADZONE) return { ...IDLE };
  const k = (Math.min(1, d / arriveRadius) * maxMove) / d;
  return { ...IDLE, moveX: dx * k, moveY: dy * k };
}

/**
 * Where to head to reach `goal` (a spot on the far side of the ball, e.g. to get behind it) without running into the
 * ball on the way: if the straight path would clip it, go round via a waypoint to one side. Otherwise `goal` itself.
 */
function routeAroundBall(p: PlayerState, ball: BallState, goal: Vec2): Vec2 {
  if (dist(p.pos, goal) < 1e-6 || segmentDistance(ball.pos, p.pos, goal) > p.radius + ball.radius + 2) return goal;
  const v = unit(goal.x - p.pos.x, goal.y - p.pos.y);
  const c = v.x * (ball.pos.y - p.pos.y) - v.y * (ball.pos.x - p.pos.x);
  const sign = c >= 0 ? -1 : 1; // pass on the side away from the ball's offset
  const clear = p.radius + ball.radius + 8;
  return { x: ball.pos.x - v.y * sign * clear, y: ball.pos.y + v.x * sign * clear };
}

/** Push a target away from teammates who are already close to it, so players spread out. */
function separate(state: GameState, p: PlayerState, target: Vec2): Vec2 {
  let x = target.x;
  let y = target.y;
  for (const q of state.players) {
    if (q.team !== p.team || q.id === p.id || q.role === 'keeper') continue;
    const d = dist(q.pos, target);
    if (d < AI_SEPARATION && d > 1e-6) {
      const push = (AI_SEPARATION - d) * 0.6;
      x += ((target.x - q.pos.x) / d) * push;
      y += ((target.y - q.pos.y) / d) * push;
    }
  }
  return { x, y };
}

/* ------------------------------------------------------------------------------------------------
 * 3a. Off the ball
 * ---------------------------------------------------------------------------------------------- */

/** Where a player stands in the team shape (before space-finding), shifted with the ball. */
export function shapePosition(state: GameState, p: PlayerState, attacking: boolean): Vec2 {
  const dir = state.attackDir[p.team];
  const ball = state.ball.pos;
  const home = formationPosition(p.slot, dir);
  const ballAlong = along(ball.x, dir);
  const W = PITCH_WIDTH;
  let a: number;
  let pullY: number;
  if (roleOf(p) === 'defender') {
    a = attacking ? clamp(ballAlong - AI_DEF_BEHIND_BALL, 0.15 * W, AI_DEF_MAX_ADVANCE * W) : clamp(ballAlong * 0.55, 0.1 * W, 0.33 * W);
    pullY = attacking ? 0.25 : 0.4; // defending: squeeze towards the ball
  } else {
    a = attacking ? clamp(ballAlong + AI_ATT_AHEAD_OF_BALL, 0.35 * W, 0.86 * W) : clamp(ballAlong * 0.7 + 0.08 * W, 0.3 * W, 0.58 * W);
    pullY = attacking ? 0.15 : 0.35; // attacking: stay wide
  }
  return clampToPitch({ x: ownGoalX(dir) + dir * a, y: home.y + (ball.y - home.y) * pullY });
}

/** Pick the most open spot near the support position: away from opponents, with a clear lane from the ball. */
function findSpace(state: GameState, p: PlayerState, base: Vec2): Vec2 {
  const dir = state.attackDir[p.team];
  let best = { x: 0, y: 0 };
  let bestScore = -Infinity;
  for (let i = -1; i < 8; i++) {
    // Candidates are laid out relative to the attacking direction, so both teams break ties the same way.
    const off = i < 0 ? { x: 0, y: 0 } : { x: Math.cos((i * Math.PI) / 4) * AI_SPACE_SEARCH_RADIUS * dir, y: Math.sin((i * Math.PI) / 4) * AI_SPACE_SEARCH_RADIUS };
    const spot = clampToPitch({ x: base.x + off.x, y: base.y + off.y });
    const open = Math.min(160, nearestOpponentDist(state, p.team, spot)) / 160;
    const lane = laneClearance(state, p.team, state.ball.pos, spot) > 0 ? 0.4 : 0;
    const forward = roleOf(p) === 'attacker' ? (off.x * dir) / AI_SPACE_SEARCH_RADIUS * 0.15 : 0;
    const score = open + lane + forward - (Math.hypot(off.x, off.y) / AI_SPACE_SEARCH_RADIUS) * 0.25;
    if (score > bestScore) {
      bestScore = score;
      best = { x: spot.x - base.x, y: spot.y - base.y };
    }
  }
  return best;
}

/** Who presses the carrier: the quickest to the ball, plus a second when it's dangerous (or on hard). */
export function choosePressers(state: GameState, ctx: AiContext, team: TeamId): number[] {
  const prof = profileOf(state, team);
  const order = state.players
    .filter((p) => p.team === team && p.role !== 'keeper')
    .sort((a, b) => ctx.intercept[a.id].time - ctx.intercept[b.id].time || a.id - b.id);
  const ball = state.ball.pos;
  const danger = Math.abs(ball.x - ownGoalX(state.attackDir[team])) < AI_DANGER_ZONE;
  const count = Math.min(order.length, prof.pressers >= 2 || danger ? 2 : 1);
  return order.slice(0, count).map((p) => p.id);
}

/** Greedy man-marking: the most dangerous opponents (nearest our goal) get the nearest free player. */
function markAssignment(state: GameState, ctx: AiContext, team: TeamId, exclude: number[]): number[] {
  const goalX = ownGoalX(state.attackDir[team]);
  const opps = state.players
    .filter((o) => o.team !== team && o.role !== 'keeper' && o.id !== ctx.owner)
    .sort((a, b) => Math.abs(a.pos.x - goalX) - Math.abs(b.pos.x - goalX) || a.id - b.id);
  const free = state.players.filter((p) => p.team === team && p.role !== 'keeper' && !exclude.includes(p.id));
  const result = state.players.map(() => -1);
  for (const o of opps) {
    let best: PlayerState | null = null;
    let bestScore = Infinity;
    for (const p of free) {
      if (result[p.id] >= 0) continue;
      const score = dist(p.pos, o.pos) - (roleOf(p) === 'defender' ? 80 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = p;
      }
    }
    if (best) result[best.id] = o.id;
  }
  return result;
}

function thinkOffBall(state: GameState, ctx: AiContext, p: PlayerState, m: AiPlayerMemory, prof: AiProfile): void {
  const { ai } = state;
  const team = p.team;
  const tm = ai.teams[team];
  const set = (intent: AiIntent): void => {
    m.intent = intent;
  };
  m.tackleArmed = false;

  if (ctx.possTeam === team) {
    // Attacking: support the carrier, find space, make runs.
    if (tm.passReceiver === p.id) return set('receive');
    if (ctx.owner < 0 && ctx.chaser[team] === p.id) return set('chase');
    if (roleOf(p) === 'attacker') {
      if (m.runTimer > 0) return set('run');
      const dir = state.attackDir[team];
      const deep = along(p.pos.x, dir) > 0.8 * PITCH_WIDTH;
      if (!deep && ctx.owner >= 0 && nextRandom(ai) < AI_RUN_CHANCE) {
        const goalX = ownGoalX(-dir);
        const side = p.slot === 3 ? -1 : 1;
        m.offset = clampToPitch({
          x: goalX - dir * (90 + 80 * nextRandom(ai)),
          y: MID_Y + side * (30 + 90 * nextRandom(ai)),
        });
        m.runTimer = AI_RUN_TIME;
        return set('run');
      }
    }
    m.offset = findSpace(state, p, shapePosition(state, p, true));
    return set('support');
  }

  if (ctx.possTeam === 1 - team) {
    // Defending: 1-2 press (a human teammate can be one of them), the rest mark goal-side.
    const pressers = choosePressers(state, ctx, team);
    const humanId = ctx.human[team] ? state.controlled[team] : -1;
    if (pressers[0] === p.id) {
      m.markId = ctx.owner;
      m.tackleArmed = nextRandom(ai) < prof.tackleChance;
      return set('press');
    }
    if (pressers[1] === p.id) return set('cover');
    const marks = markAssignment(state, ctx, team, [...pressers, humanId]);
    m.markId = marks[p.id];
    if (tm.mode === 'transitioning' && along(p.pos.x, state.attackDir[team]) > along(state.ball.pos.x, state.attackDir[team])) return set('recover');
    return set(m.markId >= 0 ? 'mark' : 'recover');
  }

  // Loose ball: the quickest goes for it, everyone else takes up a shape based on who touched it last.
  if (ctx.chaser[team] === p.id) return set('chase');
  const ours = state.lastTouch?.team === team;
  if (ours) {
    m.offset = findSpace(state, p, shapePosition(state, p, true));
    return set('support');
  }
  return set('recover');
}

function actOffBall(state: GameState, ctx: AiContext, p: PlayerState, m: AiPlayerMemory, prof: AiProfile): InputFrame {
  const dir = state.attackDir[p.team];
  const ownGoal = { x: ownGoalX(dir), y: MID_Y };
  const ball = state.ball;
  const full = prof.speed;
  const calm = prof.speed * AI_SHAPE_SPEED;
  let target: Vec2;
  let input: InputFrame;

  switch (m.intent) {
    case 'press': {
      const carrier = ctx.owner >= 0 ? state.players[ctx.owner] : null;
      const at = carrier ? carrier.pos : ball.pos;
      const g = unit(ownGoal.x - at.x, ownGoal.y - at.y);
      target = { x: at.x + g.x * AI_PRESS_OFFSET, y: at.y + g.y * AI_PRESS_OFFSET };
      // Close in goal-side and jockey; if this decision says "tackle", go for the ball and slide in.
      const lead = { x: ball.pos.x + ball.vel.x * 0.12, y: ball.pos.y + ball.vel.y * 0.12 };
      const dBall = dist(p.pos, lead);
      if (m.tackleArmed && dBall < AI_TACKLE_RANGE * 1.8) target = lead;
      // Goal-side and close to a carrier: step in to the ball and win it with the body (a body check from the front).
      const goalSide = carrier && along(p.pos.x, dir) < along(carrier.pos.x, dir) + 6;
      const keeperBall = !!state.possession && !!carrier && carrier.role === 'keeper'; // can't be challenged
      if (state.possession && carrier && carrier.team !== p.team && !keeperBall && goalSide && dist(p.pos, carrier.pos) < AI_PRESS_ENGAGE) target = lead;
      if (keeperBall) m.tackleArmed = false;
      input = moveToward(p, target, 8, full);
      const d = unit(lead.x - p.pos.x, lead.y - p.pos.y);
      // Only slide in from goal-side in our own half: a tackle from the wrong side knocks it towards our goal.
      const safeAngle = d.x * dir > -0.2 || along(ball.pos.x, dir) > 0.5 * PITCH_WIDTH;
      // A carried ball can't be poked away (only tackled or body-checked); a loose one at the carrier's feet can.
      const canPoke = m.tackleArmed && carrier && carrier.team !== p.team && !state.possession && !p.prevPass && canKickNow(state, p);
      const poke = canPoke ? strikeDirection(state, p, { x: dir, y: 0 }) : null;
      if (poke) {
        // Close enough to touch it: poke it away rather than wrestle for it.
        input = { ...IDLE, moveX: poke.x * 0.3, moveY: poke.y * 0.3, pass: true };
        m.kickPending = true;
        m.tackleArmed = false;
      } else if (m.tackleArmed && safeAngle && dBall < AI_TACKLE_RANGE && p.tackleCooldown === 0 && p.tackleTimer === 0 && !p.prevTackle) {
        input = { ...IDLE, moveX: d.x * full, moveY: d.y * full, tackle: true };
        m.tackleArmed = false;
        state.ai.teams[p.team].tackles++;
      }
      break;
    }
    case 'cover': {
      // Second presser: sit between the carrier and our goal, cutting off the direct route.
      const at = ctx.owner >= 0 ? state.players[ctx.owner].pos : ball.pos;
      const g = unit(ownGoal.x - at.x, ownGoal.y - at.y);
      target = { x: at.x + g.x * 100, y: at.y + g.y * 100 };
      input = moveToward(p, target, 20, full);
      break;
    }
    case 'mark': {
      const o = m.markId >= 0 ? state.players[m.markId] : null;
      if (!o) {
        target = shapePosition(state, p, false);
      } else if (roleOf(p) === 'defender') {
        const g = unit(ownGoal.x - o.pos.x, ownGoal.y - o.pos.y);
        target = { x: o.pos.x + g.x * AI_MARK_DISTANCE_DEF, y: o.pos.y + g.y * AI_MARK_DISTANCE_DEF };
      } else {
        // Attackers helping out sit in the passing lane between the ball and their man, a bit goal-side.
        const mid = { x: (o.pos.x + ball.pos.x) / 2, y: (o.pos.y + ball.pos.y) / 2 };
        const g = unit(ownGoal.x - mid.x, ownGoal.y - mid.y);
        const toward = unit(o.pos.x - mid.x, o.pos.y - mid.y);
        const k = Math.min(AI_MARK_DISTANCE_ATT, dist(mid, o.pos) * 0.5);
        target = { x: mid.x + toward.x * k + g.x * 20, y: mid.y + toward.y * k + g.y * 20 };
      }
      input = moveToward(p, clampToPitch(target), 24, calm);
      break;
    }
    case 'recover':
      target = separate(state, p, shapePosition(state, p, false));
      input = moveToward(p, clampToPitch(target), 30, full);
      break;
    case 'run':
      target = m.offset;
      input = moveToward(p, target, 20, full);
      break;
    case 'support':
      target = separate(state, p, shapePosition(state, p, true));
      target = clampToPitch({ x: target.x + m.offset.x, y: target.y + m.offset.y });
      input = moveToward(p, target, 40, calm);
      break;
    default:
      // chase, receive (and stale on-ball intents right after losing the ball): get to the ball first.
      target = ctx.intercept[p.id].point;
      if (along(ball.pos.x, dir) < AI_OWN_GOAL_DANGER * PITCH_WIDTH && along(p.pos.x, dir) > along(ball.pos.x, dir) - 6) {
        // Upfield of a ball near our own goal: running straight at it would nudge it towards our net. Swing round
        // to the goal side of it first.
        const side = p.pos.y >= target.y ? 1 : -1;
        target = clampToPitch({ x: target.x - dir * 34, y: target.y + side * 34 });
      }
      input = moveToward(p, target, 8, full);
  }
  m.target = target;
  return input;
}

/* ------------------------------------------------------------------------------------------------
 * 3b. On the ball
 * ---------------------------------------------------------------------------------------------- */

export type OnBallAction = 'dribble' | 'pass' | 'shoot' | 'clear';

export interface OnBallDecision {
  action: OnBallAction;
  /** Where to kick (pass/shoot/clear), the wanted ball speed and the receiver (-1 = none). */
  target: Vec2;
  speed: number;
  receiver: number;
  /** Scores of each option (for tests and the debug overlay). */
  scores: Record<OnBallAction, number>;
}

export { kickSpeedForDistance };

/** Best spot to aim at in the goal: the candidate with the widest gap from the keeper and defenders. */
export function bestShot(state: GameState, p: PlayerState): { target: Vec2; clearance: number } {
  const goalX = ownGoalX(-state.attackDir[p.team]);
  let best = { target: { x: goalX, y: MID_Y }, clearance: -Infinity };
  for (const off of [-1, -0.55, 0, 0.55, 1]) {
    const target = { x: goalX, y: MID_Y + off * (GOAL_WIDTH / 2 - 15) };
    const from = state.ball.pos;
    const outfield = laneClearance(state, p.team, from, target, 0.05, true);
    let keeperGap = Infinity;
    for (const o of state.players) {
      if (o.team !== p.team && o.role === 'keeper') keeperGap = segmentDistance(o.pos, from, target) - o.radius - BALL_RADIUS;
    }
    const clearance = Math.min(outfield + AI_LANE_WIDTH * 0.5, keeperGap);
    if (clearance > best.clearance) best = { target, clearance };
  }
  return best;
}

/** Charge time needed to kick at `speed` with the shoot button. */
function chargeFor(speed: number): number {
  return clamp(((speed - SHOT_MIN_SPEED) / (SHOT_MAX_SPEED - SHOT_MIN_SPEED)) * SHOT_MAX_CHARGE_TIME, 0.02, SHOT_MAX_CHARGE_TIME);
}

/**
 * Scores dribbling, each possible pass, shooting and clearing for the player on the ball, and picks the best.
 * `noise()` returns [0, 1); pass () => 0.5 for no randomness.
 */
export function evaluateOnBall(
  state: GameState,
  p: PlayerState,
  noise: () => number,
  noiseAmount = 0,
  allowDribble = true,
  /** Taking a throw-in: only a throw to a teammate it can reach, into the pitch. */
  throwIn = false,
): OnBallDecision {
  const dir = state.attackDir[p.team];
  const goalX = ownGoalX(-dir);
  const goal = { x: goalX, y: MID_Y };
  const dGoal = dist(p.pos, goal);
  const pressure = nearestOpponentDist(state, p.team, p.pos);
  const pressured = pressure < AI_PRESSURE_RADIUS;
  const pressureAmount = pressured ? 1 - pressure / AI_PRESSURE_RADIUS : 0;
  const myAlong = along(p.pos.x, dir);
  const humanId = state.controlled[p.team];
  const n = (): number => (noise() - 0.5) * noiseAmount;
  const toBall = unit(state.ball.pos.x - p.pos.x, state.ball.pos.y - p.pos.y);

  // Shoot: closer and clearer is better.
  let shoot = -Infinity;
  let shotTarget = goal;
  let shotSpeed = SHOT_MAX_SPEED;
  if (!throwIn && dGoal < AI_SHOOT_RANGE && goalAngle(p.pos, goalX) > AI_MIN_SHOT_ANGLE) {
    const s = bestShot(state, p);
    if (s.clearance > 2) {
      shoot = 0.25 + 1.6 * (1 - dGoal / AI_SHOOT_RANGE) + Math.min(s.clearance, 50) / 100 + (dGoal < 190 ? 0.4 : 0) + n();
      shotTarget = s.target;
      shotSpeed = SHOT_MIN_SPEED + (SHOT_MAX_SPEED - SHOT_MIN_SPEED) * clamp(0.3 + (dGoal / AI_SHOOT_RANGE) * 0.6, 0.3, 1);
    }
  }

  // Pass: forward, open, with a clear lane; more attractive under pressure.
  let pass = -Infinity;
  let passTarget = goal;
  let passSpeed = PASS_SPEED;
  let receiver = -1;
  for (const t of state.players) {
    if (t.team !== p.team || t.id === p.id) continue;
    const point = clampToPitch({ x: t.pos.x + t.vel.x * 0.35, y: t.pos.y + t.vel.y * 0.35 });
    const len = dist(state.ball.pos, point);
    const lane = laneClearance(state, p.team, state.ball.pos, point);
    if (lane < 0) continue;
    if (throwIn && !throwable(state, point, len)) continue;
    const open = Math.min(150, nearestOpponentDist(state, p.team, point)) / 150;
    const progress = clamp((along(point.x, dir) - myAlong) / 300, -1, 1);
    let score = 0.05 + 0.6 * progress + 0.5 * open + Math.min(lane, 40) / 100 + 0.45 * pressureAmount;
    if (len < AI_PASS_MIN) score -= 0.5;
    if (len > AI_PASS_MAX) score -= (len - AI_PASS_MAX) / 200;
    if (t.role === 'keeper') score -= 0.7;
    // Passes we'd have to turn round the ball for take time, which we don't have under pressure.
    const k = unit(point.x - state.ball.pos.x, point.y - state.ball.pos.y);
    const turn = Math.acos(clamp(toBall.x * k.x + toBall.y * k.y, -1, 1));
    if (turn > 1.2) score -= ((turn - 1.2) / (Math.PI - 1.2)) * 0.5 * (1 + pressureAmount);
    if (t.id === humanId) score += AI_PASS_TO_HUMAN_BONUS;
    score += n();
    if (score > pass) {
      pass = score;
      passTarget = point;
      passSpeed = kickSpeedForDistance(len);
      receiver = t.id;
    }
  }

  // Dribble: good with space ahead, bad under pressure.
  const toGoal = unit(goal.x - p.pos.x, goal.y - p.pos.y);
  let blocked = 0;
  for (const o of state.players) {
    if (o.team === p.team) continue;
    const ox = o.pos.x - p.pos.x;
    const oy = o.pos.y - p.pos.y;
    const ahead = ox * toGoal.x + oy * toGoal.y;
    const side = Math.abs(ox * toGoal.y - oy * toGoal.x);
    if (ahead > 0 && ahead < 160 && side < 60) blocked = Math.max(blocked, (1 - ahead / 160) * (1 - side / 60));
  }
  const dribble = allowDribble ? 0.6 + 0.3 * (1 - blocked) - 0.9 * pressureAmount + n() : -Infinity;

  // Clear: a defender in trouble near its own goal just boots it upfield.
  let clear = -Infinity;
  if (!throwIn && myAlong < 0.3 * PITCH_WIDTH && pressured) clear = 0.2 + 0.5 * pressureAmount + n();

  const scores: Record<OnBallAction, number> = { dribble, pass, shoot, clear };
  let action: OnBallAction = 'dribble';
  for (const a of ['pass', 'shoot', 'clear'] as const) if (scores[a] > scores[action]) action = a;
  if (action === 'dribble' && !allowDribble) action = 'clear';

  if (throwIn && action !== 'pass') {
    // Nobody open within reach: throw it to the nearest unmarked teammate anyway (the same choice as the auto-throw).
    const r = state.restart!;
    const t = restartTarget(state, r, p);
    const to = t.receiver >= 0 ? state.players[t.receiver].pos : { x: state.ball.pos.x + Math.cos(t.aim) * 150, y: state.ball.pos.y + Math.sin(t.aim) * 150 };
    return { action: 'pass', target: { ...to }, speed: t.speed, receiver: t.receiver, scores };
  }
  if (action === 'shoot') return { action, target: shotTarget, speed: shotSpeed, receiver: -1, scores };
  if (action === 'pass') return { action, target: passTarget, speed: passSpeed, receiver, scores };
  if (action === 'clear') return { action, target: clearTarget(state, p), speed: SHOT_MAX_SPEED * 0.85, receiver: -1, scores };
  return { action, target: goal, speed: 0, receiver: -1, scores };
}

/** Can a throw-in reach `point`, `len` px away, going into the pitch? */
function throwable(state: GameState, point: Vec2, len: number): boolean {
  const r = state.restart;
  const inward = r ? inwardDirection(r.type, r.pos) : null;
  if (inward && (point.x - state.ball.pos.x) * inward.x + (point.y - state.ball.pos.y) * inward.y < len * 0.2) return false;
  return kickSpeedForDistance(len) <= THROW_LONG_MAX_SPEED;
}

/** Upfield and wide, on the side with fewer opponents. */
function clearTarget(state: GameState, p: PlayerState): Vec2 {
  const dir = state.attackDir[p.team];
  let top = 0;
  for (const o of state.players) if (o.team !== p.team) top += o.pos.y < MID_Y ? 1 : -1;
  return clampToPitch({ x: p.pos.x + dir * 420, y: top > 0 ? PITCH_BOTTOM - 90 : PITCH_TOP + 90 });
}

/** Direction to run with the ball: towards goal, bending around opponents and away from the walls. */
function dribbleDirection(state: GameState, p: PlayerState): Vec2 {
  const dir = state.attackDir[p.team];
  const goal = { x: ownGoalX(-dir), y: MID_Y };
  const base = Math.atan2(goal.y - p.pos.y, goal.x - p.pos.x);
  const toBall = unit(state.ball.pos.x - p.pos.x, state.ball.pos.y - p.pos.y);
  let best = { x: Math.cos(base), y: Math.sin(base) };
  let bestScore = -Infinity;
  // Under pressure a carrier may also turn away from goal, to shield the ball (it is held on the far side of the body).
  const pressured = nearestOpponentDist(state, p.team, p.pos) < AI_PRESSURE_RADIUS;
  const offsets = pressured && state.possession?.player === p.id ? [0, -0.4, 0.4, -0.8, 0.8, -1.2, 1.2, -1.8, 1.8] : [0, -0.4, 0.4, -0.8, 0.8, -1.2, 1.2];
  for (const off of offsets) {
    const d = { x: Math.cos(base + off * dir), y: Math.sin(base + off * dir) }; // mirrored per team, like findSpace
    // Prefer the way the ball already lies from us: turning round a ball (e.g. pinned on a wall) is slow.
    let score = Math.cos(off) + 0.3 * (toBall.x * d.x + toBall.y * d.y);
    for (const o of state.players) {
      if (o.team === p.team) continue;
      const ox = o.pos.x - p.pos.x;
      const oy = o.pos.y - p.pos.y;
      const ahead = ox * d.x + oy * d.y;
      const side = Math.abs(ox * d.y - oy * d.x);
      if (ahead > 0 && ahead < 150 && side < 50) score -= 2 * (1 - side / 50) * (1 - ahead / 150);
      // Shielding: the held ball sits in front, so don't carry it into someone's reach.
      const spot = Math.hypot(o.pos.x - (p.pos.x + d.x * 26), o.pos.y - (p.pos.y + d.y * 26));
      if (spot < 55) score -= 1.5 * (1 - spot / 55);
    }
    // Keep off the walls: the closer the spot 70 px ahead is to a touchline or goal line, the worse.
    const probe = { x: p.pos.x + d.x * 70, y: p.pos.y + d.y * 70 };
    const edge = Math.min(probe.y - PITCH_TOP, PITCH_BOTTOM - probe.y, probe.x - PITCH_LEFT + 40, PITCH_RIGHT - probe.x + 40);
    if (edge < 80) score -= 2 * (1 - Math.max(0, edge) / 80);
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/**
 * A carrier's turn towards `d`, limited so it never turns sharply enough at speed to lose the ball
 * (see DRIBBLE_SHARP_TURN_ANGLE): a big turn is taken in stages.
 */
function carryTurn(p: PlayerState, d: Vec2): Vec2 {
  const sp = Math.hypot(p.vel.x, p.vel.y);
  if (sp < 0.5 * CARRY_SPEED) return d;
  const va = Math.atan2(p.vel.y, p.vel.x);
  const diff = angleDiff(Math.atan2(d.y, d.x), va);
  const max = DRIBBLE_SHARP_TURN_ANGLE - 0.6;
  if (Math.abs(diff) <= max) return d;
  const a = va + Math.sign(diff) * max;
  return { x: Math.cos(a), y: Math.sin(a) };
}

/** Run with the ball in direction `d`: carrying it, just run; else get behind it and keep it in front so the dribble touches push it on. */
function dribbleInput(state: GameState, p: PlayerState, d: Vec2, speed: number): InputFrame {
  if (state.possession?.player === p.id) {
    const t = carryTurn(p, d);
    return { ...IDLE, moveX: t.x * speed, moveY: t.y * speed };
  }
  const ball = state.ball.pos;
  const toBall = unit(ball.x - p.pos.x, ball.y - p.pos.y);
  if (toBall.x * d.x + toBall.y * d.y > 0.55) {
    const m = unit(d.x * 0.6 + toBall.x * 0.4, d.y * 0.6 + toBall.y * 0.4);
    return { ...IDLE, moveX: m.x * speed, moveY: m.y * speed };
  }
  const behind = clampToPitch({ x: ball.x - d.x * (p.radius + BALL_RADIUS), y: ball.y - d.y * (p.radius + BALL_RADIUS) }, p.radius);
  return moveToward(p, routeAroundBall(p, state.ball, behind), 10, speed);
}

/**
 * True if a kick pressed now would connect. The sim checks reach after this tick's movement (and before the
 * ball moves), and a dribble touch would knock the ball out of reach first, so look one tick ahead.
 */
function canKickNow(state: GameState, p: PlayerState): boolean {
  const ball = state.ball;
  const reach = p.radius + ball.radius + KICK_REACH - 1;
  const next = { x: p.pos.x + p.vel.x * SIM_DT, y: p.pos.y + p.vel.y * SIM_DT };
  return Math.min(dist(p.pos, ball.pos), dist(next, ball.pos)) <= reach;
}

/**
 * A direction the ball can actually be struck in from where it lies (within ~70° of the line from player to
 * ball), as close as possible to `want`, and never back towards our own goal from our half. Null if none.
 */
function strikeDirection(state: GameState, p: PlayerState, want: Vec2): Vec2 | null {
  const ball = state.ball.pos;
  const dir = state.attackDir[p.team];
  const ownHalf = along(ball.x, dir) < 0.5 * PITCH_WIDTH;
  const a = Math.atan2(ball.y - p.pos.y, ball.x - p.pos.x);
  let delta = Math.atan2(want.y, want.x) - a;
  delta = Math.atan2(Math.sin(delta), Math.cos(delta));
  const options = [clamp(delta, -1.2, 1.2), 1.2 * dir, -1.2 * dir, 0.6 * dir, -0.6 * dir, 0].sort((x, y) => Math.abs(x - delta) - Math.abs(y - delta));
  for (const c of options) {
    const k = a + c;
    if (!ownHalf || Math.cos(k) * dir > -0.3) return { x: Math.cos(k), y: Math.sin(k) };
  }
  return null;
}

/** Records a pass/shot once the sim has confirmed the kick (see computeAiInputs). */
function registerKick(state: GameState, p: PlayerState, m: AiPlayerMemory): void {
  const tm = state.ai.teams[p.team];
  if (m.intent === 'press') {
    tm.tackles++; // a poke from a presser
    return;
  }
  if (m.intent === 'shoot') {
    tm.shots++;
    tm.shotLive = true;
  } else if (m.receiver >= 0) {
    tm.passes++;
    tm.passReceiver = m.receiver;
    const len = dist(state.ball.pos, m.kickTarget);
    tm.passTimer = len / Math.max(200, m.kickSpeed * 0.7) + 0.5;
    const rm = state.ai.players[m.receiver];
    rm.intent = 'receive';
    rm.thinkTimer = Math.max(rm.thinkTimer, 0.4);
  }
  m.cooldown = 0.3;
  m.kickSpeed = 0;
  m.intent = p.role === 'keeper' ? 'position' : 'support';
}

/**
 * Strike the ball towards m.kickTarget at m.kickSpeed: line up behind it, then press pass (tap) or hold
 * shoot until charged and release. Facing comes from the move direction, as for a human.
 */
function executeKick(state: GameState, p: PlayerState, m: AiPlayerMemory, speed: number): InputFrame {
  const ball = state.ball;
  const ang = Math.atan2(m.kickTarget.y - ball.pos.y, m.kickTarget.x - ball.pos.x) + m.kickError;
  // The kick adds some of the player's own velocity: aim off to cancel it.
  const face = unit(Math.cos(ang) * m.kickSpeed - p.vel.x * KICK_PLAYER_VEL_FACTOR, Math.sin(ang) * m.kickSpeed - p.vel.y * KICK_PLAYER_VEL_FACTOR);
  if (pendingThrowIn(state)?.taker === p.id) {
    // Taking a throw-in: aim with the move keys and throw, short (pass) or long (charged shoot). The sim keeps it in play.
    m.target = m.kickTarget;
    const aimInput = { ...IDLE, moveX: face.x * 0.3, moveY: face.y * 0.3 };
    if (m.kickSpeed <= THROW_SHORT_SPEED * 1.15) {
      if (p.prevPass) return aimInput;
      m.kickPending = true;
      return { ...aimInput, pass: true };
    }
    if (p.charge + SIM_DT * 0.5 < throwChargeFor(m.kickSpeed)) return { ...aimInput, shoot: true };
    m.kickPending = true;
    return aimInput;
  }
  if (state.possession?.player === p.id) {
    // Carrying it: a kick goes where the move keys point, so no lining up. Tap pass, or charge a shot while carrying
    // the ball on towards the target, then release.
    m.target = m.kickTarget;
    const kickInput = { ...IDLE, moveX: face.x * 0.3, moveY: face.y * 0.3 };
    if (m.kickSpeed <= PASS_SPEED * 1.15) {
      if (p.prevPass) return kickInput;
      m.kickPending = true;
      return { ...kickInput, pass: true };
    }
    // Under pressure, strike quickly rather than wait for the full charge (and risk the tackle).
    const pressured = nearestOpponentDist(state, p.team, p.pos) < AI_PRESSURE_RADIUS;
    const need = pressured ? Math.min(chargeFor(m.kickSpeed), AI_QUICK_SHOT_CHARGE) : chargeFor(m.kickSpeed);
    if (p.charge + SIM_DT * 0.5 < need) return { ...dribbleInput(state, p, face, speed), shoot: true };
    m.kickPending = true;
    return kickInput;
  }
  const toBall = unit(ball.pos.x - p.pos.x, ball.pos.y - p.pos.y);
  const inReach = canKickNow(state, p);
  let inFront = toBall.x * face.x + toBall.y * face.y > 0.05;
  const behind = clampToPitch(
    { x: ball.pos.x - face.x * (p.radius + ball.radius + 1), y: ball.pos.y - face.y * (p.radius + ball.radius + 1) },
    p.radius,
  );
  const cantLineUp = dist(behind, ball.pos) < p.radius + ball.radius - 2 || m.kickTimer > 0.4;
  if (inReach && !inFront && cantLineUp) {
    // Pinned (e.g. in a corner) or out of time: hit it the best way it can go, or else dribble out.
    const sd = strikeDirection(state, p, face);
    if (!sd) {
      m.intent = 'dribble';
      m.thinkTimer = 0.3;
      return dribbleInput(state, p, dribbleDirection(state, p), speed);
    }
    face.x = sd.x;
    face.y = sd.y;
    inFront = true;
  }

  if (!inReach || !inFront) {
    // Line up behind the ball, still holding a charge if one has started.
    const input = moveToward(p, routeAroundBall(p, ball, behind), 10, speed);
    input.shoot = p.charge > 0;
    m.target = behind;
    return input;
  }
  m.target = m.kickTarget;
  if (m.kickSpeed <= PASS_SPEED * 1.15) {
    if (p.prevPass) return { ...IDLE, moveX: face.x * 0.3, moveY: face.y * 0.3 };
    m.kickPending = true;
    return { ...IDLE, moveX: face.x * 0.3, moveY: face.y * 0.3, pass: true };
  }
  // Strike as soon as the ball is at our feet with a little charge: waiting longer lets the next dribble
  // touch knock it out of reach again. A ball we're standing over gets the full charge.
  const need = chargeFor(m.kickSpeed);
  const quick = Math.min(need, 0.1);
  const standing = Math.hypot(ball.vel.x, ball.vel.y) < 40;
  if (p.charge + SIM_DT * 0.5 < (standing ? need : quick)) {
    // Charge while running on to the ball towards the target, as a human would.
    return { ...dribbleInput(state, p, face, speed), shoot: true };
  }
  m.kickPending = true;
  return { ...IDLE, moveX: face.x * 0.3, moveY: face.y * 0.3, shoot: false };
}

/** A set piece (throw-in, corner, goal kick, kickoff) is played with a kick, not carried. */
function takingRestart(state: GameState, p: PlayerState): boolean {
  return state.restart?.taker === p.id;
}

function decideOnBall(state: GameState, p: PlayerState, m: AiPlayerMemory, prof: AiProfile): void {
  const { ai } = state;
  const throwIn = pendingThrowIn(state)?.taker === p.id;
  const dec = evaluateOnBall(state, p, () => nextRandom(ai), prof.decisionNoise, !takingRestart(state, p), throwIn);
  m.intent = dec.action;
  m.kickTarget = dec.target;
  m.kickSpeed = dec.speed;
  m.receiver = dec.receiver;
  m.kickTimer = 0;
  const err = dec.action === 'pass' ? prof.aimError * 0.6 : prof.aimError;
  m.kickError = (nextRandom(ai) * 2 - 1) * err;
}

function onBallInput(state: GameState, p: PlayerState, m: AiPlayerMemory, prof: AiProfile, dt: number): InputFrame {
  const kicking = m.intent === 'pass' || m.intent === 'shoot' || m.intent === 'clear';
  if (!kicking && m.intent !== 'dribble') {
    // Just got the ball: carry on for a reaction time before deciding (quicker when someone is closing in).
    const pressured = nearestOpponentDist(state, p.team, p.pos) < AI_PRESSURE_RADIUS;
    m.intent = 'dribble';
    m.thinkTimer = jitter(state.ai, prof.reactionTime) * (pressured ? 0.6 : 1);
  }
  if (kicking) {
    m.kickTimer += dt;
    const goalX = ownGoalX(-state.attackDir[p.team]);
    const shotGone = m.intent === 'shoot' && Math.abs(state.ball.pos.x - goalX) > AI_SHOOT_RANGE;
    if (m.kickTimer > AI_KICK_TIMEOUT || shotGone) {
      m.intent = 'dribble';
      m.thinkTimer = 0;
    }
  } else if (m.thinkTimer <= 0) {
    decideOnBall(state, p, m, prof);
    m.thinkTimer = jitter(state.ai, prof.reactionTime);
  }
  if (m.intent === 'dribble') {
    if (takingRestart(state, p)) return { ...IDLE }; // stand over the set piece until deciding how to play it
    const d = dribbleDirection(state, p);
    m.target = { x: p.pos.x + d.x * 80, y: p.pos.y + d.y * 80 };
    return dribbleInput(state, p, d, prof.speed);
  }
  return executeKick(state, p, m, prof.speed);
}

/** On the ball, or was a moment ago and it's still at my feet (possession flickers in a scramble). */
function isOnBall(state: GameState, ctx: AiContext, p: PlayerState, m: AiPlayerMemory): boolean {
  if (m.cooldown > 0) return false;
  if (ctx.owner === p.id) return true;
  const onBallIntent = m.intent === 'dribble' || m.intent === 'pass' || m.intent === 'shoot' || m.intent === 'clear' || m.intent === 'distribute';
  return onBallIntent && dist(p.pos, state.ball.pos) <= p.radius + state.ball.radius + KICK_REACH + 6;
}

function outfieldInput(state: GameState, ctx: AiContext, p: PlayerState, m: AiPlayerMemory, prof: AiProfile, dt: number): InputFrame {
  if (isOnBall(state, ctx, p, m)) return onBallInput(state, p, m, prof, dt);
  if (m.intent === 'dribble' || m.intent === 'pass' || m.intent === 'shoot' || m.intent === 'clear') {
    // Lost the ball (or just kicked it): chase it until the next decision.
    m.intent = 'chase';
    m.thinkTimer = jitter(state.ai, prof.reactionTime);
  }
  if (m.thinkTimer <= 0) {
    thinkOffBall(state, ctx, p, m, prof);
    m.thinkTimer = jitter(state.ai, prof.reactionTime);
  }
  const input = actOffBall(state, ctx, p, m, prof);
  if (p.charge > 0) input.shoot = true; // never waste a charge by releasing away from the ball
  return input;
}

/* ------------------------------------------------------------------------------------------------
 * 3c. Goalkeeper
 * ---------------------------------------------------------------------------------------------- */

/** Where the keeper stands: on the line from the goal centre to the ball, further out the further the ball. */
export function keeperPosition(state: GameState, p: PlayerState): Vec2 {
  const dir = state.attackDir[p.team];
  const goal = { x: ownGoalX(dir), y: MID_Y };
  const ball = state.ball.pos;
  const toBall = unit(ball.x - goal.x, ball.y - goal.y);
  if (toBall.x * dir <= 0.05) return formationPosition(0, dir);
  const out = clamp(dist(goal, ball) * 0.12, KEEPER_LINE_OFFSET, AI_KEEPER_MAX_OUT);
  return {
    x: goal.x + dir * Math.max(KEEPER_LINE_OFFSET * 0.8, Math.abs(toBall.x) * out),
    y: clamp(goal.y + toBall.y * out, MID_Y - GOAL_WIDTH / 2 + 8, MID_Y + GOAL_WIDTH / 2 - 8),
  };
}

/** How far a dive (the keeper's slide) has carried the keeper after `t` seconds. */
function diveDistance(t: number): number {
  const tt = Math.min(t, TACKLE_DURATION);
  // Slide speed falls linearly from TACKLE_SPEED to 35% of it over TACKLE_DURATION (see simulation.ts).
  const slide = TACKLE_SPEED * (tt - (0.65 * tt * tt) / (2 * TACKLE_DURATION));
  return slide + Math.max(0, t - TACKLE_DURATION) * TACKLE_SPEED * 0.35 * 0.5;
}

/** A ball heading into our goal soon: where it crosses the keeper's x, and when. */
export function predictShot(state: GameState, p: PlayerState): { y: number; time: number } | null {
  const dir = state.attackDir[p.team];
  const goalX = ownGoalX(dir);
  const { pos, vel } = state.ball;
  const towards = -vel.x * dir; // speed towards our goal line
  if (Math.hypot(vel.x, vel.y) < AI_SHOT_DETECT_SPEED || towards <= 50) return null;
  const tLine = ((pos.x - goalX) * dir) / towards;
  if (tLine < 0 || tLine > AI_SHOT_DETECT_TIME) return null;
  const yLine = pos.y + vel.y * tLine;
  if (Math.abs(yLine - MID_Y) > GOAL_WIDTH / 2 + 25) return null;
  const tKeeper = Math.max(0, ((pos.x - p.pos.x) * dir) / towards);
  return { y: pos.y + vel.y * tKeeper, time: tKeeper };
}

function keeperInput(state: GameState, ctx: AiContext, p: PlayerState, m: AiPlayerMemory, prof: AiProfile, dt: number): InputFrame {
  const { ai, ball } = state;
  const dir = state.attackDir[p.team];
  const goalX = ownGoalX(dir);
  const speed = prof.speed;

  // 1. On the ball (after a save or a back-pass): pick a teammate and play it out, or clear it.
  if (isOnBall(state, ctx, p, m)) {
    if (m.intent !== 'distribute') {
      m.intent = 'distribute';
      m.thinkTimer = jitter(ai, prof.reactionTime);
      m.kickSpeed = 0;
      m.kickTimer = 0;
    }
    if (m.kickSpeed === 0 && m.thinkTimer <= 0) chooseDistribution(state, p, m, prof);
    if (m.kickSpeed === 0) {
      m.target = { ...ball.pos };
      // Stay with the ball while deciding -- but don't walk into it (a keeper's touch punches it away).
      if (dist(p.pos, ball.pos) <= p.radius + ball.radius + 3) return { ...IDLE };
      return moveToward(p, ball.pos, 20, speed * 0.5);
    }
    m.kickTimer += dt;
    if (m.kickTimer > AI_KICK_TIMEOUT) m.kickSpeed = 0;
    return executeKick(state, p, m, speed);
  }

  // 2. A shot is coming: after the reaction delay, step across or dive.
  const shot = predictShot(state, p);
  if (shot) {
    if (m.shotReact < 0) {
      // First sight of the shot: start the reaction delay and misjudge the line a little.
      m.shotReact = prof.keeperReaction;
      m.saveError = (nextRandom(ai) * 2 - 1) * prof.keeperError;
    }
    m.shotReact = Math.max(0, m.shotReact - dt);
    if (m.shotReact === 0 && p.tackleTimer === 0) {
      m.intent = 'save';
      const y = shot.y + m.saveError;
      const spot = { x: p.pos.x, y };
      m.target = spot;
      const gap = Math.abs(y - p.pos.y);
      const reach = p.radius + BALL_RADIUS;
      const walk = PLAYER_MAX_SPEED * prof.keeperSpeed * Math.max(0, shot.time - 0.05) * 0.7;
      // Dive only when the slide will have carried the keeper about to the ball's line as it arrives.
      const dive = diveDistance(shot.time);
      if (gap > walk + reach * 0.5 && dive + reach >= gap && dive - reach <= gap && p.tackleCooldown === 0 && !p.prevTackle) {
        return { ...IDLE, moveY: Math.sign(y - p.pos.y), tackle: true }; // dive: a short burst sideways
      }
      return moveToward(p, spot, 6, prof.keeperSpeed);
    }
    if (p.tackleTimer > 0) m.intent = 'save';
  } else {
    m.shotReact = -1;
  }

  // 3. Come out for a loose ball (or a carrier) close to goal when the keeper gets there first.
  const ip = ctx.intercept[p.id];
  const inZone = (v: Vec2): boolean => along(v.x, dir) < AI_KEEPER_RUSH_RANGE && Math.abs(v.y - MID_Y) < PENALTY_BOX_HEIGHT / 2;
  const carrier = ctx.owner >= 0 ? state.players[ctx.owner] : null;
  let rush = false;
  if (!carrier || carrier.team !== p.team) {
    let oppBest = Infinity;
    let mateBest = Infinity;
    for (const q of state.players) {
      if (q.id === p.id) continue;
      if (q.team === p.team) mateBest = Math.min(mateBest, ctx.intercept[q.id].time);
      else oppBest = Math.min(oppBest, ctx.intercept[q.id].time);
    }
    if (!carrier && inZone(ip.point) && ip.time < oppBest + 0.1 && ip.time < mateBest - 0.1) rush = true;
    if (!carrier && ballInOwnGoalMouth(state, p.team)) rush = true; // nobody else can safely play it
    if (carrier && inZone(carrier.pos) && Math.abs(carrier.pos.x - goalX) < 110) rush = true; // smother a 1-on-1
  }
  if (rush && !shot) {
    m.intent = 'rush';
    m.target = carrier && carrier.team !== p.team ? { ...ball.pos } : ip.point;
    return moveToward(p, m.target, 8, speed);
  }

  // 4. Otherwise: position on the angle between the ball and the goal centre.
  if (!shot) m.intent = 'position';
  m.target = keeperPosition(state, p);
  return moveToward(p, m.target, 25, speed);
}

/** Keeper on the ball: pass to the most open teammate with a clear lane, or clear it long if no one is. */
function chooseDistribution(state: GameState, p: PlayerState, m: AiPlayerMemory, prof: AiProfile): void {
  const { ai } = state;
  let best = -1;
  let bestScore = 0.3; // below this, just clear it
  let bestPoint = { x: 0, y: 0 };
  for (const t of state.players) {
    if (t.team !== p.team || t.id === p.id) continue;
    const len = dist(p.pos, t.pos);
    if (len > AI_PASS_MAX + 150) continue;
    const lane = laneClearance(state, p.team, p.pos, t.pos);
    if (lane < 5) continue;
    const open = Math.min(150, nearestOpponentDist(state, p.team, t.pos)) / 150;
    const score = open + Math.min(lane, 40) / 100 + (nextRandom(ai) - 0.5) * prof.decisionNoise;
    if (score > bestScore) {
      bestScore = score;
      best = t.id;
      bestPoint = { ...t.pos };
    }
  }
  if (best >= 0) {
    m.receiver = best;
    m.kickTarget = bestPoint;
    m.kickSpeed = kickSpeedForDistance(dist(p.pos, bestPoint));
  } else {
    m.receiver = -1;
    m.kickTarget = clearTarget(state, p);
    m.kickSpeed = SHOT_MAX_SPEED * 0.85;
  }
  m.kickError = (nextRandom(ai) * 2 - 1) * prof.aimError * 0.6;
  m.kickTimer = 0;
}

/* ------------------------------------------------------------------------------------------------
 * Entry point
 * ---------------------------------------------------------------------------------------------- */

/**
 * The InputFrame every player would produce this tick if the AI drove it. Updates state.ai (memory, RNG,
 * team modes, counters) and nothing else. `human[team]` says whether that team's controlled player is
 * driven by a human this tick (its frame here is then idle and ignored).
 */
export function computeAiInputs(
  state: GameState,
  human: [boolean, boolean] = [state.controlled[0] >= 0, state.controlled[1] >= 0],
  dt = SIM_DT,
): InputFrame[] {
  const ctx = analyse(state, human);
  updateTeams(state, ctx, dt);
  return state.players.map((p) => {
    const m = state.ai.players[p.id];
    m.thinkTimer -= dt;
    m.cooldown = Math.max(0, m.cooldown - dt);
    m.runTimer = Math.max(0, m.runTimer - dt);
    if (m.kickPending) {
      // Last tick's kick input: a kick starts the player's kick flash, so this confirms the ball was struck. A kick
      // still waiting in the kick buffer stays pending.
      if (p.kickFlash >= KICK_FLASH_TIME - 1e-9) {
        m.kickPending = false;
        registerKick(state, p, m);
      } else if (p.kickQueue <= 1e-9) m.kickPending = false;
    }
    if (human[p.team] && state.controlled[p.team] === p.id) {
      m.intent = 'human';
      m.target = { ...p.pos };
      m.thinkTimer = 0;
      return { ...IDLE };
    }
    const prof = profileOf(state, p.team);
    return p.role === 'keeper' ? keeperInput(state, ctx, p, m, prof, dt) : outfieldInput(state, ctx, p, m, prof, dt);
  });
}

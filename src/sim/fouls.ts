// Fouls (T19): the referee's calls on slides and late challenges, free-kick walls, and the penalty and shoot-out
// helpers (spots, where everyone waits, takers, who has won). Pure. Awarding the free kick / penalty is in rules.ts.
import {
  FOUL_CONTACT_SLACK,
  FOUL_LATE_BALL_GAP,
  FOUL_PROFILES,
  FOUL_RECKLESS_SPEED,
  FREE_KICK_CLEAR_RADIUS,
  FREE_KICK_WALL_RANGE,
  FREE_KICK_WALL_TWO_RANGE,
  PENALTY_BOX_HEIGHT,
  PENALTY_BOX_WIDTH,
  PENALTY_SPOT_DISTANCE,
  PITCH_BOTTOM,
  PITCH_LEFT,
  PITCH_RIGHT,
  PITCH_TOP,
  PLAYER_RADIUS,
  SENT_OFF_POS,
  SIM_DT,
  SHOOTOUT_KICKS,
  SHOOTOUT_MAX_ROUNDS,
} from '../config';
import { angleDiff } from './dribble';
import { foulsOn } from './matchRules';
import type { GameState, PlayerState, Restart, ShootoutRecord, TeamId, Vec2 } from './types';

const MID_X = (PITCH_LEFT + PITCH_RIGHT) / 2;
const MID_Y = (PITCH_TOP + PITCH_BOTTOM) / 2;
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

/** On the pitch (not sent off). */
export const inPlay = (p: PlayerState): boolean => !p.sentOff;

/** X of the goal line `team` defends. */
export function ownGoalLine(state: GameState, team: TeamId): number {
  return state.attackDir[team] > 0 ? PITCH_LEFT : PITCH_RIGHT;
}

/** Is `pos` inside the penalty box in front of the goal line at `goalX`? */
export function inPenaltyBox(pos: Vec2, goalX: number): boolean {
  return Math.abs(pos.x - goalX) <= PENALTY_BOX_WIDTH && Math.abs(pos.y - MID_Y) <= PENALTY_BOX_HEIGHT / 2;
}

/** The penalty spot in front of the goal line at `goalX`. */
export function penaltySpot(goalX: number): Vec2 {
  return { x: goalX + (goalX < MID_X ? 1 : -1) * PENALTY_SPOT_DISTANCE, y: MID_Y };
}

export interface FoulCall {
  offender: number;
  victim: number;
  /** A slide from behind, or into the player first at speed: a yellow card when cards are on. */
  reckless: boolean;
  kind: 'slide' | 'late';
  /** Where it happened (the fouled player, at the moment of contact). */
  spot: Vec2;
}

/** Is `from` behind `p`: within `angle` rad of straight behind the way `p` runs (or faces, standing)? */
export function fromBehind(p: PlayerState, from: Vec2, angle: number): boolean {
  const sp = Math.hypot(p.vel.x, p.vel.y);
  const heading = sp > 40 ? Math.atan2(p.vel.y, p.vel.x) : p.facing;
  const a = Math.atan2(from.y - p.pos.y, from.x - p.pos.x);
  return Math.abs(angleDiff(a, heading + Math.PI)) <= angle;
}

const touching = (a: PlayerState, b: PlayerState): boolean => dist(a.pos, b.pos) <= a.radius + b.radius + FOUL_CONTACT_SLACK;

/** How fast `c` is closing on `o` (px/s, along the line between them). */
export function closingSpeed(c: PlayerState, o: PlayerState): number {
  const d = dist(c.pos, o.pos) || 1;
  return ((c.vel.x - o.vel.x) * (o.pos.x - c.pos.x) + (c.vel.y - o.vel.y) * (o.pos.y - c.pos.y)) / d;
}

/**
 * The referee, once a tick after everyone has moved (before bodies are pushed apart). A slide is judged once
 * (PlayerState.slideJudged): from behind an (involved) opponent it is a foul at once; reaching an involved opponent
 * before the ball, it is a foul unless it gets the ball within the profile's grace (PlayerState.slideVictim). A
 * standing challenge is a foul only if clearly late. See FOUL_PROFILES. Null = play on. Nothing is called with fouls
 * off, at a set piece or while a penalty is being decided.
 */
export function detectFoul(state: GameState): FoulCall | null {
  if (!foulsOn(state.rules) || state.phase !== 'playing' || state.restart || state.penalty) return null;
  const prof = FOUL_PROFILES[state.rules.fouls as 'lenient' | 'strict'];
  const { players, ball } = state;
  for (const s of players) {
    if (s.sentOff || s.role === 'keeper' || s.slideJudged) continue;
    if (s.slideVictim >= 0) {
      // Reached the player first: fair if the ball follows straight away, a foul if it doesn't.
      if (s.slideBall) s.slideJudged = true;
      else if (s.tackleTimer <= 0 || (state.tick - s.slideContactTick) * SIM_DT >= prof.ballGrace) {
        s.slideJudged = true;
        // Still at full stretch: reckless (a card).
        return { offender: s.id, victim: s.slideVictim, reckless: Math.hypot(s.vel.x, s.vel.y) >= FOUL_RECKLESS_SPEED, kind: 'slide', spot: { x: s.slideSpotX, y: s.slideSpotY } };
      }
      continue;
    }
    if (s.tackleTimer <= 0) continue;
    for (const o of players) {
      if (o.team === s.team || o.sentOff || !touching(s, o) || closingSpeed(s, o) < prof.minImpact) continue;
      const involved = state.possession?.player === o.id || dist(o.pos, ball.pos) - o.radius - ball.radius <= prof.involvedRange;
      if (fromBehind(o, s.pos, prof.behindAngle) && (involved || !prof.behindInvolved) && (!s.slideBall || prof.behindWithBall)) {
        s.slideJudged = true;
        return { offender: s.id, victim: o.id, reckless: true, kind: 'slide', spot: { ...o.pos } };
      }
      const reach = dist(s.pos, ball.pos) - s.radius - ball.radius;
      if (!involved || s.slideBall || reach <= prof.missGap) continue;
      s.slideVictim = o.id;
      s.slideContactTick = state.tick;
      s.slideSpotX = o.pos.x;
      s.slideSpotY = o.pos.y;
      break;
    }
  }
  for (const c of players) {
    if (c.sentOff || c.role === 'keeper' || c.tackleTimer > 0) continue;
    for (const o of players) {
      if (o.team === c.team || o.sentOff || o.kickAge < prof.lateMinAge || o.kickAge > prof.lateMaxAge || !touching(c, o)) continue;
      if (dist(o.pos, ball.pos) < FOUL_LATE_BALL_GAP) continue;
      if (closingSpeed(c, o) >= prof.lateSpeed) return { offender: c.id, victim: o.id, reckless: false, kind: 'late', spot: { ...o.pos } };
    }
  }
  return null;
}

/** Takes `p` off the pitch for the rest of the half (a second yellow): parked far away, out of every contest. */
export function sendOff(p: PlayerState): void {
  p.sentOff = true;
  p.pos = { ...SENT_OFF_POS };
  p.vel = { x: 0, y: 0 };
  p.charge = 0;
  p.tackleTimer = 0;
  p.windup = 0;
  p.kickQueue = 0;
}

/** Back on for a new half: sent-off players return (to `pos`), and yellow cards are wiped. */
export function clearCards(players: PlayerState[], pos: (p: PlayerState) => Vec2): void {
  for (const p of players) {
    if (p.sentOff) p.pos = pos(p);
    p.sentOff = false;
    p.yellow = 0;
  }
}

/** Keeps a point inside the pitch, `margin` px from the lines. */
function inside(v: Vec2, margin: number): Vec2 {
  return { x: Math.min(PITCH_RIGHT - margin, Math.max(PITCH_LEFT + margin, v.x)), y: Math.min(PITCH_BOTTOM - margin, Math.max(PITCH_TOP + margin, v.y)) };
}

/** How far out from the ball the wall stands: just outside the distance the defenders are kept back. */
export const WALL_DISTANCE = FREE_KICK_CLEAR_RADIUS + PLAYER_RADIUS + 1;

/**
 * A free kick within shooting range of the goal (FREE_KICK_WALL_RANGE): 1 or 2 of the defending team's AI outfield
 * players (never its human's) are put in a wall on the line from the ball to the goal centre, WALL_DISTANCE out, side
 * by side, facing the ball. Returns their ids (none when out of range).
 */
export function placeWall(state: GameState, r: Restart): number[] {
  const def = (1 - r.team) as TeamId;
  const goal = { x: ownGoalLine(state, def), y: MID_Y };
  const d = dist(r.pos, goal);
  if (d > FREE_KICK_WALL_RANGE || d < 1) return [];
  const n = d <= FREE_KICK_WALL_TWO_RANGE ? 2 : 1;
  const u = { x: (goal.x - r.pos.x) / d, y: (goal.y - r.pos.y) / d };
  const centre = { x: r.pos.x + u.x * WALL_DISTANCE, y: r.pos.y + u.y * WALL_DISTANCE };
  const human = state.controlled[def];
  const picks = state.players
    .filter((p) => p.team === def && p.role !== 'keeper' && inPlay(p) && p.id !== human)
    .sort((a, b) => dist(a.pos, centre) - dist(b.pos, centre) || a.id - b.id)
    .slice(0, n);
  const offsets = picks.length === 2 ? [-(PLAYER_RADIUS + 1), PLAYER_RADIUS + 1] : [0];
  picks.forEach((p, i) => {
    p.pos = inside({ x: centre.x - u.y * offsets[i], y: centre.y + u.x * offsets[i] }, p.radius);
    p.vel = { x: 0, y: 0 };
    p.facing = Math.atan2(r.pos.y - p.pos.y, r.pos.x - p.pos.x);
    p.tackleTimer = 0;
    p.windup = 0;
    p.charge = 0;
  });
  return picks.map((p) => p.id);
}

/** Where the `n` players not involved in a penalty at the goal line `goalX` wait: in a line just outside the box. */
export function penaltyWaitSpots(goalX: number, n: number): Vec2[] {
  const x = goalX + (goalX < MID_X ? 1 : -1) * (PENALTY_BOX_WIDTH + 34);
  const gap = Math.min(40, (PENALTY_BOX_HEIGHT - 20) / Math.max(1, n - 1));
  return Array.from({ length: n }, (_, i) => ({ x, y: MID_Y + (i - (n - 1) / 2) * gap }));
}

/** Where the `n` players not involved in a shoot-out kick wait: along the halfway line. */
export function shootoutWaitSpots(n: number): Vec2[] {
  return Array.from({ length: n }, (_, i) => ({ x: MID_X, y: MID_Y + (i - (n - 1) / 2) * 46 }));
}

/** Who takes `team`'s `k`-th shoot-out kick (0-based): its outfield players in turn, attackers first, then round again. */
export function shootoutTaker(state: GameState, team: TeamId, k: number): PlayerState {
  const order = state.players.filter((p) => p.team === team && p.role !== 'keeper' && inPlay(p)).sort((a, b) => b.slot - a.slot || a.id - b.id);
  return order.length ? order[k % order.length] : state.players.find((p) => p.team === team)!;
}

/** Goals and kicks taken per team so far. */
export function shootoutTally(rec: Pick<ShootoutRecord, 'first' | 'kicks'>): { goals: [number, number]; taken: [number, number] } {
  const goals: [number, number] = [0, 0];
  const taken: [number, number] = [0, 0];
  rec.kicks.forEach((scored, i) => {
    const t = (rec.first + i) % 2;
    taken[t]++;
    if (scored) goals[t]++;
  });
  return { goals, taken };
}

/** Which team takes the next kick. */
export function shootoutNextTeam(rec: Pick<ShootoutRecord, 'first' | 'kicks'>): TeamId {
  return ((rec.first + rec.kicks.length) % 2) as TeamId;
}

/**
 * Has the shoot-out been won? Best of `best` kicks each (over as soon as one team can't catch up), then sudden death:
 * after each pair of kicks, whoever is ahead wins. Null while it goes on.
 */
export function shootoutWinner(rec: Pick<ShootoutRecord, 'first' | 'kicks'>, best = SHOOTOUT_KICKS): TeamId | null {
  const { goals, taken } = shootoutTally(rec);
  const a = rec.first;
  const b = (1 - a) as TeamId;
  if (taken[a] <= best && taken[b] <= best) {
    if (goals[a] > goals[b] + (best - taken[b])) return a;
    if (goals[b] > goals[a] + (best - taken[a])) return b;
    return null;
  }
  if (taken[a] !== taken[b]) return null;
  if (goals[a] !== goals[b]) return goals[a] > goals[b] ? a : b;
  return taken[a] >= SHOOTOUT_MAX_ROUNDS ? a : null;
}

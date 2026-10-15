// Match rules: phases, kickoff, goals, out of play (throw-in / goal kick / corner), timer, halves, events. Pure.
import {
  GOAL_KICK_DISTANCE,
  GOAL_PAUSE,
  HALF_TIME_PAUSE,
  HALVES,
  KICKOFF_DELAY,
  MAX_EVENTS,
  OUT_REST_SPEED,
  PITCH_BOTTOM,
  PITCH_LEFT,
  PITCH_RIGHT,
  PITCH_TOP,
  CENTRE_CIRCLE_RADIUS,
  RESTART_AUTO_DELAY,
  RESTART_AUTO_DELAY_CORNER,
  RESTART_AUTO_DELAY_HUMAN,
  RESTART_CLEAR_RADIUS,
  RESTART_INSET,
  RESTART_PLAYED_DISTANCE,
  RESTART_TAKER_GAP,
  THROW_IN_MIN_END_DISTANCE,
} from '../config';
import { formationPosition, resetAiPlans } from './ai';
import { autoPlayRestart, inwardDirection, releaseRestart } from './setpiece';
import type { GameState, MatchEvent, MatchPhase, PlayerState, Restart, RestartType, TeamId, Vec2 } from './types';

const MID_X = (PITCH_LEFT + PITCH_RIGHT) / 2;
const MID_Y = (PITCH_TOP + PITCH_BOTTOM) / 2;

/** Phases in which nothing moves: the sim only runs the rules' timers. */
export function isFrozen(phase: MatchPhase): boolean {
  return phase === 'pre-kickoff' || phase === 'half-time' || phase === 'full-time';
}

/** Seconds played in the whole match (both halves). */
export function matchClock(state: GameState): number {
  return (state.half - 1) * state.halfLength + state.clock;
}

/** Appends an event to the state's capped event list. */
export function pushEvent(state: GameState, type: MatchEvent['type'], extra: Partial<MatchEvent> = {}): MatchEvent {
  const event: MatchEvent = {
    id: state.nextEventId++,
    tick: state.tick,
    type,
    half: state.half,
    clock: state.clock,
    score: [state.score[0], state.score[1]],
    ...extra,
  };
  state.events.push(event);
  if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
  return event;
}

/** The team that defends the goal line on the left (side < 0) or right (side > 0). */
function defenderOf(state: GameState, side: -1 | 1): TeamId {
  // A team attacking right (attackDir > 0) defends the left goal.
  return (state.attackDir[0] > 0 ? side < 0 : side > 0) ? 0 : 1;
}

/** Players back to formation, ball on the centre spot, nothing in flight. */
export function resetForKickoff(state: GameState): void {
  for (const p of state.players) {
    p.pos = formationPosition(p.slot, state.attackDir[p.team]);
    p.vel = { x: 0, y: 0 };
    p.facing = state.attackDir[p.team] > 0 ? 0 : Math.PI;
    p.charge = 0;
    p.tackleTimer = 0;
    p.tackleCooldown = 0;
    p.touchTimer = 0;
    p.kickQueue = 0;
    p.kickFlash = 0;
  }
  state.ball.pos = { x: MID_X, y: MID_Y };
  state.ball.vel = { x: 0, y: 0 };
  state.possession = null;
  state.lastTouch = null;
  state.restart = null;
  state.grace = null;
  resetAiPlans(state.ai);
}

/** Teams back in their halves for `team` to kick off; play starts after KICKOFF_DELAY. */
export function startKickoff(state: GameState, team: TeamId): void {
  resetForKickoff(state);
  state.kickoffTeam = team;
  state.phase = 'pre-kickoff';
  state.phaseTimer = KICKOFF_DELAY;
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Who takes a set piece: the team's controlled outfield player if asked, else the outfield player nearest the spot (the keeper for goal kicks). */
function chooseTaker(state: GameState, team: TeamId, spot: Vec2, type: RestartType): PlayerState | undefined {
  const mine = state.players.filter((p) => p.team === team);
  if (type === 'goal-kick') return mine.find((p) => p.role === 'keeper') ?? mine[0];
  const outfield = mine.filter((p) => p.role !== 'keeper');
  if (outfield.length === 0) return undefined;
  const controlled = state.controlled[team];
  if (type === 'kickoff' && controlled >= 0 && state.players[controlled].role !== 'keeper') return state.players[controlled];
  let best = outfield[0];
  for (const p of outfield) if (dist(p.pos, spot) < dist(best.pos, spot)) best = p;
  return best;
}

/** Puts the ball on `pos` and a taker next to it (on the side of `side`, a unit vector; the taker faces the ball), and opens the restart. */
function setRestart(state: GameState, type: RestartType, team: TeamId, pos: Vec2, side: Vec2): void {
  const taker = chooseTaker(state, team, pos, type);
  state.possession = null;
  state.grace = null;
  state.ball.pos = { ...pos };
  state.ball.vel = { x: 0, y: 0 };
  if (!taker) {
    state.lastTouch = null;
    state.restart = null;
    if (type !== 'kickoff') pushEvent(state, type, { team });
    return;
  }
  const gap = taker.radius + state.ball.radius + RESTART_TAKER_GAP;
  taker.pos = { x: pos.x + side.x * gap, y: pos.y + side.y * gap };
  taker.vel = { x: 0, y: 0 };
  taker.charge = 0;
  taker.tackleTimer = 0;
  taker.touchTimer = 0;
  taker.kickQueue = 0;
  // Faces the ball, so a tap of pass sends it back out into play.
  taker.facing = Math.atan2(-side.y, -side.x);
  if (state.controlled[team] >= 0 && taker.role !== 'keeper') state.controlled[team] = taker.id;
  state.lastTouch = { team, player: taker.id };
  // A human taker gets longer to aim before it is played for them (see autoPlayRestart).
  const human = state.controlled[team] === taker.id;
  const timer = human ? RESTART_AUTO_DELAY_HUMAN : type === 'corner' ? RESTART_AUTO_DELAY_CORNER : RESTART_AUTO_DELAY;
  state.restart = { type, team, pos: { ...pos }, taker: taker.id, timer };
  resetAiPlans(state.ai);
  if (type !== 'kickoff') pushEvent(state, type, { team });
}

/** Play starts: kickoff restart for state.kickoffTeam. */
function beginPlay(state: GameState): void {
  state.phase = 'playing';
  const dir = state.attackDir[state.kickoffTeam];
  setRestart(state, 'kickoff', state.kickoffTeam, { x: MID_X, y: MID_Y }, { x: -dir, y: 0 });
  pushEvent(state, 'kickoff', { team: state.kickoffTeam });
}

/**
 * Keeps the opposition clear of a pending restart and releases it once played. When its timer runs out a throw-in (or a
 * human's kick) is played automatically to a teammate; an AI's kick is just released.
 */
function updateRestart(state: GameState, dt: number): void {
  const r: Restart | null = state.restart;
  if (!r) return;
  r.timer -= dt;
  if (dist(state.ball.pos, r.pos) > RESTART_PLAYED_DISTANCE) {
    releaseRestart(state);
    return;
  }
  if (r.timer <= 0) {
    if (!autoPlayRestart(state, state.controlled[r.team] === r.taker)) releaseRestart(state);
    return;
  }
  const clear = r.type === 'kickoff' ? CENTRE_CIRCLE_RADIUS : RESTART_CLEAR_RADIUS;
  for (const p of state.players) {
    if (p.team === r.team) continue;
    const dx = p.pos.x - r.pos.x;
    const dy = p.pos.y - r.pos.y;
    const d = Math.hypot(dx, dy);
    const min = clear + p.radius;
    if (d >= min) continue;
    // Push straight away from the ball (towards the pitch centre if exactly on it), then keep on the pitch.
    const nx = d > 1e-9 ? dx / d : MID_X > r.pos.x ? 1 : -1;
    const ny = d > 1e-9 ? dy / d : 0;
    p.pos.x = Math.min(PITCH_RIGHT - p.radius, Math.max(PITCH_LEFT + p.radius, r.pos.x + nx * min));
    p.pos.y = Math.min(PITCH_BOTTOM - p.radius, Math.max(PITCH_TOP + p.radius, r.pos.y + ny * min));
    p.vel = { x: 0, y: 0 };
  }
}

/** The ball is out over a touchline: throw-in for the team that did not touch it last. */
function throwIn(state: GameState): void {
  const { ball } = state;
  const last = state.lastTouch?.team ?? 1 - state.kickoffTeam;
  const top = ball.pos.y < MID_Y;
  const x = Math.min(PITCH_RIGHT - THROW_IN_MIN_END_DISTANCE, Math.max(PITCH_LEFT + THROW_IN_MIN_END_DISTANCE, ball.pos.x));
  const y = top ? PITCH_TOP + RESTART_INSET : PITCH_BOTTOM - RESTART_INSET;
  // The taker stands on the touchline side of the ball, facing into the pitch.
  setRestart(state, 'throw-in', (1 - last) as TeamId, { x, y }, { x: 0, y: top ? -1 : 1 });
}

/** The ball is out over an end line (outside the goal mouth): corner if the defenders touched it last, else goal kick. */
function goalLineOut(state: GameState, side: -1 | 1): void {
  const { ball } = state;
  const defender = defenderOf(state, side);
  const last = state.lastTouch?.team ?? (1 - defender);
  if (last === defender) {
    const attacker = (1 - defender) as TeamId;
    const sx = side < 0 ? 1 : -1; // direction into the pitch along x
    const top = ball.pos.y < MID_Y;
    const pos = { x: side < 0 ? PITCH_LEFT + RESTART_INSET : PITCH_RIGHT - RESTART_INSET, y: top ? PITCH_TOP + RESTART_INSET : PITCH_BOTTOM - RESTART_INSET };
    const k = Math.SQRT1_2;
    setRestart(state, 'corner', attacker, pos, { x: -sx * k, y: top ? -k : k });
  } else {
    const sx = side < 0 ? 1 : -1;
    const pos = { x: (side < 0 ? PITCH_LEFT : PITCH_RIGHT) + sx * GOAL_KICK_DISTANCE, y: MID_Y };
    // The keeper stands between the ball and its own goal.
    setRestart(state, 'goal-kick', defender, pos, { x: -sx, y: 0 });
  }
}

/**
 * Grace period: the restart just taken went straight back out without anyone but the taker touching it, so the same team
 * takes it again from the same spot.
 */
function retake(state: GameState): void {
  const g = state.grace!;
  const inward = inwardDirection(g.type, g.pos);
  const side = inward ? { x: -inward.x, y: -inward.y } : { x: -state.attackDir[g.team], y: 0 };
  setRestart(state, g.type, g.team, g.pos, side);
}

/** The grace period runs out, or ends with a touch from anyone but the taker. */
function updateGrace(state: GameState, dt: number): void {
  const g = state.grace;
  if (!g) return;
  g.timer -= dt;
  if (g.timer <= 0 || (state.lastTouch && state.lastTouch.player !== g.taker)) state.grace = null;
}

function scoreGoal(state: GameState, side: -1 | 1): void {
  const conceding = defenderOf(state, side);
  const scorer = (1 - conceding) as TeamId;
  state.score[scorer] += 1;
  const last = state.lastTouch;
  state.phase = 'goal-scored';
  state.phaseTimer = GOAL_PAUSE;
  state.possession = null;
  state.restart = null;
  state.grace = null;
  state.kickoffTeam = conceding;
  const ownGoal = !!last && last.team === conceding;
  state.stats.goals.push({ team: scorer, player: last ? last.player : -1, ownGoal, half: state.half, clock: state.clock });
  pushEvent(state, 'goal', { team: scorer, player: last ? last.player : -1, ownGoal });
}

function endHalf(state: GameState): void {
  state.restart = null;
  state.grace = null;
  state.possession = null;
  if (state.half < HALVES) {
    state.phase = 'half-time';
    state.phaseTimer = HALF_TIME_PAUSE;
    pushEvent(state, 'half-time');
  } else {
    state.phase = 'full-time';
    state.phaseTimer = 0;
    pushEvent(state, 'full-time');
  }
}

/** Goal / out-of-play checks for the ball, in open play. */
function checkBall(state: GameState): void {
  const { ball } = state;
  const r = ball.radius;
  const halfGoal = state.rules.goalWidth / 2;
  // The whole ball over a line is out. A ball that has come to rest with its centre beyond a line is out too: in a
  // corner pocket it can sit just short of "whole ball" where no player can reach it (players stay inside the lines).
  const resting = Math.hypot(ball.vel.x, ball.vel.y) < OUT_REST_SPEED;
  // How far the ball's centre is beyond the end lines (ex) and the touchlines (ey).
  const ex = Math.max(PITCH_LEFT - ball.pos.x, ball.pos.x - PITCH_RIGHT, 0);
  const ey = Math.max(PITCH_TOP - ball.pos.y, ball.pos.y - PITCH_BOTTOM, 0);
  if (ex === 0 && ey === 0) return;
  // Which line it goes over: the one its centre is beyond -- by the corner flag, where it is beyond both, the one it is
  // heading over more directly (T16: these were all throw-ins), or the end line for a ball at rest in the corner pocket.
  const endLine = ey === 0 || (ex > 0 && (resting || Math.abs(ball.vel.x) >= Math.abs(ball.vel.y)));
  const inGoalMouth = Math.abs(ball.pos.y - MID_Y) <= halfGoal;
  const whole = Math.hypot(ex, ey) > r; // no part of the ball is on the pitch
  if (!whole && !(resting && !(endLine && inGoalMouth))) return;
  if (endLine) {
    const side = ball.pos.x < PITCH_LEFT ? -1 : 1;
    if (inGoalMouth) scoreGoal(state, side);
    else if (state.grace) retake(state);
    else goalLineOut(state, side);
  } else if (state.grace) retake(state);
  else throwIn(state);
}

/** Advances the match flow by dt. Called by step() after the physics. */
export function updateRules(state: GameState, dt: number): void {
  switch (state.phase) {
    case 'pre-kickoff':
      state.phaseTimer -= dt;
      if (state.phaseTimer <= 0) beginPlay(state);
      break;
    case 'playing':
      state.clock = Math.min(state.halfLength, state.clock + dt);
      if (state.lastTouch) state.stats.possession[state.lastTouch.team] += dt;
      updateRestart(state, dt);
      updateGrace(state, dt);
      checkBall(state);
      if (state.phase === 'playing' && state.clock >= state.halfLength) endHalf(state);
      break;
    case 'goal-scored':
      state.phaseTimer -= dt;
      if (state.phaseTimer > 0) break;
      if (state.clock >= state.halfLength) endHalf(state);
      else startKickoff(state, state.kickoffTeam);
      break;
    case 'half-time':
      state.phaseTimer -= dt;
      if (state.phaseTimer > 0) break;
      state.half += 1;
      state.clock = 0;
      state.attackDir = [-state.attackDir[0], -state.attackDir[1]];
      startKickoff(state, ((state.firstKickoffTeam + state.half - 1) % 2) as TeamId);
      pushEvent(state, 'second-half');
      break;
    case 'full-time':
      break;
  }
}

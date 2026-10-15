import { describe, expect, it } from 'vitest';
import {
  BALL_RADIUS,
  GOAL_PAUSE,
  GOAL_WIDTH,
  HALF_LENGTH_SECONDS,
  HALF_TIME_PAUSE,
  KICKOFF_DELAY,
  MAX_EVENTS,
  PITCH_BOTTOM,
  PITCH_LEFT,
  PITCH_RIGHT,
  PITCH_TOP,
  RESTART_AUTO_DELAY_HUMAN,
  RESTART_CLEAR_RADIUS,
  SIM_DT,
} from '../src/config';
import { formationPosition } from '../src/sim/ai';
import { matchClock, pushEvent } from '../src/sim/rules';
import { cloneState, createInitialState, createMatchState, NEUTRAL_INPUT, step } from '../src/sim/simulation';
import type { GameState, MatchEvent, MatchEventType, TeamId } from '../src/sim/types';

const midX = (PITCH_LEFT + PITCH_RIGHT) / 2;
const midY = (PITCH_TOP + PITCH_BOTTOM) / 2;

function run(s: GameState, seconds: number): GameState {
  for (let i = 0; i < Math.round(seconds / SIM_DT); i++) s = step(s, [], SIM_DT);
  return s;
}

/** Steps until the pre-kickoff countdown ends (the kickoff restart has just been set up). */
function untilPlaying(s: GameState): GameState {
  for (let i = 0; i < 600 && s.phase !== 'playing'; i++) s = step(s, [], SIM_DT);
  return s;
}

/** A state in open play with the ball placed (and stationary). Team 0 attacks right, team 1 attacks left. */
function playing(x: number, y: number, lastTouch: TeamId | null = null): GameState {
  const s = createInitialState({ aiVsAi: true });
  s.ball.pos = { x, y };
  s.ball.vel = { x: 0, y: 0 };
  s.lastTouch = lastTouch === null ? null : { team: lastTouch, player: lastTouch * 5 + 1 };
  return s;
}

const eventTypes = (s: GameState): MatchEventType[] => s.events.map((e) => e.type);

/** Scores a goal in the left net (team 1 scores) or the right net (team 0 scores). */
function scoreLeft(s: GameState): GameState {
  s.ball.pos = { x: PITCH_LEFT - BALL_RADIUS - 5, y: midY };
  return step(s, [], SIM_DT);
}
function scoreRight(s: GameState): GameState {
  s.ball.pos = { x: PITCH_RIGHT + BALL_RADIUS + 5, y: midY };
  return step(s, [], SIM_DT);
}

describe('match start', () => {
  it('starts in pre-kickoff with everyone frozen in formation, then kicks off', () => {
    let s = createMatchState({ aiVsAi: true });
    expect(s.phase).toBe('pre-kickoff');
    const before = cloneState(s);
    s = run(s, KICKOFF_DELAY / 2);
    expect(s.phase).toBe('pre-kickoff');
    expect(s.players.map((p) => p.pos)).toEqual(before.players.map((p) => p.pos));
    expect(s.ball.pos).toEqual(before.ball.pos);
    s = untilPlaying(s);
    expect(s.phase).toBe('playing');
    expect(s.restart?.type).toBe('kickoff');
    expect(s.restart?.team).toBe(0);
    expect(eventTypes(s)).toEqual(['kickoff']);
  });

  it('places the kicking-off team next to the ball on the centre spot and keeps the other team out of the circle', () => {
    let s = untilPlaying(createMatchState({ aiVsAi: true }));
    const taker = s.players[s.restart!.taker];
    expect(taker.team).toBe(0);
    expect(Math.hypot(taker.pos.x - midX, taker.pos.y - midY)).toBeLessThan(taker.radius + BALL_RADIUS + 5);
    expect(taker.pos.x).toBeLessThan(midX); // in its own half
    expect(s.ball.pos).toEqual({ x: midX, y: midY });
    for (let i = 0; i < 30; i++) {
      s.ball.pos = { x: midX, y: midY }; // nobody plays it yet
      s = step(s, [], SIM_DT);
    }
    for (const p of s.players.filter((q) => q.team === 1)) {
      expect(Math.hypot(p.pos.x - midX, p.pos.y - midY)).toBeGreaterThanOrEqual(80);
    }
  });
});

describe('goals', () => {
  it('counts a goal when the whole ball is over the line between the posts', () => {
    const s = scoreLeft(playing(PITCH_LEFT + 30, midY, 1));
    expect(s.phase).toBe('goal-scored');
    expect(s.score).toEqual([0, 1]); // team 1 attacks the left goal
    const goal = s.events.find((e) => e.type === 'goal')!;
    expect(goal.team).toBe(1);
    expect(typeof goal.player).toBe('number');
    expect(goal.ownGoal).toBe(false);
    const r = scoreRight(playing(PITCH_RIGHT - 30, midY + 20, 0));
    expect(r.score).toEqual([1, 0]);
  });

  it('is not a goal while part of the ball is still on the line', () => {
    const s = playing(PITCH_LEFT - BALL_RADIUS + 3, midY);
    const n = step(s, [], SIM_DT);
    expect(n.phase).toBe('playing');
    expect(n.score).toEqual([0, 0]);
  });

  it('is not a goal outside the posts', () => {
    const s = playing(PITCH_LEFT - BALL_RADIUS - 2, midY - GOAL_WIDTH / 2 - 20, 0);
    const n = step(s, [], SIM_DT);
    expect(n.score).toEqual([0, 0]);
    expect(n.restart?.type).toBe('corner');
  });

  it('records an own goal for the other team', () => {
    const s = scoreLeft(playing(PITCH_LEFT + 30, midY, 0)); // team 0 defends the left goal
    expect(s.score).toEqual([0, 1]);
    expect(s.events.find((e) => e.type === 'goal')!.ownGoal).toBe(true);
  });

  it('pauses ~2 seconds, then lines up for a kickoff taken by the conceding team', () => {
    let s = scoreLeft(playing(PITCH_LEFT + 30, midY, 1));
    s = run(s, GOAL_PAUSE - 0.2);
    expect(s.phase).toBe('goal-scored');
    s = run(s, 0.3);
    expect(s.phase).toBe('pre-kickoff');
    expect(s.kickoffTeam).toBe(0);
    expect(s.ball.pos).toEqual({ x: midX, y: midY });
    for (const p of s.players) expect(p.pos).toEqual(formationPosition(p.slot, s.attackDir[p.team]));
    s = untilPlaying(s);
    expect(s.restart).toMatchObject({ type: 'kickoff', team: 0 });
  });

  it('alternates the kickoff: the team that conceded kicks off, whoever that is', () => {
    let s = scoreLeft(playing(PITCH_LEFT + 30, midY, 1));
    s = untilPlaying(run(s, GOAL_PAUSE + 0.05));
    expect(s.restart?.team).toBe(0);
    s = untilPlaying(run(scoreRight(s), GOAL_PAUSE + 0.05));
    expect(s.score).toEqual([1, 1]);
    expect(s.restart?.team).toBe(1);
    const goals = s.events.filter((e) => e.type === 'goal');
    expect(goals.map((e) => e.team)).toEqual([1, 0]);
  });

  it('does not score twice for one goal', () => {
    let s = scoreLeft(playing(PITCH_LEFT + 30, midY, 1));
    s = run(s, 1);
    expect(s.score).toEqual([0, 1]);
  });
});

describe('out of play', () => {
  it('gives a throw-in to the team that did not touch it last, placed inside the pitch', () => {
    const s = step(playing(400, PITCH_TOP - BALL_RADIUS - 2, 0), [], SIM_DT);
    expect(s.restart).toMatchObject({ type: 'throw-in', team: 1 });
    expect(s.ball.pos.y).toBeGreaterThan(PITCH_TOP + BALL_RADIUS);
    expect(s.ball.pos.y).toBeLessThan(PITCH_TOP + 50);
    expect(s.ball.pos.x).toBeCloseTo(400, 3);
    const taker = s.players[s.restart!.taker];
    expect(taker.team).toBe(1);
    expect(taker.role).toBe('outfield');
    expect(Math.hypot(taker.pos.x - s.ball.pos.x, taker.pos.y - s.ball.pos.y)).toBeLessThan(taker.radius + BALL_RADIUS + 5);
    expect(eventTypes(s)).toContain('throw-in');
  });

  it('stands the taker on the line side of the ball, facing into the pitch (a touch cannot send it straight out)', () => {
    for (const [y, into] of [[PITCH_TOP - BALL_RADIUS - 2, 1], [PITCH_BOTTOM + BALL_RADIUS + 2, -1]] as const) {
      const s = step(playing(500, y, 0), [], SIM_DT);
      const taker = s.players[s.restart!.taker];
      expect((s.ball.pos.y - taker.pos.y) * into).toBeGreaterThan(0); // ball is further into the pitch than the taker
      expect(Math.sin(taker.facing) * into).toBeGreaterThan(0.9);
      expect(taker.pos.y).toBeGreaterThanOrEqual(PITCH_TOP + taker.radius - 1e-6);
      expect(taker.pos.y).toBeLessThanOrEqual(PITCH_BOTTOM - taker.radius + 1e-6);
    }
  });

  it('calls a ball that comes to rest beyond a line out, even if not wholly over it (corner pocket: no player can reach it)', () => {
    // Centre 8.8 px past both the bottom line and the right end line: less than a ball radius, so not "wholly over".
    const s = step(playing(PITCH_RIGHT + BALL_RADIUS - 0.8, PITCH_BOTTOM + BALL_RADIUS - 0.2, 0), [], SIM_DT);
    expect(s.restart?.type).toBe('goal-kick'); // team 0 (attacking right) touched it last, so the defenders get a goal kick
    // The same ball still rolling fast is left alone until it has fully crossed.
    const moving = playing(PITCH_RIGHT + 4, PITCH_BOTTOM + 4, 0);
    moving.ball.vel = { x: 100, y: 100 };
    expect(step(moving, [], SIM_DT).restart).toBeNull();
  });

  it('handles the bottom touchline too', () => {
    const s = step(playing(600, PITCH_BOTTOM + BALL_RADIUS + 2, 1), [], SIM_DT);
    expect(s.restart).toMatchObject({ type: 'throw-in', team: 0 });
    expect(s.ball.pos.y).toBeLessThan(PITCH_BOTTOM);
  });

  it('gives a goal kick to the defenders when the attackers put it over the end line', () => {
    const s = step(playing(PITCH_LEFT - BALL_RADIUS - 2, PITCH_TOP + 60, 1), [], SIM_DT);
    expect(s.restart).toMatchObject({ type: 'goal-kick', team: 0 });
    expect(s.players[s.restart!.taker].role).toBe('keeper');
    expect(s.ball.pos.x).toBeGreaterThan(PITCH_LEFT + 30);
    expect(s.ball.pos.y).toBeCloseTo(midY, 3);
  });

  it('gives a corner to the attackers when the defenders put it over their own end line', () => {
    const s = step(playing(PITCH_RIGHT + BALL_RADIUS + 2, PITCH_BOTTOM - 80, 1), [], SIM_DT); // team 1 defends the right goal
    expect(s.restart).toMatchObject({ type: 'corner', team: 0 });
    expect(s.ball.pos.x).toBeGreaterThan(PITCH_RIGHT - 50);
    expect(s.ball.pos.y).toBeGreaterThan(PITCH_BOTTOM - 50);
    expect(eventTypes(s)).toContain('corner');
  });

  it('keeps the other team away until the throw-in is taken, and throws it for an idle human after RESTART_AUTO_DELAY_HUMAN', () => {
    // The taking team has an idle human, so its taker (who is given the ball) just stands there.
    const start = playing(400, PITCH_TOP - BALL_RADIUS - 2, 0);
    start.controlled = [-1, 9];
    const idle = [undefined, { ...NEUTRAL_INPUT }];
    let s = step(start, idle, SIM_DT);
    const spot = { ...s.restart!.pos };
    let checked = 0;
    for (let i = 0; i < 20 && s.restart; i++) {
      s = step(s, idle, SIM_DT);
      checked++;
      for (const p of s.players.filter((q) => q.team === 0)) {
        expect(Math.hypot(p.pos.x - spot.x, p.pos.y - spot.y)).toBeGreaterThanOrEqual(RESTART_CLEAR_RADIUS - 1);
      }
    }
    expect(checked).toBe(20);
    for (let i = 0; i < Math.round(RESTART_AUTO_DELAY_HUMAN / SIM_DT) - 30; i++) s = step(s, idle, SIM_DT);
    expect(s.restart?.type).toBe('throw-in'); // still waiting for the human
    expect(s.ball.pos).toEqual(spot);
    for (let i = 0; i < 20; i++) s = step(s, idle, SIM_DT);
    expect(s.restart).toBeNull();
    expect(s.ball.pos.y).toBeGreaterThan(spot.y); // thrown into the pitch
    expect(s.phase).toBe('playing');
  });

  it('releases a kicked restart as soon as the ball is played', () => {
    let s = step(playing(PITCH_RIGHT + BALL_RADIUS + 2, PITCH_BOTTOM - 80, 0), [], SIM_DT); // a goal kick
    expect(s.restart?.type).toBe('goal-kick');
    s.ball.pos.x += 20; // someone kicked it away from the spot
    s = step(s, [], SIM_DT);
    expect(s.restart).toBeNull();
  });

  it('hands control to the taker on the human team', () => {
    const s0 = playing(400, PITCH_TOP - BALL_RADIUS - 2, 1); // team 0 gets it
    s0.controlled = [4, -1];
    const s = step(s0, [], SIM_DT);
    expect(s.restart!.team).toBe(0);
    expect(s.controlled[0]).toBe(s.restart!.taker);
  });
});

describe('timer, halves and full time', () => {
  it('runs the clock only in open play', () => {
    let s = run(createMatchState({ aiVsAi: true }), KICKOFF_DELAY / 2);
    expect(s.clock).toBe(0);
    s = run(s, KICKOFF_DELAY);
    expect(s.clock).toBeGreaterThan(0);
    expect(matchClock(s)).toBe(s.clock);
  });

  it('ends the first half at the configured length, then half-time, then swaps ends for the second half', () => {
    let s = playing(midX, midY);
    s.clock = HALF_LENGTH_SECONDS - 0.01;
    s.score = [2, 1];
    s = run(s, 0.1);
    expect(s.phase).toBe('half-time');
    expect(eventTypes(s)).toContain('half-time');
    expect(s.half).toBe(1);
    // Frozen while the half-time screen is up.
    const frozen = cloneState(s);
    s = run(s, HALF_TIME_PAUSE / 2);
    expect(s.players.map((p) => p.pos)).toEqual(frozen.players.map((p) => p.pos));
    expect(s.phase).toBe('half-time');

    s = run(s, HALF_TIME_PAUSE / 2 + 0.05);
    expect(s.phase).toBe('pre-kickoff');
    expect(s.half).toBe(2);
    expect(s.clock).toBe(0);
    expect(s.attackDir).toEqual([-1, 1]);
    expect(s.score).toEqual([2, 1]);
    expect(s.kickoffTeam).toBe(1); // the other team kicks off the second half
    // Home now defends the right goal: its keeper stands there.
    const keeper = s.players[0];
    expect(keeper.pos.x).toBeGreaterThan(midX);
    expect(matchClock(s)).toBe(HALF_LENGTH_SECONDS);
    s = untilPlaying(s);
    expect(s.restart).toMatchObject({ type: 'kickoff', team: 1 });
    expect(eventTypes(s)).toEqual(expect.arrayContaining(['half-time', 'second-half', 'kickoff']));
  });

  it('scores on the correct goal after the swap', () => {
    let s = playing(midX, midY);
    s.half = 2;
    s.attackDir = [-1, 1]; // home now attacks left
    s = scoreLeft(s);
    expect(s.score).toEqual([1, 0]);
  });

  it('ends the match at full time with the final score and stays there', () => {
    let s = playing(midX, midY);
    s.half = 2;
    s.clock = HALF_LENGTH_SECONDS - 0.01;
    s.score = [3, 3];
    s = run(s, 0.1);
    expect(s.phase).toBe('full-time');
    expect(eventTypes(s)).toContain('full-time');
    s = run(s, 10);
    expect(s.phase).toBe('full-time');
    expect(s.score).toEqual([3, 3]);
    expect(matchClock(s)).toBe(2 * HALF_LENGTH_SECONDS);
  });

  it('lets a goal scored on the whistle count, then ends the half instead of kicking off', () => {
    let s = playing(PITCH_LEFT + 30, midY, 1);
    s.clock = HALF_LENGTH_SECONDS - 0.005;
    s = scoreLeft(s);
    expect(s.phase).toBe('goal-scored');
    expect(s.score).toEqual([0, 1]);
    s = run(s, GOAL_PAUSE + 0.1);
    expect(s.phase).toBe('half-time');
  });

  it('plays a whole AI-vs-AI match from kickoff to full time with consistent events', () => {
    let s = createMatchState({ aiVsAi: true });
    // Consumers keep the last id they saw, so nothing is missed even though the list is capped.
    const seen: MatchEvent[] = [];
    let lastId = 0;
    for (let i = 0; i < 60 * 60 * 8 && s.phase !== 'full-time'; i++) {
      s = step(s, [], SIM_DT);
      for (const e of s.events) if (e.id > lastId) seen.push(e);
      lastId = s.nextEventId - 1;
    }
    expect(s.phase).toBe('full-time');
    expect(s.half).toBe(2);
    const goals = seen.filter((e) => e.type === 'goal');
    expect(goals.filter((e) => e.team === 0).length).toBe(s.score[0]);
    expect(goals.filter((e) => e.team === 1).length).toBe(s.score[1]);
    const types = seen.map((e) => e.type);
    expect(types.filter((t) => t === 'half-time')).toHaveLength(1);
    expect(types.filter((t) => t === 'full-time')).toHaveLength(1);
    const ids = seen.map((e) => e.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(new Set(ids).size).toBe(ids.length);
  }, 30_000);
});

describe('events', () => {
  it('gives events increasing ids and keeps only the most recent ones', () => {
    const s = createInitialState();
    for (let i = 0; i < MAX_EVENTS + 10; i++) pushEvent(s, 'kickoff', { team: 0 });
    expect(s.events).toHaveLength(MAX_EVENTS);
    expect(s.events[0].id).toBe(11);
    expect(s.events[s.events.length - 1].id).toBe(MAX_EVENTS + 10);
  });

  it('is deterministic and cloneable', () => {
    const a = run(createMatchState({ aiVsAi: true }), 20);
    const b = run(createMatchState({ aiVsAi: true }), 20);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.parse(JSON.stringify(a)).events).toEqual(a.events);
  });
});

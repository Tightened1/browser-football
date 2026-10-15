// T14: throw-ins are thrown, the touchline holds the dribbled ball, auto-throw and the restart grace period.
import { describe, expect, it } from 'vitest';
import {
  BALL_RADIUS,
  GOAL_WIDTH,
  PITCH_BOTTOM,
  PITCH_HEIGHT,
  PITCH_LEFT,
  PITCH_RIGHT,
  PITCH_TOP,
  PLAYER_RADIUS,
  RESTART_AUTO_DELAY,
  RESTART_AUTO_DELAY_HUMAN,
  RESTART_GRACE_TIME,
  SIM_DT,
  THROW_AIM_EDGE,
  THROW_LONG_MIN_SPEED,
  THROW_SHORT_SPEED,
} from '../src/config';
import { createAiState } from '../src/sim/ai';
import { clampAim, inwardDirection } from '../src/sim/setpiece';
import { createInitialState, createPlayer, createSoloState, NEUTRAL_INPUT, step } from '../src/sim/simulation';
import type { GameState, InputFrame } from '../src/sim/types';

const midY = PITCH_TOP + PITCH_HEIGHT / 2;
const CONTACT = PLAYER_RADIUS + BALL_RADIUS;
const input = (o: Partial<InputFrame> = {}): InputFrame => ({ ...NEUTRAL_INPUT, ...o });
const angleBetween = (a: number, b: number): number => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

/** Steps team 0's human with `f`. */
function run(s: GameState, ticks: number, f: (n: number) => InputFrame, each?: (s: GameState) => void): GameState {
  for (let i = 0; i < ticks; i++) {
    s = step(s, [f(i)], SIM_DT);
    each?.(s);
  }
  return s;
}

/** Steps team 1's human (the taker in throwInForAway) with `f`. */
function runAway(s: GameState, ticks: number, f: (n: number) => InputFrame, each?: (s: GameState) => void): GameState {
  for (let i = 0; i < ticks; i++) {
    s = step(s, [undefined, f(i)], SIM_DT);
    each?.(s);
  }
  return s;
}

/** A lone human player at (x, y) with the ball just off their body in direction (dx, dy), already carrying it. */
function carrying(x: number, y: number, dx = 1, dy = 0): GameState {
  let s = createSoloState(x, y);
  s.ball.pos = { x: x + dx * (CONTACT + 2), y: y + dy * (CONTACT + 2) };
  s = step(s, [input()], SIM_DT);
  expect(s.possession?.player).toBe(0);
  return s;
}

const carryingNearTop = (): GameState => carrying(400, PITCH_TOP + 60);

/** A throw-in on the top touchline at x = 500 for team 1 (team 0 touched it last); team 1 has an idle human. */
function throwInForAway(): GameState {
  const s = createInitialState({ humans: [false, true] });
  s.ball.pos = { x: 500, y: PITCH_TOP - BALL_RADIUS - 2 };
  s.lastTouch = { team: 0, player: 1 };
  const next = step(s, [undefined, input()], SIM_DT);
  expect(next.restart).toMatchObject({ type: 'throw-in', team: 1 });
  return next;
}

describe('walking the ball off the pitch (T14 bug)', () => {
  it('a dribbler holding a direction into the touchline cannot take the ball out', () => {
    let s = carryingNearTop();
    s = run(s, 180, () => input({ moveY: -1 }), (t) => {
      expect(t.restart).toBeNull();
      expect(t.ball.pos.y).toBeGreaterThanOrEqual(PITCH_TOP + BALL_RADIUS - 0.5);
    });
    expect(s.possession?.player).toBe(0);
  });

  it('a throw-in taker cannot pick the ball up and dribble it', () => {
    let s = throwInForAway();
    const spot = { ...s.restart!.pos };
    const taker = s.restart!.taker;
    s = runAway(s, 30, () => input({ moveY: 1 }));
    expect(s.possession).toBeNull();
    expect(s.ball.pos.x).toBeCloseTo(spot.x, 3);
    expect(s.ball.pos.y).toBeCloseTo(spot.y, 3);
    expect(s.restart?.taker).toBe(taker);
  });
});

describe('the touchline holds the dribbled ball', () => {
  it('slides the dribbler along the line, slower, when they hold a diagonal into it', () => {
    let s = carryingNearTop();
    const x0 = s.players[0].pos.x;
    s = run(s, 120, () => input({ moveX: 1, moveY: -1 }), (t) => expect(t.restart).toBeNull());
    expect(s.possession?.player).toBe(0);
    expect(s.players[0].pos.x - x0).toBeGreaterThan(80); // still moving along the line
    expect(Math.abs(s.players[0].vel.y)).toBeLessThan(1); // not into it
    expect(Math.hypot(s.players[0].vel.x, s.players[0].vel.y)).toBeLessThan(160); // slowed down
  });

  it('holds the ball at the goal lines (outside the goal mouth) and the bottom touchline too', () => {
    for (const [x, y, mx, my] of [
      [PITCH_RIGHT - 60, PITCH_TOP + 80, 1, 0],
      [PITCH_LEFT + 60, PITCH_BOTTOM - 80, -1, 0],
      [600, PITCH_BOTTOM - 60, 0, 1],
    ] as const) {
      let s = carrying(x, y, mx, my);
      s = run(s, 150, () => input({ moveX: mx, moveY: my }), (t) => expect(t.restart).toBeNull());
      expect(s.possession?.player).toBe(0);
      expect(s.ball.pos.x).toBeGreaterThan(PITCH_LEFT);
      expect(s.ball.pos.x).toBeLessThan(PITCH_RIGHT);
      expect(s.ball.pos.y).toBeLessThan(PITCH_BOTTOM);
    }
  });

  it('still lets a dribbler walk the ball into the goal', () => {
    let s = carrying(PITCH_RIGHT - 60, midY);
    s = run(s, 120, () => input({ moveX: 1 }));
    expect(s.score[0]).toBe(1);
  });

  it('lets a kicked ball go out normally: a throw-in to the other team', () => {
    let s = carryingNearTop();
    s = run(s, 1, () => input({ moveY: -1, pass: true }));
    s = run(s, 60, () => input());
    // (Alone on the pitch, team 1 has nobody to take it: the event says whose it is.)
    expect(s.events.at(-1)).toMatchObject({ type: 'throw-in', team: 1 });
  });
});

describe('throw-ins are thrown', () => {
  it('keeps the taker still while aiming, and turns them towards the aim (clamped into the pitch)', () => {
    let s = throwInForAway();
    const taker = s.restart!.taker;
    const at = { ...s.players[taker].pos };
    s = runAway(s, 20, () => input({ moveX: 1 }));
    expect(s.players[taker].pos.x).toBeCloseTo(at.x, 1);
    expect(s.players[taker].pos.y).toBeCloseTo(at.y, 1);
    // Aiming along the line (or back out) is turned to THROW_AIM_EDGE inside it.
    expect(s.players[taker].facing).toBeCloseTo(THROW_AIM_EDGE, 5);
  });

  it('a throw-in aimed straight outwards still goes into the pitch', () => {
    let s = throwInForAway();
    s = runAway(s, 1, () => input({ moveY: -1, pass: true }));
    expect(s.restart).toBeNull();
    expect(s.ball.vel.y).toBeGreaterThan(THROW_SHORT_SPEED * 0.9); // straight in, at the short throw's speed
    // Until anyone else touches it, it travels on into the pitch.
    const taker = s.lastTouch!.player;
    let ticks = 0;
    for (; ticks < 60 && s.lastTouch?.player === taker; ticks++) {
      const y = s.ball.pos.y;
      s = runAway(s, 1, () => input());
      expect(s.restart).toBeNull();
      if (s.lastTouch?.player === taker) expect(s.ball.pos.y).toBeGreaterThan(y);
    }
    expect(ticks).toBeGreaterThan(5);
  });

  it('a charged shoot release is a long throw, faster than a short one', () => {
    let s = throwInForAway();
    s = runAway(s, 30, () => input({ moveX: 0.3, moveY: 1, shoot: true }));
    expect(s.restart).not.toBeNull();
    s = runAway(s, 1, () => input({ moveX: 0.3, moveY: 1 }));
    expect(s.restart).toBeNull();
    expect(Math.hypot(s.ball.vel.x, s.ball.vel.y)).toBeGreaterThan(THROW_LONG_MIN_SPEED);
  });

  it('clamps aims into the half-circle facing the pitch, for throw-ins, corners and goal kicks', () => {
    const inward = inwardDirection('throw-in', { x: 500, y: PITCH_TOP + 30 })!;
    expect(inward).toEqual({ x: 0, y: 1 });
    expect(clampAim(-Math.PI / 2, inward)).toBeGreaterThan(0); // straight out -> into the pitch
    expect(clampAim(Math.PI / 2, inward)).toBeCloseTo(Math.PI / 2, 9); // already inward: unchanged
    const corner = inwardDirection('corner', { x: PITCH_RIGHT - 30, y: PITCH_BOTTOM - 30 })!;
    expect(Math.cos(clampAim(0, corner))).toBeLessThan(0.2); // along +x, out over the goal line -> turned in
    expect(inwardDirection('goal-kick', { x: PITCH_LEFT + 70, y: midY })).toEqual({ x: 1, y: 0 });
    expect(inwardDirection('kickoff', { x: 600, y: midY })).toBeNull();
  });

  it('a corner kicked straight out is turned into the pitch', () => {
    const s0 = createInitialState({ humans: [true, false] });
    s0.ball.pos = { x: PITCH_RIGHT + BALL_RADIUS + 2, y: PITCH_BOTTOM - 80 };
    s0.lastTouch = { team: 1, player: 6 }; // team 1 defends the right goal: corner to team 0
    let s = step(s0, [input()], SIM_DT);
    expect(s.restart).toMatchObject({ type: 'corner', team: 0 });
    s = run(s, 1, () => input({ moveX: 1, moveY: 1, pass: true }));
    expect(s.restart).toBeNull();
    expect(s.ball.vel.y).toBeLessThan(0); // not out over the touchline
    expect(s.ball.vel.x).toBeLessThan(s.ball.vel.y * -0.2); // nor over the goal line
  });
});

describe('auto-throw', () => {
  it('throws it for an idle human after RESTART_AUTO_DELAY_HUMAN, to a teammate', () => {
    let s = throwInForAway();
    const ticks = Math.round(RESTART_AUTO_DELAY_HUMAN / SIM_DT);
    s = runAway(s, ticks - 10, () => input());
    expect(s.restart?.type).toBe('throw-in');
    s = runAway(s, 12, () => input());
    expect(s.restart).toBeNull();
    const v = s.ball.vel;
    expect(v.y).toBeGreaterThan(0); // into the pitch
    const dir = Math.atan2(v.y, v.x);
    const taker = s.lastTouch!.player;
    const mates = s.players.filter((p) => p.team === 1 && p.id !== taker);
    const best = Math.min(...mates.map((p) => angleBetween(Math.atan2(p.pos.y - s.ball.pos.y, p.pos.x - s.ball.pos.x), dir)));
    expect(best).toBeLessThan(0.5); // towards one of the taker's teammates
  });

  it('prefers an unmarked teammate over a marked one that is closer', () => {
    // (The marker is a human standing still, so it stays on the near teammate whatever the AI would do.)
    const s0 = createInitialState({ humans: [true, true] });
    s0.players = [
      createPlayer(0, 0, 520, PITCH_TOP + 140), // marks the near teammate
      createPlayer(1, 1, 300, PITCH_TOP + 100), // taker (nearest the spot)
      createPlayer(2, 1, 500, PITCH_TOP + 130), // near, marked
      createPlayer(3, 1, 420, PITCH_TOP + 300), // further, open
    ];
    s0.controlled = [0, 1];
    s0.ai = createAiState(s0.players, s0.controlled);
    s0.ball.pos = { x: 330, y: PITCH_TOP - BALL_RADIUS - 2 };
    s0.lastTouch = { team: 0, player: 0 };
    let s = step(s0, [input(), input()], SIM_DT);
    expect(s.restart?.taker).toBe(1);
    for (let i = 0; i < Math.round(RESTART_AUTO_DELAY_HUMAN / SIM_DT) + 2; i++) s = step(s, [input(), input()], SIM_DT);
    expect(s.restart).toBeNull();
    const dir = Math.atan2(s.ball.vel.y, s.ball.vel.x);
    const to3 = Math.atan2(s.players[3].pos.y - s.ball.pos.y, s.players[3].pos.x - s.ball.pos.x);
    expect(angleBetween(dir, to3)).toBeLessThan(0.15);
  });

  it('the AI takes its throw-ins quickly, into the pitch, and never straight back out to the opponents', () => {
    let thrown = 0;
    for (const [x, top] of [[200, true], [500, true], [900, false], [PITCH_RIGHT - 70, false], [PITCH_LEFT + 70, true]] as const) {
      for (const team of [0, 1] as const) {
        const s0 = createInitialState({ aiVsAi: true, seed: x + team });
        s0.ball.pos = { x, y: top ? PITCH_TOP - BALL_RADIUS - 2 : PITCH_BOTTOM + BALL_RADIUS + 2 };
        s0.lastTouch = { team: (1 - team) as 0 | 1, player: (1 - team) * 5 + 1 };
        let s = step(s0, [], SIM_DT);
        expect(s.restart).toMatchObject({ type: 'throw-in', team });
        let ticks = 0;
        while (s.restart && ticks < 200) {
          s = step(s, [], SIM_DT);
          ticks++;
        }
        expect(s.restart).toBeNull();
        expect(ticks * SIM_DT).toBeLessThanOrEqual(RESTART_AUTO_DELAY + 0.05);
        expect(s.ball.vel.y * (top ? 1 : -1)).toBeGreaterThan(0); // into the pitch
        // In the next second it only goes out for the opponents if one of them has touched it (an interception).
        let opponentTouched = false;
        for (let i = 0; i < 60 && !s.restart; i++) {
          s = step(s, [], SIM_DT);
          if (!s.restart && s.lastTouch?.team !== team) opponentTouched = true;
        }
        if (s.restart && s.restart.type !== 'kickoff' && !opponentTouched) expect(s.restart.team).toBe(team);
        thrown++;
      }
    }
    expect(thrown).toBe(10);
  });
});

describe('restart grace period', () => {
  /** Team 1 has just thrown in from the top touchline (the ball is on its way). */
  function justThrown(): GameState {
    let s = throwInForAway();
    s = runAway(s, 1, () => input({ moveY: 1, pass: true }));
    expect(s.restart).toBeNull();
    expect(s.grace).toMatchObject({ type: 'throw-in', team: 1 });
    return s;
  }

  it('the same team retakes it if it goes straight back out, untouched', () => {
    let s = justThrown();
    s.ball.pos = { x: 700, y: PITCH_TOP - BALL_RADIUS - 3 };
    s.ball.vel = { x: 0, y: -100 };
    s = runAway(s, 1, () => input());
    expect(s.restart).toMatchObject({ type: 'throw-in', team: 1 });
    expect(s.restart!.pos.x).toBeCloseTo(500, 3); // retaken from the same spot
  });

  it('goes to the other team after the grace period, or once another player has touched it', () => {
    let s = justThrown();
    const taker = s.lastTouch!.player;
    expect(s.grace!.timer).toBeCloseTo(RESTART_GRACE_TIME, 1);
    s.grace!.timer = SIM_DT / 2; // the grace period is about to run out
    s = runAway(s, 1, () => input());
    expect(s.grace).toBeNull();
    s.ball.pos = { x: 700, y: PITCH_TOP - BALL_RADIUS - 3 };
    s.ball.vel = { x: 0, y: -100 };
    s.lastTouch = { team: 1, player: taker };
    s = runAway(s, 1, () => input());
    expect(s.restart).toMatchObject({ type: 'throw-in', team: 0 });

    s = justThrown();
    s.lastTouch = { team: 1, player: s.players.find((p) => p.team === 1 && p.id !== taker && p.role !== 'keeper')!.id }; // a teammate's touch
    s.ball.pos = { x: 700, y: PITCH_TOP - BALL_RADIUS - 3 };
    s.ball.vel = { x: 0, y: -100 };
    s = runAway(s, 1, () => input());
    expect(s.restart).toMatchObject({ type: 'throw-in', team: 0 });
  });

  it('a goal still counts during the grace period', () => {
    let s = justThrown();
    s.ball.pos = { x: PITCH_LEFT - BALL_RADIUS - 5, y: midY + GOAL_WIDTH / 4 };
    s = runAway(s, 1, () => input());
    expect(s.phase).toBe('goal-scored');
  });
});

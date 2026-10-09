import { describe, expect, it } from 'vitest';
import {
  BALL_RADIUS,
  GOAL_DEPTH,
  GOAL_WIDTH,
  PITCH_BOTTOM,
  PITCH_LEFT,
  PITCH_RIGHT,
  PITCH_TOP,
  SIM_DT,
  WALL_RESTITUTION,
} from '../src/config';
import { collideCircles } from '../src/sim/physics';
import { createInitialState, step } from '../src/sim/simulation';
import type { GameState, InputFrame } from '../src/sim/types';

const midY = (PITCH_TOP + PITCH_BOTTOM) / 2;

function stateWith(x: number, y: number, vx: number, vy: number): GameState {
  const s = createInitialState();
  s.players = []; // ball-only physics tests
  s.ball.pos = { x, y };
  s.ball.vel = { x: vx, y: vy };
  return s;
}

function run(s: GameState, ticks: number, inputs: InputFrame[] = []): GameState {
  for (let i = 0; i < ticks; i++) s = step(s, inputs, SIM_DT);
  return s;
}

const speed = (s: GameState) => Math.hypot(s.ball.vel.x, s.ball.vel.y);

describe('ball physics', () => {
  it('slows to a stop under friction', () => {
    let s = stateWith(300, midY - 200, 300, 0); // short roll, no walls in the way
    let prev = speed(s);
    let stoppedAt = -1;
    for (let i = 0; i < 60 * 10; i++) {
      s = step(s, [], SIM_DT);
      const v = speed(s);
      expect(v).toBeLessThanOrEqual(prev + 1e-9);
      prev = v;
      if (v === 0) {
        stoppedAt = i;
        break;
      }
    }
    expect(stoppedAt).toBeGreaterThan(30); // not instant
    expect(stoppedAt).toBeGreaterThan(0);
    expect(s.ball.pos.x).toBeGreaterThan(300);
  });

  it('bounces off the top wall with energy loss', () => {
    let s = stateWith(500, PITCH_TOP + 60, 0, -600);
    s = run(s, 20);
    expect(s.ball.vel.y).toBeGreaterThan(0);
    expect(s.ball.vel.y).toBeLessThan(600 * WALL_RESTITUTION);
    expect(s.ball.pos.y).toBeGreaterThanOrEqual(PITCH_TOP + BALL_RADIUS - 1e-6);
  });

  it('never escapes the pitch even when hit very hard', () => {
    let s = stateWith(500, 300, 5000, 3000);
    for (let i = 0; i < 600; i++) {
      s = step(s, [], SIM_DT);
      expect(s.ball.pos.y).toBeGreaterThan(PITCH_TOP);
      expect(s.ball.pos.y).toBeLessThan(PITCH_BOTTOM);
      expect(s.ball.pos.x).toBeGreaterThan(PITCH_LEFT - GOAL_DEPTH);
      expect(s.ball.pos.x).toBeLessThan(PITCH_RIGHT + GOAL_DEPTH);
    }
  });

  it('bounces off a solid end line away from the goal mouth', () => {
    const s = run(stateWith(PITCH_LEFT + 60, PITCH_TOP + 60, -500, 0), 30);
    expect(s.ball.vel.x).toBeGreaterThan(0);
    expect(s.ball.pos.x).toBeGreaterThanOrEqual(PITCH_LEFT + BALL_RADIUS - 1e-6);
  });

  it('enters the goal and bounces off the back net', () => {
    let s = stateWith(PITCH_LEFT + 100, midY, -700, 0);
    let deepest = Infinity;
    for (let i = 0; i < 60; i++) {
      s = step(s, [], SIM_DT);
      deepest = Math.min(deepest, s.ball.pos.x);
    }
    expect(deepest).toBeLessThan(PITCH_LEFT - BALL_RADIUS); // fully across the line
    expect(deepest).toBeGreaterThanOrEqual(PITCH_LEFT - GOAL_DEPTH + BALL_RADIUS - 1e-6);
  });

  it('can enter the right goal too', () => {
    let s = stateWith(PITCH_RIGHT - 100, midY + 30, 900, 0);
    let deepest = -Infinity;
    for (let i = 0; i < 30; i++) {
      s = step(s, [], SIM_DT);
      deepest = Math.max(deepest, s.ball.pos.x);
    }
    expect(deepest).toBeGreaterThan(PITCH_RIGHT + BALL_RADIUS);
  });

  it('stays inside the goal area, bouncing off the net sides', () => {
    let s = stateWith(PITCH_LEFT + 80, midY, -800, 150);
    for (let i = 0; i < 120; i++) {
      s = step(s, [], SIM_DT);
      if (s.ball.pos.x < PITCH_LEFT - BALL_RADIUS) {
        expect(Math.abs(s.ball.pos.y - midY)).toBeLessThanOrEqual(GOAL_WIDTH / 2 - BALL_RADIUS + 1e-6);
      }
    }
  });

  it('bounces off a post instead of entering through it', () => {
    const postY = midY - GOAL_WIDTH / 2;
    const s = run(stateWith(PITCH_LEFT + 80, postY, -500, 0), 25);
    expect(s.ball.vel.x).toBeGreaterThan(0); // came back out
    expect(s.ball.pos.x).toBeGreaterThan(PITCH_LEFT);
  });

  it('is deterministic for the same inputs and JSON-serialisable', () => {
    const inputs = (n: number): InputFrame[] =>
      n % 40 === 0
        ? [
            {
              seq: n,
              moveX: Math.cos(n),
              moveY: Math.sin(n),
              pass: false,
              shoot: n % 80 === 0,
              tackle: false,
              switchPlayer: false,
            },
          ]
        : [];
    const simulate = () => {
      let s = createInitialState();
      for (let i = 0; i < 600; i++) s = step(s, inputs(i), SIM_DT);
      return s;
    };
    const a = simulate();
    const b = simulate();
    expect(a).toEqual(b);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
    expect(a.tick).toBe(600);
  });

  it('step does not mutate its input state', () => {
    const s = stateWith(500, 300, 200, 100);
    const copy = JSON.parse(JSON.stringify(s));
    step(s, [], SIM_DT);
    expect(s).toEqual(copy);
  });
});

describe('collideCircles', () => {
  it('separates overlapping circles and exchanges momentum', () => {
    const a = { pos: { x: 0, y: 0 }, vel: { x: 100, y: 0 }, radius: 10 };
    const b = { pos: { x: 15, y: 0 }, vel: { x: 0, y: 0 }, radius: 10 };
    expect(collideCircles(a, b, 1)).toBe(true);
    expect(b.pos.x - a.pos.x).toBeCloseTo(20);
    expect(b.vel.x).toBeGreaterThan(0);
    expect(a.vel.x).toBeLessThan(100);
  });

  it('does not move an immovable circle', () => {
    const a = { pos: { x: 0, y: 0 }, vel: { x: 100, y: 0 }, radius: 10 };
    const post = { pos: { x: 14, y: 0 }, vel: { x: 0, y: 0 }, radius: 5 };
    collideCircles(a, post, 1, 1, 0);
    expect(post.pos.x).toBe(14);
    expect(a.vel.x).toBeLessThan(0);
  });

  it('returns false when apart', () => {
    const a = { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, radius: 5 };
    const b = { pos: { x: 20, y: 0 }, vel: { x: 0, y: 0 }, radius: 5 };
    expect(collideCircles(a, b, 1)).toBe(false);
  });
});

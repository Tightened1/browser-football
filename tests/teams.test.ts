import { describe, expect, it } from 'vitest';
import {
  GOAL_WIDTH,
  KEEPER_RANGE,
  PITCH_BOTTOM,
  PITCH_LEFT,
  PITCH_RIGHT,
  PITCH_TOP,
  PLAYERS_PER_TEAM,
  SIM_DT,
  SWITCH_GOALSIDE_BIAS,
} from '../src/config';
import { formationPosition } from '../src/sim/ai';
import { chooseSwitchTarget, updateTouches } from '../src/sim/control';
import { createInitialState, NEUTRAL_INPUT, step } from '../src/sim/simulation';
import type { GameState, InputFrame } from '../src/sim/types';

const midY = (PITCH_TOP + PITCH_BOTTOM) / 2;
const midX = (PITCH_LEFT + PITCH_RIGHT) / 2;
const input = (o: Partial<InputFrame> = {}): InputFrame => ({ ...NEUTRAL_INPUT, ...o });

function run(s: GameState, ticks: number, f: (n: number) => InputFrame[] = () => []): GameState {
  for (let i = 0; i < ticks; i++) s = step(s, f(i), SIM_DT);
  return s;
}

/** Places the ball and some players by id (home: 0 keeper, 1..4 outfield; away: 5 keeper, 6..9). */
function place(ball: [number, number], at: Record<number, [number, number]>): GameState {
  const s = createInitialState();
  s.ball.pos = { x: ball[0], y: ball[1] };
  for (const [id, [x, y]] of Object.entries(at)) s.players[+id].pos = { x, y };
  return s;
}

describe('teams', () => {
  it('has two teams of 5 with one keeper each, in their own halves', () => {
    const s = createInitialState();
    expect(s.players).toHaveLength(PLAYERS_PER_TEAM * 2);
    for (const team of [0, 1]) {
      const t = s.players.filter((p) => p.team === team);
      expect(t).toHaveLength(PLAYERS_PER_TEAM);
      expect(t.filter((p) => p.role === 'keeper')).toHaveLength(1);
      for (const p of t) expect(team === 0 ? p.pos.x < midX : p.pos.x > midX).toBe(true);
    }
    expect(s.controlled).toEqual([4, -1]);
  });

  it('formations mirror between teams', () => {
    const a = formationPosition(2, 1);
    const b = formationPosition(2, -1);
    expect(a.x - PITCH_LEFT).toBeCloseTo(PITCH_RIGHT - b.x);
    expect(a.y).toBeCloseTo(b.y);
  });

  it('is deterministic and JSON-serialisable', () => {
    const go = () =>
      run(createInitialState(), 300, (n) => [input({ moveX: Math.cos(n / 10), moveY: 1, switchPlayer: n % 50 === 0 })]);
    const a = go();
    expect(a).toEqual(go());
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });
});

describe('switching choice', () => {
  it('picks the closest teammate to the ball, excluding the current player and the keeper', () => {
    const s = place([500, 300], { 0: [500, 300], 1: [200, 300], 2: [900, 300], 3: [700, 300], 4: [510, 450] });
    s.controlled = [3, -1];
    expect(chooseSwitchTarget(s, 0)).toBe(4);
  });

  it('prefers a goal-side player over a slightly closer one in front of the ball', () => {
    const s = place([500, 300], { 1: [350, 300], 2: [600, 300], 3: [900, 600], 4: [900, 100] });
    s.controlled = [3, -1];
    expect(chooseSwitchTarget(s, 0)).toBe(1); // 150 away but goal-side beats 100 away upfield
    s.players[1].pos.x = 500 - (100 + SWITCH_GOALSIDE_BIAS + 20); // too far for the bias to help
    expect(chooseSwitchTarget(s, 0)).toBe(2);
  });

  it('works mirrored for the team attacking left', () => {
    const s = place([500, 300], { 6: [650, 300], 7: [400, 300], 8: [900, 600], 9: [900, 100] });
    s.controlled = [3, 8];
    expect(chooseSwitchTarget(s, 1)).toBe(6); // goal-side (their goal is on the right)
  });

  it('a switch press changes player once per press, not while held', () => {
    let s = place([500, 300], { 1: [450, 300], 2: [900, 300], 3: [900, 400], 4: [900, 500] });
    s.controlled = [3, -1];
    s = step(s, [input({ switchPlayer: true })], SIM_DT);
    expect(s.controlled[0]).toBe(1);
    s = run(s, 10, () => [input({ switchPlayer: true })]);
    expect(s.controlled[0]).toBe(1);
    s = step(s, [input()], SIM_DT);
    s = step(s, [input({ switchPlayer: true })], SIM_DT);
    expect(s.controlled[0]).not.toBe(1);
  });

  it('does not switch when the controlled player has the ball', () => {
    let s = place([500, 300], { 1: [450, 300], 3: [490, 300] });
    s.controlled = [3, -1];
    s = step(s, [input({ switchPlayer: true })], SIM_DT);
    expect(s.controlled[0]).toBe(3);
  });

  it('auto-switches to a teammate who receives a pass', () => {
    let s = place([500 + 14 + 9 + 2, 300], { 3: [500, 300], 4: [620, 300], 1: [200, 500], 2: [200, 100] });
    for (const id of [6, 7, 8, 9]) s.players[id].pos = { x: 900, y: 100 + id * 4 }; // opponents out of the way
    s.controlled = [3, -1];
    s.players[3].facing = 0;
    s = step(s, [input()], SIM_DT);
    s = step(s, [input({ pass: true })], SIM_DT);
    expect(s.controlled[0]).toBe(3);
    s = run(s, 90, () => [input()]);
    expect(s.controlled[0]).toBe(4);
  });

  it('does not auto-switch when an opponent touched the ball last (and it is too fast to control)', () => {
    // An opponent's hard shot bounces off a teammate: nobody has the ball, so control stays put.
    let s = place([700, 300], { 3: [200, 300], 4: [735, 300] });
    s.ball.vel = { x: 900, y: 0 };
    s.controlled = [3, -1];
    s.lastTouch = { team: 1, player: 6 };
    s = run(s, 3, () => [input()]);
    expect(s.possession).toBeNull();
    expect(s.controlled[0]).toBe(3);
  });

  it('control follows a teammate who takes the ball (sticky dribbling)', () => {
    let s = place([700, 300], { 3: [200, 300], 4: [700 - 14 - 9 - 2, 300] });
    for (const id of [5, 6, 7, 8, 9]) s.players[id].pos = { x: 1000, y: 100 + id * 40 };
    s.controlled = [3, -1];
    s.lastTouch = { team: 1, player: 6 };
    s = step(s, [input()], SIM_DT);
    expect(s.possession?.player).toBe(4);
    expect(s.controlled[0]).toBe(4);
  });
});

describe('player collisions', () => {
  it('separates overlapping players so none overlap', () => {
    const r = run(place([900, 100], { 1: [400, 300], 2: [405, 300], 3: [402, 305], 4: [398, 298] }), 30);
    for (let i = 0; i < r.players.length; i++) {
      for (let j = i + 1; j < r.players.length; j++) {
        const a = r.players[i];
        const b = r.players[j];
        const d = Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y);
        expect(d).toBeGreaterThanOrEqual(a.radius + b.radius - 1);
      }
    }
  });

  it('a running player pushes a standing one aside without overlapping', () => {
    // The standing player is held still by a second "human" giving no input.
    let s = place([900, 100], { 6: [440, 300], 3: [400, 300] });
    s.controlled = [3, 6];
    const startX = s.players[6].pos.x;
    s = run(s, 25, () => [input({ moveX: 1 }), input()]);
    const runner = s.players[3];
    const other = s.players[6];
    expect(other.pos.x).toBeGreaterThan(startX);
    expect(Math.hypot(runner.pos.x - other.pos.x, runner.pos.y - other.pos.y)).toBeGreaterThanOrEqual(
      runner.radius + other.radius - 1,
    );
  });

  it('players cannot be pushed out of the pitch', () => {
    let s = place([900, 100], { 3: [PITCH_LEFT + 60, PITCH_TOP + 40], 1: [PITCH_LEFT + 60, PITCH_TOP + 70] });
    s.controlled = [3, -1];
    s = run(s, 60, () => [input({ moveY: -1 })]);
    for (const p of s.players) expect(p.pos.y).toBeGreaterThanOrEqual(PITCH_TOP + p.radius - 1e-6);
  });
});

describe('last touch', () => {
  it('a ball merely within reach of a player is not touched by them, flying past or at rest (T16); a colliding one is', () => {
    const s = place([626, midY], { 6: [600, midY], 1: [200, PITCH_TOP + 20], 2: [200, PITCH_BOTTOM - 20] });
    s.lastTouch = { team: 0, player: 1 };
    // 26 px from player 6's centre: inside reach (14 + 9 + 8 = 31) but not touching (23), moving fast across it.
    s.ball.vel = { x: 0, y: 500 };
    updateTouches(s);
    expect(s.lastTouch).toEqual({ team: 0, player: 1 });
    // The same spot with the ball at rest next to the player: still not theirs (being near it is not a touch).
    s.ball.vel = { x: 0, y: 0 };
    updateTouches(s);
    expect(s.lastTouch).toEqual({ team: 0, player: 1 });
    // A fast ball that really hits a player (step runs the collision) is theirs.
    const hit = place([600, midY - 40], { 6: [600, midY], 1: [200, PITCH_TOP + 20], 2: [200, PITCH_BOTTOM - 20] });
    hit.ball.vel = { x: 0, y: 400 };
    hit.lastTouch = { team: 0, player: 1 };
    expect(step(run(hit, 6), [], SIM_DT).lastTouch).toEqual({ team: 1, player: 6 });
  });
});

describe('goalkeepers', () => {
  it('block a shot at goal: the ball never reaches the goal line and is cleared', () => {
    for (const speed of [500, 1000, 1400]) {
      let s = createInitialState();
      s.ball.pos = { x: PITCH_LEFT + 300, y: midY };
      s.ball.vel = { x: -speed, y: 0 };
      let minX = Infinity;
      let touchedAt = -1;
      let cleared = false;
      for (let i = 0; i < 120; i++) {
        s = step(s, [], SIM_DT);
        minX = Math.min(minX, s.ball.pos.x);
        if (touchedAt < 0 && s.lastTouch?.player === 0) touchedAt = i;
        if (touchedAt >= 0 && i - touchedAt <= 10 && s.ball.vel.x > 0) cleared = true; // bounced away off the keeper
      }
      expect(minX).toBeGreaterThan(PITCH_LEFT);
      expect(cleared).toBe(true);
    }
  });

  it('can be beaten by a shot into the corner away from where they stand', () => {
    let s = createInitialState();
    s.ball.pos = { x: PITCH_LEFT + 150, y: midY + GOAL_WIDTH / 2 - 20 };
    s.ball.vel = { x: -1000, y: 0 };
    s.players[0].pos = { x: formationPosition(0, 1).x, y: midY - KEEPER_RANGE };
    let minX = Infinity;
    for (let i = 0; i < 20; i++) {
      s = step(s, [], SIM_DT);
      minX = Math.min(minX, s.ball.pos.x);
    }
    expect(minX).toBeLessThan(PITCH_LEFT - 5); // crossed the line into the net
  });
});

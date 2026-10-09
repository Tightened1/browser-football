import { describe, expect, it } from 'vitest';
import {
  PASS_SPEED,
  PITCH_LEFT,
  PITCH_TOP,
  PITCH_HEIGHT,
  PLAYER_MAX_SPEED,
  PLAYER_RADIUS,
  SHOT_MAX_CHARGE_TIME,
  SHOT_MAX_SPEED,
  SHOT_MIN_SPEED,
  SIM_DT,
  TACKLE_COOLDOWN,
} from '../src/config';
import { buildInputFrame } from '../src/input/keyboard';
import { createInitialState, NEUTRAL_INPUT, shotSpeed, step } from '../src/sim/simulation';
import type { GameState, InputFrame } from '../src/sim/types';

const midY = PITCH_TOP + PITCH_HEIGHT / 2;

const input = (o: Partial<InputFrame> = {}): InputFrame => ({ ...NEUTRAL_INPUT, ...o });
const speedOf = (v: { x: number; y: number }) => Math.hypot(v.x, v.y);

/** Player at (x, y), ball placed elsewhere, nothing moving. */
function setup(px: number, py: number, bx = 900, by = 150): GameState {
  const s = createInitialState();
  s.players[0].pos = { x: px, y: py };
  s.ball.pos = { x: bx, y: by };
  return s;
}

function run(s: GameState, ticks: number, f: (n: number) => InputFrame): GameState {
  for (let i = 0; i < ticks; i++) s = step(s, [f(i)], SIM_DT);
  return s;
}

describe('keyboard -> InputFrame', () => {
  it('maps arrows and WASD, normalising diagonals', () => {
    expect(buildInputFrame(new Set(['ArrowRight']), 0)).toMatchObject({ moveX: 1, moveY: 0 });
    expect(buildInputFrame(new Set(['KeyA']), 0)).toMatchObject({ moveX: -1, moveY: 0 });
    expect(buildInputFrame(new Set(['KeyW']), 0)).toMatchObject({ moveX: 0, moveY: -1 });
    const d = buildInputFrame(new Set(['ArrowDown', 'ArrowRight']), 0);
    expect(Math.hypot(d.moveX, d.moveY)).toBeCloseTo(1);
  });

  it('cancels opposite directions and maps buttons', () => {
    const f = buildInputFrame(new Set(['ArrowLeft', 'ArrowRight', 'KeyX', 'Space', 'KeyC', 'ShiftLeft']), 7);
    expect(f).toEqual({
      seq: 7, moveX: 0, moveY: 0, pass: true, shoot: true, tackle: true, switchPlayer: true,
    });
  });
});

describe('player movement', () => {
  it('accelerates gradually up to max speed, then decelerates gradually', () => {
    let s = setup(300, midY);
    s = step(s, [input({ moveX: 1 })], SIM_DT);
    const first = s.players[0].vel.x;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(PLAYER_MAX_SPEED); // not instant
    s = run(s, 60, () => input({ moveX: 1 }));
    expect(s.players[0].vel.x).toBeCloseTo(PLAYER_MAX_SPEED);
    s = step(s, [input()], SIM_DT);
    expect(s.players[0].vel.x).toBeGreaterThan(0);
    expect(s.players[0].vel.x).toBeLessThan(PLAYER_MAX_SPEED);
    s = run(s, 60, () => input());
    expect(s.players[0].vel.x).toBe(0);
  });

  it('never exceeds max speed on diagonals and faces the move direction', () => {
    const s = run(setup(300, midY), 90, () => input({ moveX: 1, moveY: 1 }));
    expect(speedOf(s.players[0].vel)).toBeLessThanOrEqual(PLAYER_MAX_SPEED + 1e-6);
    expect(s.players[0].facing).toBeCloseTo(Math.PI / 4);
  });

  it('keeps facing when released', () => {
    const s = run(setup(300, midY), 30, (n) => (n < 10 ? input({ moveY: -1 }) : input()));
    expect(s.players[0].facing).toBeCloseTo(-Math.PI / 2);
  });

  it('is stopped by the pitch wall', () => {
    const s = run(setup(PITCH_LEFT + 60, 200), 120, () => input({ moveX: -1 }));
    expect(s.players[0].pos.x).toBeGreaterThanOrEqual(PITCH_LEFT + PLAYER_RADIUS - 1e-6);
    expect(s.players[0].vel.x).toBeGreaterThanOrEqual(0);
  });

  it('pushes the ball instead of passing through it', () => {
    const s = run(setup(300, midY, 340, midY), 40, () => input({ moveX: 1 }));
    expect(s.ball.pos.x).toBeGreaterThan(s.players[0].pos.x + PLAYER_RADIUS);
  });
});

describe('dribbling', () => {
  it('keeps the ball close ahead of a running player, but not glued to it', () => {
    let s = setup(300, midY, 335, midY);
    let maxGap = 0;
    let minGap = Infinity;
    for (let i = 0; i < 150; i++) {
      s = step(s, [input({ moveX: 1 })], SIM_DT);
      if (i > 30) {
        const gap = s.ball.pos.x - s.players[0].pos.x;
        maxGap = Math.max(maxGap, gap);
        minGap = Math.min(minGap, gap);
      }
    }
    expect(minGap).toBeGreaterThan(0); // ball stays in front
    expect(maxGap).toBeLessThan(70); // close...
    expect(maxGap).toBeGreaterThan(PLAYER_RADIUS + 9 + 3); // ...but visibly loose
  });

  it('loses the ball when the player turns away', () => {
    let s = setup(300, midY, 335, midY);
    s = run(s, 60, () => input({ moveX: 1 }));
    s = run(s, 60, () => input({ moveX: -1 }));
    expect(s.ball.pos.x - s.players[0].pos.x).toBeGreaterThan(60);
  });
});

describe('kicking', () => {
  const touching = () => setup(500, midY, 500 + PLAYER_RADIUS + 9 + 2, midY);

  it('tap pass kicks the ball at medium power in the facing direction', () => {
    let s = touching();
    s = step(s, [input()], SIM_DT);
    s = step(s, [input({ pass: true })], SIM_DT);
    expect(s.ball.vel.x).toBeGreaterThan(PASS_SPEED * 0.9);
    expect(Math.abs(s.ball.vel.y)).toBeLessThan(1);
  });

  it('does not kick when the ball is out of reach', () => {
    let s = setup(500, midY, 700, midY);
    s = step(s, [input({ pass: true })], SIM_DT);
    expect(speedOf(s.ball.vel)).toBe(0);
  });

  it('a tap of shoot is about medium power; holding charges harder, capped', () => {
    const shoot = (holdTicks: number): number => {
      let s = touching();
      s = run(s, holdTicks, () => input({ shoot: true }));
      expect(s.players[0].charge).toBeGreaterThan(0);
      s = step(s, [input()], SIM_DT);
      expect(s.players[0].charge).toBe(0);
      return s.ball.vel.x;
    };
    const tap = shoot(1);
    const half = shoot(Math.round((SHOT_MAX_CHARGE_TIME / 2) / SIM_DT));
    const full = shoot(Math.round(SHOT_MAX_CHARGE_TIME / SIM_DT));
    const over = shoot(Math.round((SHOT_MAX_CHARGE_TIME * 3) / SIM_DT));
    expect(tap).toBeGreaterThanOrEqual(SHOT_MIN_SPEED * 0.95);
    expect(tap).toBeLessThan(SHOT_MIN_SPEED * 1.1);
    expect(half).toBeGreaterThan(tap);
    expect(full).toBeGreaterThan(half);
    expect(over).toBeCloseTo(full, 3); // capped
    expect(full).toBeLessThanOrEqual(SHOT_MAX_SPEED + 1);
  });

  it('shotSpeed is monotonic and capped', () => {
    expect(shotSpeed(0)).toBe(SHOT_MIN_SPEED);
    expect(shotSpeed(SHOT_MAX_CHARGE_TIME)).toBe(SHOT_MAX_SPEED);
    expect(shotSpeed(100)).toBe(SHOT_MAX_SPEED);
    expect(shotSpeed(0.3)).toBeLessThan(shotSpeed(0.5));
  });

  it('holding shoot is not a kick until released', () => {
    const s = run(touching(), 5, () => input({ shoot: true }));
    expect(speedOf(s.ball.vel)).toBeLessThan(5);
  });
});

describe('tackle', () => {
  it('slides in the facing direction, then goes on cooldown', () => {
    let s = setup(400, midY);
    s = run(s, 5, () => input({ moveX: 1 }));
    const x0 = s.players[0].pos.x;
    s = step(s, [input({ tackle: true })], SIM_DT);
    expect(s.players[0].tackleTimer).toBeGreaterThan(0);
    expect(s.players[0].vel.x).toBeGreaterThan(PLAYER_MAX_SPEED);
    s = run(s, 15, () => input({ moveY: -1 })); // steering is ignored while sliding
    expect(s.players[0].pos.x).toBeGreaterThan(x0 + 60);
    expect(s.players[0].pos.y).toBeCloseTo(midY, 0);
    // Cooldown: a second press right away does nothing.
    expect(s.players[0].tackleCooldown).toBeGreaterThan(0);
    s = run(s, 5, () => input());
    s = step(s, [input({ tackle: true })], SIM_DT);
    expect(s.players[0].tackleTimer).toBe(0);
    // ...but works once the cooldown has elapsed.
    s = run(s, Math.ceil(TACKLE_COOLDOWN / SIM_DT), () => input());
    s = step(s, [input({ tackle: true })], SIM_DT);
    expect(s.players[0].tackleTimer).toBeGreaterThan(0);
  });

  it('knocks the ball away if the slide hits it', () => {
    let s = setup(400, midY, 470, midY);
    s = run(s, 4, () => input({ moveX: 1 })); // face the ball, still short of it
    s = run(s, 20, (n) => input({ tackle: n === 0 }));
    expect(s.ball.vel.x).toBeGreaterThan(300);
  });

  it('does nothing when the player already has the ball', () => {
    let s = setup(500, midY, 500 + PLAYER_RADIUS + 9 + 2, midY);
    s = step(s, [input({ tackle: true })], SIM_DT);
    expect(s.players[0].tackleTimer).toBe(0);
  });
});

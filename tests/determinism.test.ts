// T18: the same seed and inputs must give a bit-identical final state, and sim/ must not touch Math.random or the clock.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SIM_DT } from '../src/config';
import { rulesFor } from '../src/sim/matchRules';
import { createMatchState, NEUTRAL_INPUT, step } from '../src/sim/simulation';
import type { GameState, InputFrame, RulesPreset } from '../src/sim/types';

/** A repeatable stream of human-ish inputs (its own tiny PRNG, so it does not depend on the sim's). */
function scriptedInput(i: number): InputFrame {
  const phase = Math.floor(i / 45);
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1], [0, 0]];
  const [moveX, moveY] = dirs[(phase * 7 + (phase >> 2)) % dirs.length];
  const k = i % 180;
  return { ...NEUTRAL_INPUT, seq: i, moveX, moveY, shoot: k > 100 && k < 125, pass: k === 60, tackle: k === 150, sprint: phase % 3 === 0, shield: phase % 5 === 4, switchPlayer: k === 30 };
}

function play(seed: number, preset: RulesPreset, seconds: number, humans: boolean): GameState {
  let s = createMatchState({ aiVsAi: !humans, seed, kickoffTeam: (seed % 2) as 0 | 1, rules: rulesFor(preset), halfLength: 40 });
  for (let i = 0; i < seconds * 60; i++) s = step(s, [humans ? scriptedInput(i) : undefined, undefined], SIM_DT);
  return s;
}

// Whole matches: slow on a busy CI machine, so a generous timeout (the default 5 s caused a flaky failure).
describe('sim determinism', { timeout: 60_000 }, () => {
  afterEach(() => vi.restoreAllMocks());

  for (const preset of ['arcade', 'classic'] as const) {
    it(`${preset}: same seed and inputs give an identical final state (AI vs AI and with a human)`, () => {
      for (const humans of [false, true]) {
        const a = play(11, preset, 90, humans);
        const b = play(11, preset, 90, humans);
        expect(JSON.stringify(b)).toBe(JSON.stringify(a));
        expect(a.tick).toBeGreaterThan(5000);
      }
    });
  }

  it('a different seed gives a different match (so the check above is not vacuous)', () => {
    expect(JSON.stringify(play(12, 'arcade', 60, false))).not.toBe(JSON.stringify(play(11, 'arcade', 60, false)));
  });

  it('runs a whole match without calling Math.random, Date.now or performance.now', () => {
    const boom = (name: string) => () => {
      throw new Error(`${name} used inside sim/ (use GameState.ai.rng and the tick count)`);
    };
    vi.spyOn(Math, 'random').mockImplementation(boom('Math.random'));
    vi.spyOn(Date, 'now').mockImplementation(boom('Date.now'));
    vi.spyOn(performance, 'now').mockImplementation(boom('performance.now'));
    expect(() => play(5, 'arcade', 100, true)).not.toThrow();
    expect(() => play(5, 'classic', 100, false)).not.toThrow();
  });
});

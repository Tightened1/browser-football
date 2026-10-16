import { describe, expect, it } from 'vitest';
import { buildInputFrame } from '../src/input/keyboard';
import { createLobbyState, looksByTeam, swapTeams } from '../src/net/protocol';
import { possessionPercent, formatTime } from '../src/matchStats';
import {
  ACTIONS,
  DEFAULT_BINDINGS,
  controlsSummary,
  defaultSettings,
  keyLabel,
  normKey,
  rebind,
  sanitizeSettings,
  unbind,
} from '../src/settings';
import { HALF_LENGTH_SECONDS, SIM_DT, STAT_SHOT_RANGE } from '../src/config';
import { matchClock } from '../src/sim/rules';
import { cloneState, createInitialState, createMatchState, step } from '../src/sim/simulation';
import { sanitizeLook } from '../src/teams';
import type { GameState, InputFrame } from '../src/sim/types';

describe('settings', () => {
  it('falls back to the defaults for missing or damaged data', () => {
    expect(sanitizeSettings(null)).toEqual(defaultSettings());
    expect(sanitizeSettings('nonsense')).toEqual(defaultSettings());
    const s = sanitizeSettings({ halfMinutes: 7, difficulty: 'impossible', volume: 'loud', showControls: 'yes', bindings: { up: 5 }, look: { name: 99, kit: -1 } });
    expect(s).toEqual(defaultSettings());
  });

  it('keeps valid values and rounds the volume', () => {
    const s = sanitizeSettings({ halfMinutes: 5, difficulty: 'hard', volume: 43, showControls: false, look: { club: 2, kit: 1 } });
    expect(s).toMatchObject({ halfMinutes: 5, difficulty: 'hard', volume: 40, showControls: false, look: { club: 2, kit: 1 } });
    expect(sanitizeSettings({ volume: 400 }).volume).toBe(100);
    expect(sanitizeSettings({ volume: -5 }).volume).toBe(0);
  });

  it('drops reserved and duplicate keys from stored bindings', () => {
    const b = { ...DEFAULT_BINDINGS, pass: ['Escape', 'KeyX'], tackle: ['KeyX', 'KeyC'] };
    const s = sanitizeSettings({ bindings: b });
    expect(s.bindings.pass).toEqual(['', 'KeyX']);
    expect(s.bindings.tackle).toEqual(['', 'KeyC']); // KeyX already belongs to pass
    expect(sanitizeSettings({ bindings: { ...DEFAULT_BINDINGS, pass: ['Escape', ''] } }).bindings).toEqual(DEFAULT_BINDINGS); // an action with no key: damaged, use the defaults
  });

  it('rebinds a key, refusing reserved keys and keys already used', () => {
    const ok = rebind(DEFAULT_BINDINGS, 'pass', 1, 'KeyB');
    expect(ok.error).toBeUndefined();
    expect(ok.bindings.pass).toEqual(['KeyX', 'KeyB']);
    expect(rebind(DEFAULT_BINDINGS, 'pass', 0, 'Escape').error).toMatch(/reserved/);
    expect(rebind(DEFAULT_BINDINGS, 'pass', 0, 'KeyC').error).toMatch(/Tackle/);
    // Right Shift counts as Shift (sprint, T17).
    expect(rebind(DEFAULT_BINDINGS, 'tackle', 1, 'ShiftRight').error).toMatch(/Sprint/);
    expect(rebind(DEFAULT_BINDINGS, 'pass', 1, 'KeyV').error).toMatch(/Shield/);
    // Binding the same key to both slots of one action keeps just one.
    expect(rebind(DEFAULT_BINDINGS, 'pass', 1, 'KeyX').bindings.pass).toEqual(['', 'KeyX']);
  });

  it('never leaves an action without a key', () => {
    expect(unbind(DEFAULT_BINDINGS, 'pass', 0).error).toBeDefined();
    expect(unbind(DEFAULT_BINDINGS, 'up', 1).bindings.up).toEqual(['ArrowUp', '']);
  });

  it('names keys for the menus', () => {
    expect(keyLabel('ArrowLeft')).toBe('←');
    expect(keyLabel('KeyQ')).toBe('Q');
    expect(keyLabel('Digit7')).toBe('7');
    expect(keyLabel('ShiftLeft')).toBe('Shift');
    expect(keyLabel('')).toBe('—');
    expect(normKey('ShiftRight')).toBe('ShiftLeft');
    expect(normKey('KeyA')).toBe('KeyA');
    expect(controlsSummary(DEFAULT_BINDINGS)).toContain('Shoot: Space');
    expect(controlsSummary(DEFAULT_BINDINGS)).toContain('Sprint: Shift');
    expect(ACTIONS).toHaveLength(10);
  });

  it('drives the input frame from rebound keys', () => {
    const b = rebind(rebind(DEFAULT_BINDINGS, 'pass', 0, 'KeyB').bindings, 'up', 0, 'KeyI').bindings;
    expect(buildInputFrame(new Set(['KeyB']), 0, b).pass).toBe(true);
    expect(buildInputFrame(new Set(['KeyX']), 0, b).pass).toBe(false);
    expect(buildInputFrame(new Set(['KeyI']), 0, b)).toMatchObject({ moveY: -1 });
    // An unbound slot ('') never matches.
    expect(buildInputFrame(new Set(['']), 0, DEFAULT_BINDINGS).pass).toBe(false);
  });
});

describe('team looks', () => {
  it('sanitises anything into a valid look, and resets a pre-T24 saved look', () => {
    expect(sanitizeLook({ club: 5, kit: 2 })).toEqual({ club: 5, kit: 2 });
    expect(sanitizeLook({ club: 1.5, kit: 2 })).toEqual({ club: 0, kit: 0 });
    expect(sanitizeLook({ club: 999, kit: 0 })).toEqual({ club: 0, kit: 0 });
    expect(sanitizeLook({ name: 1, kit: 2 })).toEqual({ club: 0, kit: 0 });
    expect(sanitizeLook(null)).toEqual({ club: 0, kit: 0 });
  });

  it('maps the lobby looks to teams, whichever side the host is on', () => {
    const lobby = createLobbyState('H', 'G', { club: 1, kit: 1 }, { club: 2, kit: 2 });
    expect(looksByTeam(lobby)).toEqual([{ club: 1, kit: 1 }, { club: 2, kit: 2 }]);
    expect(looksByTeam(swapTeams(lobby))).toEqual([{ club: 2, kit: 2 }, { club: 1, kit: 1 }]);
  });
});

describe('match length', () => {
  it('uses the half length in the state', () => {
    let s = createMatchState({ halfLength: 60, aiVsAi: true });
    expect(s.halfLength).toBe(60);
    expect(createMatchState().halfLength).toBe(HALF_LENGTH_SECONDS);
    s.phase = 'playing';
    s.clock = 59.99;
    for (let i = 0; i < 3; i++) s = step(s, [], SIM_DT);
    expect(s.phase).toBe('half-time');
    expect(matchClock({ ...s, half: 2, clock: 10 })).toBe(70);
  });
});

describe('match stats', () => {
  const shoot = (on: boolean): InputFrame => ({ seq: 0, moveX: 0, moveY: 0, pass: false, shoot: on, tackle: false, switchPlayer: false });

  /** Home player 4 (front outfield) stands next to the ball, facing right, and taps shoot. */
  function takeShot(x: number): GameState {
    let s = createInitialState();
    const p = s.players[s.controlled[0]];
    p.pos = { x, y: 400 };
    p.facing = 0;
    s.ball.pos = { x: x + p.radius + s.ball.radius + 2, y: 400 };
    s.ball.vel = { x: 0, y: 0 };
    s = step(s, [shoot(true)], SIM_DT);
    s = step(s, [shoot(false)], SIM_DT);
    return s;
  }

  it('counts a shoot kick near the goal it attacks', () => {
    const s = takeShot(1050 + 70 - STAT_SHOT_RANGE / 2);
    expect(s.stats.shots).toEqual([1, 0]);
  });

  it('does not count a shoot kick from far away, or a pass', () => {
    expect(takeShot(200).stats.shots).toEqual([0, 0]);
  });

  it('tracks possession while the ball is in play and records goals', () => {
    let s = createMatchState({ aiVsAi: true });
    s.phase = 'playing';
    s.lastTouch = { team: 1, player: 7 };
    s.ball.vel = { x: 0, y: 0 };
    for (let i = 0; i < 30; i++) s = step(s, [], SIM_DT); // before any AI player reaches the ball
    expect(s.stats.possession[1]).toBeGreaterThan(0.45);
    expect(s.stats.possession[0]).toBeLessThan(0.05);
    // A goal is recorded with its time.
    s = createInitialState();
    s.clock = 42;
    s.lastTouch = { team: 0, player: 4 };
    s.ball.pos = { x: 1120 + 12, y: 410 };
    s.ball.vel = { x: 200, y: 0 };
    s = step(s, [], SIM_DT);
    expect(s.stats.goals).toEqual([{ team: 0, player: 4, ownGoal: false, half: 1, clock: expect.closeTo(42, 1) }]);
    expect(cloneState(s).stats).toEqual(s.stats);
    expect(cloneState(s).stats).not.toBe(s.stats);
  });
});

describe('results', () => {
  it('formats times and splits possession into whole percentages', () => {
    expect(formatTime(0)).toBe('00:00');
    expect(formatTime(271.9)).toBe('04:31');
    expect(possessionPercent([1, 1])).toEqual([50, 50]);
    expect(possessionPercent([0, 0])).toEqual([50, 50]);
    const [a, b] = possessionPercent([2, 1]);
    expect(a + b).toBe(100);
    expect(a).toBe(67);
  });
});

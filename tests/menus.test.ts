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
import { cycleKit, cycleName, KIT_PRESETS, randomOpponent, resolveClash, sanitizeLook, teamStyles, TEAM_NAMES } from '../src/teams';
import type { GameState, InputFrame } from '../src/sim/types';

describe('settings', () => {
  it('falls back to the defaults for missing or damaged data', () => {
    expect(sanitizeSettings(null)).toEqual(defaultSettings());
    expect(sanitizeSettings('nonsense')).toEqual(defaultSettings());
    const s = sanitizeSettings({ halfMinutes: 7, difficulty: 'impossible', volume: 'loud', showControls: 'yes', bindings: { up: 5 }, look: { name: 99, kit: -1 } });
    expect(s).toEqual(defaultSettings());
  });

  it('keeps valid values and rounds the volume', () => {
    const s = sanitizeSettings({ halfMinutes: 5, difficulty: 'hard', volume: 43, showControls: false, look: { name: 2, kit: 4 } });
    expect(s).toMatchObject({ halfMinutes: 5, difficulty: 'hard', volume: 40, showControls: false, look: { name: 2, kit: 4 } });
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
    const ok = rebind(DEFAULT_BINDINGS, 'pass', 1, 'KeyV');
    expect(ok.error).toBeUndefined();
    expect(ok.bindings.pass).toEqual(['KeyX', 'KeyV']);
    expect(rebind(DEFAULT_BINDINGS, 'pass', 0, 'Escape').error).toMatch(/reserved/);
    expect(rebind(DEFAULT_BINDINGS, 'pass', 0, 'KeyC').error).toMatch(/Tackle/);
    // Right Shift counts as Shift.
    expect(rebind(DEFAULT_BINDINGS, 'tackle', 1, 'ShiftRight').error).toMatch(/Switch/);
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
    expect(ACTIONS).toHaveLength(8);
  });

  it('drives the input frame from rebound keys', () => {
    const b = rebind(rebind(DEFAULT_BINDINGS, 'pass', 0, 'KeyV').bindings, 'up', 0, 'KeyI').bindings;
    expect(buildInputFrame(new Set(['KeyV']), 0, b).pass).toBe(true);
    expect(buildInputFrame(new Set(['KeyX']), 0, b).pass).toBe(false);
    expect(buildInputFrame(new Set(['KeyI']), 0, b)).toMatchObject({ moveY: -1 });
    // An unbound slot ('') never matches.
    expect(buildInputFrame(new Set(['']), 0, DEFAULT_BINDINGS).pass).toBe(false);
  });
});

describe('team looks', () => {
  it('sanitises anything into a valid look', () => {
    expect(sanitizeLook({ name: 1, kit: 2 })).toEqual({ name: 1, kit: 2 });
    expect(sanitizeLook({ name: 1.5, kit: 2 })).toEqual({ name: 0, kit: 0 });
    expect(sanitizeLook(null)).toEqual({ name: 0, kit: 0 });
  });

  it('cycles kit and name, skipping what the other team uses', () => {
    expect(cycleKit({ name: 0, kit: 0 }, 1).kit).toBe(1);
    expect(cycleKit({ name: 0, kit: 0 }, 1, { name: 3, kit: 1 }).kit).toBe(2);
    expect(cycleKit({ name: 0, kit: 0 }, -1).kit).toBe(KIT_PRESETS.length - 1);
    expect(cycleName({ name: TEAM_NAMES.length - 1, kit: 0 }, 1).name).toBe(0);
    expect(cycleName({ name: 0, kit: 0 }, 1, { name: 1, kit: 5 }).name).toBe(2);
  });

  it('prevents clashes: kit colour and team name', () => {
    const host = { name: 0, kit: 0 };
    expect(resolveClash({ name: 1, kit: 2 }, host)).toEqual({ name: 1, kit: 2 });
    const same = resolveClash({ name: 0, kit: 0 }, host);
    expect(same.kit).not.toBe(host.kit);
    expect(same.name).not.toBe(host.name);
    // Whatever the guest asks for, it never ends up with the host's kit.
    for (let k = 0; k < KIT_PRESETS.length; k++) expect(resolveClash({ name: 4, kit: k }, host).kit).not.toBe(host.kit);
  });

  it('gives an offline opponent a different look', () => {
    for (let i = 0; i < 20; i++) {
      const mine = { name: i % TEAM_NAMES.length, kit: i % KIT_PRESETS.length };
      const opp = randomOpponent(mine, () => (i * 0.137) % 1);
      expect(opp.kit).not.toBe(mine.kit);
      expect(opp.name).not.toBe(mine.name);
    }
  });

  it('never gives both keepers the same shirt', () => {
    for (let a = 0; a < KIT_PRESETS.length; a++) {
      for (let b = 0; b < KIT_PRESETS.length; b++) {
        if (a === b) continue;
        const [x, y] = teamStyles([{ name: 0, kit: a }, { name: 1, kit: b }]);
        expect(x.keeper).not.toBe(y.keeper);
        expect(y.keeper).not.toBe(x.kit);
      }
    }
  });

  it('maps the lobby looks to teams, whichever side the host is on', () => {
    const lobby = createLobbyState('H', 'G', { name: 1, kit: 1 }, { name: 2, kit: 2 });
    expect(looksByTeam(lobby)).toEqual([{ name: 1, kit: 1 }, { name: 2, kit: 2 }]);
    expect(looksByTeam(swapTeams(lobby))).toEqual([{ name: 2, kit: 2 }, { name: 1, kit: 1 }]);
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
    for (let i = 0; i < 60; i++) s = step(s, [], SIM_DT);
    expect(s.stats.possession[1]).toBeGreaterThan(0.9);
    expect(s.stats.possession[0]).toBeLessThan(0.1);
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

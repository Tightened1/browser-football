// T15: match-rules presets (Arcade / Classic), keepers parrying, aim assist, the finesse shot, eased defending, and the
// rules travelling over the network.
import { describe, expect, it } from 'vitest';
import {
  AIM_ASSIST_CORNER_INSET,
  AIM_ASSIST_STRENGTH,
  BALL_RADIUS,
  FINESSE_SPEED,
  GOAL_WIDTH,
  GOAL_WIDTH_BIG,
  KEEPER_CATCH_SPEED,
  KEEPER_CATCH_SPEED_ARCADE,
  KEEPER_DIFFICULTY,
  PITCH_HEIGHT,
  PITCH_LEFT,
  PITCH_RIGHT,
  PITCH_TOP,
  PLAYER_RADIUS,
  SHOT_MAX_CHARGE_TIME,
  SHOT_MAX_SPEED,
  SHOT_QUICK_CHARGE_TIME,
  SIM_DT,
} from '../src/config';
import { analyse, choosePressers, createAiState } from '../src/sim/ai';
import { CLASSIC_RULES, isMatchRules, rulesFor } from '../src/sim/matchRules';
import { assistAim, yAtGoalLine } from '../src/sim/shooting';
import { createInitialState, createMatchState, createSoloState, NEUTRAL_INPUT, step } from '../src/sim/simulation';
import { createLobbyState, decode, setLobbyRules } from '../src/net/protocol';
import { matchRulesSetting, sanitizeSettings } from '../src/settings';
import type { GameState, InputFrame, MatchRules } from '../src/sim/types';

const midY = PITCH_TOP + PITCH_HEIGHT / 2;
const input = (o: Partial<InputFrame> = {}): InputFrame => ({ ...NEUTRAL_INPUT, ...o });
const ARCADE = rulesFor('arcade');

/** A lone human player at (x, y) carrying the ball (facing right), under `rules`. */
function carrying(x: number, y: number, rules: MatchRules): GameState {
  let s = createSoloState(x, y);
  s.rules = rules;
  s.ball.pos = { x: x + PLAYER_RADIUS + BALL_RADIUS + 2, y };
  s = step(s, [input()], SIM_DT);
  expect(s.possession?.player).toBe(0);
  return s;
}

function run(s: GameState, ticks: number, f: (n: number) => InputFrame): GameState {
  for (let i = 0; i < ticks; i++) s = step(s, [f(i)], SIM_DT);
  return s;
}

describe('match-rules presets', () => {
  it('Classic is the game as it was before T15 (plus T17: Normal AI defending vs humans; T19: a Strict referee with cards, draws stay draws)', () => {
    expect(rulesFor('classic')).toEqual({
      preset: 'classic',
      goalWidth: GOAL_WIDTH,
      keeperDifficulty: 'team',
      keeperCatchSpeed: KEEPER_CATCH_SPEED,
      keeperFlaws: false,
      shotChargeTime: SHOT_MAX_CHARGE_TIME,
      aimAssist: false,
      finesse: false,
      aimLine: false,
      easedDefending: false,
      aiDefending: 'normal',
      fouls: 'strict',
      cards: true,
      draws: 'off',
    });
    // ...and what the sim uses when no rules are given.
    expect(createInitialState().rules).toEqual(CLASSIC_RULES);
  });

  it('Arcade: big goals, easy keepers who parry more, quick charge, aim assist, finesse, aim line, eased defending, a Lenient referee, shoot-outs', () => {
    expect(ARCADE).toEqual({
      preset: 'arcade',
      goalWidth: GOAL_WIDTH_BIG,
      keeperDifficulty: KEEPER_DIFFICULTY,
      keeperCatchSpeed: KEEPER_CATCH_SPEED_ARCADE,
      keeperFlaws: true,
      shotChargeTime: SHOT_QUICK_CHARGE_TIME,
      aimAssist: true,
      finesse: true,
      aimLine: true,
      easedDefending: true,
      aiDefending: 'relaxed',
      fouls: 'lenient',
      cards: false,
      draws: 'shootout',
    });
    expect(KEEPER_DIFFICULTY).toBe('easy');
    expect(GOAL_WIDTH_BIG).toBeGreaterThan(GOAL_WIDTH);
    expect(KEEPER_CATCH_SPEED_ARCADE).toBeLessThan(KEEPER_CATCH_SPEED);
    expect(SHOT_QUICK_CHARGE_TIME).toBeLessThan(SHOT_MAX_CHARGE_TIME);
  });

  it('the keepers setting overrides only the keepers', () => {
    expect(rulesFor('arcade', 'hard')).toEqual({ ...ARCADE, keeperDifficulty: 'hard' });
    expect(rulesFor('classic', 'rules').keeperDifficulty).toBe('team');
  });

  it('settings default to Arcade, survive storage and build the rules', () => {
    const d = sanitizeSettings(null);
    expect(d.rules).toBe('arcade');
    expect(d.keepers).toBe('rules');
    expect(matchRulesSetting(d)).toEqual(ARCADE);
    const stored = sanitizeSettings(JSON.parse(JSON.stringify({ ...d, rules: 'classic', keepers: 'normal' })));
    expect(matchRulesSetting(stored)).toEqual({ ...CLASSIC_RULES, keeperDifficulty: 'normal' });
    expect(sanitizeSettings({ rules: 'silly', keepers: 7 }).rules).toBe('arcade');
  });

  it('a match keeps its rules through every step', () => {
    let s = createMatchState({ rules: ARCADE, aiVsAi: true });
    s = run(s, 120, () => input());
    expect(s.rules).toEqual(ARCADE);
  });

  it('big goals: a ball crossing the line 74 px off-centre is a goal under Arcade, not under Classic (off the post and wide)', () => {
    const cross = (rules: MatchRules): GameState => {
      let s = createInitialState({ aiVsAi: true, rules });
      for (const p of s.players) p.pos = { x: PITCH_LEFT + 300 + p.id * 40, y: PITCH_TOP + 40 };
      s.ball.pos = { x: PITCH_RIGHT - 30, y: midY + 74 };
      s.ball.vel = { x: 600, y: 0 };
      s.lastTouch = { team: 0, player: 3 };
      return run(s, 30, () => input());
    };
    expect(cross(ARCADE).score).toEqual([1, 0]);
    expect(cross(CLASSIC_RULES).score).toEqual([0, 0]);
  });

  it('quick charge: full power after SHOT_QUICK_CHARGE_TIME under Arcade', () => {
    const shot = (rules: MatchRules): number => {
      let s = carrying(300, midY, rules);
      s = run(s, Math.round(SHOT_QUICK_CHARGE_TIME / SIM_DT), () => input({ moveX: 1, shoot: true }));
      s = step(s, [input({ moveX: 1 })], SIM_DT);
      return Math.hypot(s.ball.vel.x, s.ball.vel.y);
    };
    expect(shot(ARCADE)).toBeGreaterThan(SHOT_MAX_SPEED * 0.97);
    expect(shot(CLASSIC_RULES)).toBeLessThan(SHOT_MAX_SPEED * 0.85);
  });
});

describe('keepers', () => {
  /** A shot straight at the away keeper (in its box) from 120 px, launched at `speed`: the state just after it reaches the keeper. */
  function shotAtKeeper(speed: number, rules: MatchRules): GameState {
    let s = createInitialState({ aiVsAi: true, rules });
    for (const p of s.players) if (p.id !== 5) p.pos = { x: 300, y: PITCH_TOP + 30 + p.id * 30 };
    const keeper = s.players[5];
    s.ball.pos = { x: keeper.pos.x - 120, y: keeper.pos.y };
    s.ball.vel = { x: speed, y: 0 };
    s.lastTouch = { team: 0, player: 3 };
    for (let i = 0; i < 30 && s.lastTouch?.player !== 5; i++) s = step(s, [], SIM_DT);
    expect(s.lastTouch?.player).toBe(5);
    return s;
  }


  it('parry (not catch) shots above the Arcade catch speed, and still catch soft ones', () => {
    const hard = shotAtKeeper(KEEPER_CATCH_SPEED_ARCADE + 150, ARCADE);
    expect(hard.possession).toBeNull();
    expect(hard.score).toEqual([0, 0]);
    expect(hard.ball.vel.x).toBeLessThan(0); // pushed back out, away from the goal: a save, and a rebound
    expect(shotAtKeeper(KEEPER_CATCH_SPEED_ARCADE - 150, ARCADE).possession?.player).toBe(5);
    // The same medium shot is held under Classic.
    expect(shotAtKeeper(KEEPER_CATCH_SPEED_ARCADE + 150, CLASSIC_RULES).possession?.player).toBe(5);
  });
});

describe('aim assist', () => {
  const state = (): GameState => createInitialState({ rules: ARCADE });
  const goalX = PITCH_RIGHT;
  const half = GOAL_WIDTH_BIG / 2;
  const cornerYs = [midY - half + AIM_ASSIST_CORNER_INSET, midY + half - AIM_ASSIST_CORNER_INSET];

  it('never turns a wide shot into a perfectly placed one', () => {
    const s = state();
    let helped = 0;
    for (let x = goalX - 400; x <= goalX - 60; x += 20) {
      for (let y = midY - 200; y <= midY + 200; y += 20) {
        const from = { x, y };
        for (let a = -1.2; a <= 1.2; a += 0.01) {
          const raw = yAtGoalLine(from, a, goalX);
          if (raw === null || Math.abs(raw - midY) <= half) continue; // only shots that would miss
          const out = assistAim(s, 0, from, a);
          const y2 = yAtGoalLine(from, out, goalX);
          if (out !== a) helped++;
          // Bent at most part of the way to the nearer corner: never onto it.
          const corner = cornerYs.reduce((b, c) => (Math.abs(c - raw) < Math.abs(b - raw) ? c : b));
          const toCorner = Math.atan2(corner - y, goalX - x);
          expect(Math.abs(out - toCorner)).toBeGreaterThanOrEqual((1 - AIM_ASSIST_STRENGTH) * Math.abs(a - toCorner) - 1e-9);
          if (y2 !== null) expect(Math.abs(y2 - corner)).toBeGreaterThan(1);
        }
      }
    }
    expect(helped).toBeGreaterThan(100); // it does help near misses
  });

  it('leaves shots well wide, from out of range, or with the assist off alone', () => {
    const s = state();
    const from = { x: goalX - 150, y: midY };
    expect(assistAim(s, 0, from, 1.2)).toBe(1.2); // nowhere near the goal
    expect(assistAim(s, 0, { x: goalX - 600, y: midY }, 0)).toBe(0); // out of range
    expect(assistAim(s, 0, from, Math.PI)).toBe(Math.PI); // the wrong way
    expect(assistAim(createInitialState({ rules: CLASSIC_RULES }), 0, from, 0.3)).toBe(0.3); // Classic
  });

  it('only nudges a shot straight at the keeper', () => {
    const s = state();
    const from = { x: goalX - 155, y: midY };
    const out = assistAim(s, 0, from, 0);
    expect(out).not.toBe(0);
    expect(Math.abs(yAtGoalLine(from, out, goalX)! - midY)).toBeLessThan(20);
  });
});

describe('finesse shot', () => {
  it('hold shoot, tap pass: a slower, curled shot that ends up inside the post; releasing shoot then kicks nothing', () => {
    let s = carrying(PITCH_RIGHT - 170, midY + 30, ARCADE);
    s.players = s.players.slice(0, 1);
    s = run(s, 3, () => input({ moveX: 1, shoot: true }));
    s = step(s, [input({ moveX: 1, shoot: true, pass: true })], SIM_DT);
    expect(s.possession).toBeNull();
    expect(Math.hypot(s.ball.vel.x, s.ball.vel.y)).toBeGreaterThan(FINESSE_SPEED * 0.9);
    expect(Math.hypot(s.ball.vel.x, s.ball.vel.y)).toBeLessThan(SHOT_MAX_SPEED * 0.8);
    expect(s.ball.spin).not.toBe(0);
    const p = s.players[0];
    s = run(s, 4, () => input({ moveX: 1, shoot: true }));
    s = step(s, [input({ moveX: 1 })], SIM_DT); // release shoot: no second kick
    expect(p.kickQueue === 0 && s.players[0].kickQueue === 0).toBe(true);
    let crossed: number | null = null;
    for (let i = 0; i < 90 && crossed === null; i++) {
      s = step(s, [input()], SIM_DT);
      if (s.ball.pos.x >= PITCH_RIGHT) crossed = s.ball.pos.y;
    }
    expect(crossed).not.toBeNull();
    // Into the bottom half of the goal (the side the shooter stands), inside the post.
    expect(crossed! - midY).toBeGreaterThan(GOAL_WIDTH_BIG / 4);
    expect(crossed! - midY).toBeLessThan(GOAL_WIDTH_BIG / 2 - BALL_RADIUS);
  });

  it('is off under Classic: the same keys are a pass', () => {
    let s = carrying(PITCH_RIGHT - 170, midY + 30, CLASSIC_RULES);
    s = run(s, 3, () => input({ moveX: 1, shoot: true }));
    s = step(s, [input({ moveX: 1, shoot: true, pass: true })], SIM_DT);
    expect(s.ball.spin ?? 0).toBe(0);
    expect(Math.hypot(s.ball.vel.x, s.ball.vel.y)).toBeLessThan(FINESSE_SPEED * 0.75);
  });
});

describe('eased defending', () => {
  it('only one AI player presses a human on the ball (two under Classic, near goal)', () => {
    const pressers = (rules: MatchRules): number => {
      const s = createInitialState({ humans: [true, false], rules });
      const me = s.players[s.controlled[0]];
      me.pos = { x: PITCH_RIGHT - 200, y: midY };
      s.ball.pos = { x: me.pos.x + PLAYER_RADIUS + BALL_RADIUS + 1, y: midY };
      s.possession = { player: me.id, angle: 0, roll: 0 };
      s.lastTouch = { team: 0, player: me.id };
      s.ai = createAiState(s.players, s.controlled, undefined, 1);
      return choosePressers(s, analyse(s, [true, false]), 1).length;
    };
    expect(pressers(ARCADE)).toBe(1);
    expect(pressers(CLASSIC_RULES)).toBe(2);
  });
});

describe('network', () => {
  it('the rules survive the handshake: lobby and start messages, through JSON', () => {
    const lobby = createLobbyState('Host', 'Guest', undefined, undefined, rulesFor('arcade', 'normal'));
    const welcome = decode(JSON.parse(JSON.stringify({ t: 'welcome', protocol: 5, game: '1', name: 'Host', lobby })));
    expect(welcome?.t === 'welcome' && welcome.lobby.rules).toEqual(rulesFor('arcade', 'normal'));
    const start = decode(JSON.parse(JSON.stringify({ t: 'start', hostTeam: 0, seed: 3, token: 't', half: 90, rules: CLASSIC_RULES })));
    expect(start?.t === 'start' && start.rules).toEqual(CLASSIC_RULES);
    // A malformed or missing rules object is refused.
    expect(decode({ t: 'start', hostTeam: 0, seed: 3, token: 't', half: 90 })).toBeNull();
    expect(decode({ t: 'start', hostTeam: 0, seed: 3, token: 't', half: 90, rules: { ...ARCADE, goalWidth: 'big' } })).toBeNull();
    expect(decode({ t: 'lobby', lobby: { ...lobby, rules: { ...ARCADE, preset: 'chaos' } } })).toBeNull();
    expect(isMatchRules({ ...ARCADE, shotChargeTime: 0 })).toBe(false);
  });

  it('changing the rules in the lobby makes both players confirm again', () => {
    const lobby = { ...createLobbyState('Host', 'Guest'), ready: [true, true] as [boolean, boolean] };
    const changed = setLobbyRules(lobby, CLASSIC_RULES);
    expect(changed.rules).toEqual(CLASSIC_RULES);
    expect(changed.ready).toEqual([false, false]);
  });
});

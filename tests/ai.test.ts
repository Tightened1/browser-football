import { describe, expect, it } from 'vitest';
import {
  AI_PROFILES,
  GOAL_WIDTH,
  PITCH_BOTTOM,
  PITCH_LEFT,
  PITCH_RIGHT,
  PITCH_TOP,
  SIM_DT,
} from '../src/config';
import {
  analyse,
  choosePressers,
  computeAiInputs,
  evaluateOnBall,
  keeperPosition,
  laneClearance,
  nextRandom,
} from '../src/sim/ai';
import { cloneState, createInitialState, NEUTRAL_INPUT, step } from '../src/sim/simulation';
import type { Difficulty, GameState, InputFrame } from '../src/sim/types';

const midY = (PITCH_TOP + PITCH_BOTTOM) / 2;
const noNoise = (): number => 0.5;

/**
 * An all-AI match with the ball and some players placed (home: 0 keeper, 1..4 outfield, attacking right;
 * away: 5 keeper, 6..9, attacking left). Unplaced outfield players are parked out of the way near the
 * top and bottom touchlines; keepers stay in goal unless placed. `owner` gets the last touch.
 */
function scenario(
  ball: [number, number],
  at: Record<number, [number, number]>,
  opts: { owner?: number; difficulty?: Difficulty } = {},
): GameState {
  const d = opts.difficulty ?? 'normal';
  const s = createInitialState({ aiVsAi: true, difficulty: [d, d] });
  s.ball.pos = { x: ball[0], y: ball[1] };
  for (const p of s.players) {
    if (p.role === 'keeper') continue;
    p.pos = { x: p.team === 0 ? 200 + p.id * 30 : 700 + p.id * 30, y: p.id % 2 ? PITCH_TOP + 20 : PITCH_BOTTOM - 20 };
  }
  for (const [id, [x, y]] of Object.entries(at)) s.players[+id].pos = { x, y };
  if (opts.owner !== undefined) s.lastTouch = { team: s.players[opts.owner].team, player: opts.owner };
  return s;
}

function run(s: GameState, ticks: number, each?: (s: GameState, i: number) => void): GameState {
  for (let i = 0; i < ticks; i++) {
    s = step(s, [], SIM_DT);
    each?.(s, i);
  }
  return s;
}

describe('on the ball: decisions', () => {
  it('shoots when clear in front of goal', () => {
    const s = scenario([PITCH_RIGHT - 136, midY], { 3: [PITCH_RIGHT - 160, midY] }, { owner: 3 });
    const d = evaluateOnBall(s, s.players[3], noNoise);
    expect(d.action).toBe('shoot');
    expect(d.target.x).toBe(PITCH_RIGHT);
    expect(Math.abs(d.target.y - midY)).toBeLessThan(GOAL_WIDTH / 2);
  });

  it('aims away from the keeper', () => {
    const s = scenario([PITCH_RIGHT - 136, midY], { 3: [PITCH_RIGHT - 160, midY], 5: [PITCH_RIGHT - 24, midY - 30] }, { owner: 3 });
    const d = evaluateOnBall(s, s.players[3], noNoise);
    expect(d.action).toBe('shoot');
    expect(d.target.y).toBeGreaterThan(midY); // keeper has gone to the top half
  });

  it('dribbles with space ahead and no good pass, far from goal', () => {
    const s = scenario([424, midY], { 3: [400, midY], 1: [150, 200], 2: [150, 600], 4: [160, 420] }, { owner: 3 });
    for (const id of [6, 7, 8, 9]) s.players[id].pos = { x: 1000, y: 150 + id * 60 };
    expect(evaluateOnBall(s, s.players[3], noNoise).action).toBe('dribble');
  });

  it('passes when pressured with an open teammate (but dribbles when not pressured)', () => {
    const at: Record<number, [number, number]> = { 3: [600, midY], 4: [600, 230], 1: [150, 650], 2: [150, 150] };
    const calm = scenario([624, midY], at, { owner: 3 });
    for (const id of [6, 7, 8, 9]) calm.players[id].pos = { x: 1000, y: 150 + id * 60 };
    expect(evaluateOnBall(calm, calm.players[3], noNoise).action).toBe('dribble');

    const pressed = cloneState(calm);
    pressed.players[7].pos = { x: 640, y: midY + 30 }; // closing in
    const d = evaluateOnBall(pressed, pressed.players[3], noNoise);
    expect(d.action).toBe('pass');
    expect(d.receiver).toBe(4);
  });

  it('never passes through an opponent standing in the lane', () => {
    const s = scenario([624, midY], { 3: [600, midY], 4: [900, midY], 1: [150, 650], 2: [150, 150] }, { owner: 3 });
    s.players[7].pos = { x: 760, y: midY + 5 };
    expect(laneClearance(s, 0, s.ball.pos, s.players[4].pos)).toBeLessThan(0);
    expect(evaluateOnBall(s, s.players[3], noNoise).receiver).not.toBe(4);
  });

  it('a defender pressured near its own goal does not shoot', () => {
    const s = scenario([PITCH_LEFT + 140, midY], { 1: [PITCH_LEFT + 116, midY], 8: [PITCH_LEFT + 170, midY + 20] }, { owner: 1 });
    expect(['clear', 'pass', 'dribble']).toContain(evaluateOnBall(s, s.players[1], noNoise).action);
  });
});

describe('on the ball: execution through InputFrames', () => {
  it('a clear striker actually shoots at the goal mouth', () => {
    let s = scenario([PITCH_RIGHT - 176, midY + 10], { 3: [PITCH_RIGHT - 200, midY + 10] }, { owner: 3 });
    let shotVel: { x: number; y: number } | null = null;
    let shotPos = { x: 0, y: 0 };
    s = run(s, 120, (st) => {
      if (!shotVel && st.ai.teams[0].shots > 0) {
        shotVel = { ...st.ball.vel };
        shotPos = { ...st.ball.pos };
      }
    });
    expect(shotVel).not.toBeNull();
    const v = shotVel!;
    expect(v.x).toBeGreaterThan(400);
    const yAtLine = shotPos.y + (v.y * (PITCH_RIGHT - shotPos.x)) / v.x;
    expect(Math.abs(yAtLine - midY)).toBeLessThan(GOAL_WIDTH / 2 + 20);
  });

  it('a pressured carrier plays the pass to the open teammate', () => {
    let s = scenario([624, midY], { 3: [600, midY], 4: [760, 270], 7: [575, midY + 40], 1: [150, 650], 2: [150, 150] }, { owner: 3 });
    let receiver = -1;
    s = run(s, 90, (st) => {
      if (receiver < 0 && st.ai.teams[0].passes > 0) receiver = st.ai.teams[0].passReceiver;
    });
    expect(s.ai.teams[0].passes).toBeGreaterThan(0);
    expect(receiver).toBe(4);
  });

  it('never moves players itself: computeAiInputs only returns InputFrames', () => {
    const s = run(createInitialState({ aiVsAi: true }), 200);
    const before = JSON.stringify({ players: s.players, ball: s.ball, lastTouch: s.lastTouch, controlled: s.controlled });
    const inputs = computeAiInputs(s);
    expect(JSON.stringify({ players: s.players, ball: s.ball, lastTouch: s.lastTouch, controlled: s.controlled })).toBe(before);
    expect(inputs).toHaveLength(s.players.length);
    for (const f of inputs) expect(Math.hypot(f.moveX, f.moveY)).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('a human-controlled player is left to the human', () => {
    const s = createInitialState();
    const inputs = computeAiInputs(s, [true, false]);
    const human = s.controlled[0];
    expect(inputs[human]).toEqual({ ...NEUTRAL_INPUT });
    expect(s.ai.players[human].intent).toBe('human');
  });
});

describe('off the ball', () => {
  it('only one or two players press the carrier; the quickest presses', () => {
    let s = scenario([600, midY], { 8: [576, midY], 1: [300, 300], 2: [300, 520], 3: [450, 330], 4: [470, 500] }, { owner: 8 });
    s = run(s, 30);
    const home = s.players.filter((p) => p.team === 0 && p.role !== 'keeper');
    const pressing = home.filter((p) => ['press', 'cover'].includes(s.ai.players[p.id].intent));
    expect(pressing.length).toBeGreaterThanOrEqual(1);
    expect(pressing.length).toBeLessThanOrEqual(2);
    const pressers = choosePressers(s, analyse(s, [false, false]), 0);
    const presser = home.find((p) => s.ai.players[p.id].intent === 'press');
    expect(presser).toBeDefined();
    expect(pressers).toContain(presser!.id);
  });

  it('defenders mark goal-side of the attackers they pick up', () => {
    let s = scenario([700, midY], { 8: [680, midY], 6: [330, 260], 7: [330, 560], 1: [250, 300], 2: [250, 520] }, { owner: 8 });
    s = run(s, 60);
    for (const id of [1, 2]) {
      const m = s.ai.players[id];
      if (m.intent !== 'mark' || m.markId < 0) continue;
      const marked = s.players[m.markId];
      expect(m.target.x).toBeLessThan(marked.pos.x); // home defends the left goal
    }
    expect([s.ai.players[1].intent, s.ai.players[2].intent]).toContain('mark');
  });

  it('does not bunch: rarely more than two players of a team crowd the ball', () => {
    let crowded = 0;
    let ticks = 0;
    run(createInitialState({ aiVsAi: true }), 60 * 60, (s) => {
      for (const team of [0, 1]) {
        const near = s.players.filter(
          (p) => p.team === team && p.role !== 'keeper' && Math.hypot(p.pos.x - s.ball.pos.x, p.pos.y - s.ball.pos.y) < 70,
        ).length;
        if (near >= 3) crowded++;
        ticks++;
      }
    });
    expect(crowded / ticks).toBeLessThan(0.05);
  });

  it('team modes follow possession', () => {
    let s = scenario([624, midY], { 3: [600, midY] }, { owner: 3 });
    s = run(s, 70, (st) => {
      st.ball.pos = { x: st.players[3].pos.x + 24, y: st.players[3].pos.y }; // keep it at his feet
      st.ball.vel = { x: 0, y: 0 };
      st.lastTouch = { team: 0, player: 3 };
    });
    expect(s.ai.teams[0].mode).toBe('attacking');
    expect(s.ai.teams[1].mode).toBe('defending');
  });

  it('pressers make tackles over a match', () => {
    const s = run(createInitialState({ aiVsAi: true, difficulty: ['hard', 'hard'] }), 60 * 30);
    expect(s.ai.teams[0].tackles + s.ai.teams[1].tackles).toBeGreaterThan(0);
  });
});

describe('goalkeeper', () => {
  it('positions on the line between the ball and the goal centre, further out for distant balls', () => {
    const s = createInitialState();
    const k = s.players[0];
    for (const [bx, by] of [[400, 200], [300, 650], [700, midY], [200, midY + 100]]) {
      s.ball.pos = { x: bx, y: by };
      const pos = keeperPosition(s, k);
      // Collinear with goal centre and ball (unless clamped to the goal width).
      const cross = (pos.x - PITCH_LEFT) * (by - midY) - (pos.y - midY) * (bx - PITCH_LEFT);
      const offLine = Math.abs(cross) / Math.hypot(bx - PITCH_LEFT, by - midY);
      if (Math.abs(pos.y - midY) < GOAL_WIDTH / 2 - 9) expect(offLine).toBeLessThan(1);
      expect(pos.x).toBeGreaterThan(PITCH_LEFT);
      expect(Math.abs(pos.y - midY)).toBeLessThanOrEqual(GOAL_WIDTH / 2);
    }
    s.ball.pos = { x: 200, y: midY };
    const near = keeperPosition(s, k).x;
    s.ball.pos = { x: 700, y: midY };
    expect(keeperPosition(s, k).x).toBeGreaterThan(near);
  });

  it('dives for a shot heading for the corner and keeps it out', () => {
    let s = scenario([PITCH_LEFT + 300, midY], {}, { difficulty: 'hard' });
    s = run(s, 30, (st) => {
      st.ball.pos = { x: PITCH_LEFT + 300, y: midY };
      st.ball.vel = { x: 0, y: 0 };
    });
    const target = { x: PITCH_LEFT, y: midY + 56 };
    const d = Math.hypot(target.x - s.ball.pos.x, target.y - s.ball.pos.y);
    s.ball.vel = { x: ((target.x - s.ball.pos.x) / d) * 1100, y: ((target.y - s.ball.pos.y) / d) * 1100 };
    s.lastTouch = { team: 1, player: 8 };
    s.ai.teams[1].shotLive = true; // as if player 8 had just shot
    s.ai.lastToucher = 8;
    let dived = false;
    let minX = Infinity;
    s = run(s, 40, (st) => {
      if (st.players[0].tackleTimer > 0) dived = true;
      minX = Math.min(minX, st.ball.pos.x);
    });
    expect(dived).toBe(true);
    expect(minX).toBeGreaterThan(PITCH_LEFT - 2);
    expect(s.ai.teams[0].saves).toBe(1);
  });

  it('comes out for a loose ball close to goal', () => {
    let s = scenario([PITCH_LEFT + 130, midY + 30], {});
    s.ball.vel = { x: -20, y: 0 };
    const intents = new Set<string>();
    s = run(s, 45, (st) => intents.add(st.ai.players[0].intent));
    expect(intents.has('rush')).toBe(true);
    const k = s.players[0];
    expect(Math.hypot(k.pos.x - s.ball.pos.x, k.pos.y - s.ball.pos.y)).toBeLessThan(60);
  });

  it('after a save, distributes the ball to a teammate', () => {
    let s = scenario([PITCH_LEFT + 52, midY], { 1: [PITCH_LEFT + 220, 220], 2: [PITCH_LEFT + 220, 600] }, { owner: 0 });
    s.players[0].pos = { x: PITCH_LEFT + 26, y: midY };
    let distributed = false;
    s = run(s, 150, (st) => {
      if (st.ai.players[0].intent === 'distribute') distributed = true;
    });
    expect(distributed).toBe(true);
    expect(s.ai.teams[0].passes).toBeGreaterThan(0);
  });
});

describe('difficulty, determinism and performance', () => {
  it('difficulty scales reaction time, aiming error and speed', () => {
    const [e, n, h] = [AI_PROFILES.easy, AI_PROFILES.normal, AI_PROFILES.hard];
    expect(e.reactionTime).toBeGreaterThan(n.reactionTime);
    expect(n.reactionTime).toBeGreaterThan(h.reactionTime);
    expect(e.aimError).toBeGreaterThan(n.aimError);
    expect(n.aimError).toBeGreaterThan(h.aimError);
    expect(e.speed).toBeLessThan(n.speed);
    expect(n.speed).toBeLessThanOrEqual(h.speed);
    expect(h.speed).toBeLessThanOrEqual(1);
  });

  it('AI move inputs never exceed the difficulty speed (no faster than a human)', () => {
    let s = createInitialState({ aiVsAi: true, difficulty: ['easy', 'easy'] });
    for (let i = 0; i < 1200; i++) {
      const probe = cloneState(s);
      const frames: InputFrame[] = computeAiInputs(probe);
      for (const f of frames) if (!f.tackle) expect(Math.hypot(f.moveX, f.moveY)).toBeLessThanOrEqual(AI_PROFILES.easy.speed + 1e-9);
      s = step(s, [], SIM_DT);
    }
  });

  it('is deterministic for the same state and seed, and the RNG lives in the state', () => {
    const go = (seed: number) => run(createInitialState({ aiVsAi: true, seed }), 900);
    const a = go(7);
    expect(a).toEqual(go(7));
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
    expect(go(8).ball.pos).not.toEqual(a.ball.pos);

    const s = createInitialState();
    const r0 = s.ai.rng;
    const x = nextRandom(s.ai);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThan(1);
    expect(s.ai.rng).not.toBe(r0);
  });

  it('runs well within budget for 10 players at 60 Hz', () => {
    let s = createInitialState({ aiVsAi: true });
    const t0 = performance.now();
    const ticks = 60 * 30;
    s = run(s, ticks);
    const msPerTick = (performance.now() - t0) / ticks;
    expect(msPerTick).toBeLessThan(1); // the 60 Hz budget is 16.7 ms; measured ~0.04 ms
  });
});

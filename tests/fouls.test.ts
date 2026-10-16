// T19: fouls (slides into the player first or from behind, late challenges), free kicks and walls, penalties (goal,
// save), cards and sending off, golden goal and the penalty shoot-out.
import { describe, expect, it } from 'vitest';
import {
  FREE_KICK_CLEAR_RADIUS,
  HALVES,
  KEEPER_LINE_OFFSET,
  PENALTY_BOX_WIDTH,
  PITCH_HEIGHT,
  PITCH_LEFT,
  PITCH_RIGHT,
  PITCH_TOP,
  PITCH_WIDTH,
  SENT_OFF_POS,
  SIM_DT,
} from '../src/config';
import { detectFoul, inPenaltyBox, penaltySpot, shootoutTally, shootoutWinner, WALL_DISTANCE } from '../src/sim/fouls';
import { rulesFor } from '../src/sim/matchRules';
import { penaltyAim } from '../src/sim/setpiece';
import { createInitialState, createMatchState, NEUTRAL_INPUT, step } from '../src/sim/simulation';
import { decodeSnapshot, encodeSnapshot, takeSnapshot } from '../src/net/snapshot';
import type { FoulStrictness, GameState, InputFrame, MatchRules } from '../src/sim/types';

const MID_X = PITCH_LEFT + PITCH_WIDTH / 2;
const MID_Y = PITCH_TOP + PITCH_HEIGHT / 2;
/** Team 0's and team 1's human-controlled players (createInitialState with two humans). */
const A = 4;
const B = 9;

const rules = (fouls: FoulStrictness, cards = false, more: Partial<MatchRules> = {}): MatchRules => ({ ...rulesFor('arcade'), fouls, cards, ...more });

/**
 * Open play with two humans: B (team 1) carries the ball at `at` (held at `ballAngle` round it), A (team 0) at `from`;
 * everyone else is parked far away in the corners so the AI can't get involved.
 */
function duel(r: MatchRules, at: { x: number; y: number }, from: { x: number; y: number }, ballAngle = 0, carrierFacing = 0): GameState {
  const s = createInitialState({ humans: [true, true], rules: r });
  s.players.forEach((p, i) => {
    if (p.role === 'keeper') return;
    p.pos = { x: i % 2 ? PITCH_RIGHT - 30 : PITCH_LEFT + 30, y: i < 5 ? PITCH_TOP + 30 + i * 20 : PITCH_TOP + PITCH_HEIGHT - 30 - (i - 5) * 20 };
  });
  const a = s.players[A];
  const b = s.players[B];
  b.pos = { ...at };
  b.facing = carrierFacing;
  a.pos = { ...from };
  s.possession = { player: B, angle: ballAngle, roll: 0 };
  s.ball.pos = { x: at.x + Math.cos(ballAngle) * 24.5, y: at.y + Math.sin(ballAngle) * 24.5 };
  s.lastTouch = { team: 1, player: B };
  return s;
}

/** Steps `n` ticks with these inputs for teams 0 and 1 (a function of the tick index, or fixed). */
function run(s: GameState, n: number, a: (i: number) => InputFrame = () => NEUTRAL_INPUT, b: (i: number) => InputFrame = () => NEUTRAL_INPUT): GameState {
  for (let i = 0; i < n; i++) s = step(s, [a(i), b(i)], SIM_DT);
  return s;
}

/** A slides (tackle pressed on the first tick) in direction (dx, dy). */
const slide = (dx: number, dy: number) => (i: number): InputFrame => ({ ...NEUTRAL_INPUT, seq: i, moveX: dx, moveY: dy, tackle: i === 0 });

const fouls = (s: GameState): number => s.stats.fouls[0] + s.stats.fouls[1];

describe('foul detection', () => {
  const at = { x: MID_X, y: MID_Y };

  it('a slide into the player that misses the ball is a foul: free kick to the fouled team, on the spot', () => {
    // Ball on B's far side (below), A slides down into B from above: the body first, the ball never reached.
    for (const level of ['lenient', 'strict'] as const) {
      const s = run(duel(rules(level), at, { x: at.x, y: at.y - 40 }, Math.PI / 2), 30, slide(0, 1));
      expect(fouls(s)).toBe(1);
      expect(s.stats.fouls[0]).toBe(1);
      expect(s.restart?.type).toBe('free-kick');
      expect(s.restart?.team).toBe(1);
      expect(Math.hypot(s.restart!.pos.x - at.x, s.restart!.pos.y - at.y)).toBeLessThan(25);
      expect(s.events.some((e) => e.type === 'foul' && e.player === A)).toBe(true);
    }
  });

  it('a slide that gets the ball first (from the front) is fair', () => {
    // Ball in front of B (to the right); A comes from further right, straight at the ball.
    for (const level of ['lenient', 'strict'] as const) {
      const s = run(duel(rules(level), at, { x: at.x + 70, y: at.y }, 0, 0), 30, slide(-1, 0));
      expect(fouls(s)).toBe(0);
      expect(s.restart).toBeNull();
    }
  });

  it('a slide into the carrier from behind is a foul', () => {
    // B faces right with the ball in front; A slides in from behind (the left), through B to the ball.
    for (const level of ['lenient', 'strict'] as const) {
      const s = run(duel(rules(level), at, { x: at.x - 40, y: at.y }, 0, 0), 30, slide(1, 0));
      expect(fouls(s)).toBe(1);
      expect(s.restart?.type).toBe('free-kick');
    }
  });

  it('Lenient lets a ball-winning slide from behind go; Strict calls it', () => {
    // The moment A, sliding hard and having already played the ball, runs into B from behind.
    const call = (level: FoulStrictness) => {
      const s = duel(rules(level), at, { x: at.x - 28.5, y: at.y }, 0, 0);
      const a = s.players[A];
      a.tackleTimer = 0.2;
      a.vel = { x: 450, y: 0 };
      a.slideBall = true;
      return detectFoul(s);
    };
    expect(call('lenient')).toBeNull();
    expect(call('strict')).toEqual(expect.objectContaining({ offender: A, victim: B, reckless: true }));
    expect(call('off')).toBeNull();
  });

  it('fouls Off keeps the old behaviour: nothing is called', () => {
    const s = run(duel(rules('off'), at, { x: at.x, y: at.y - 40 }, Math.PI / 2), 30, slide(0, 1));
    expect(fouls(s)).toBe(0);
    expect(s.restart).toBeNull();
    expect(s.events.some((e) => e.type === 'foul')).toBe(false);
  });

  it('a standing challenge is a foul only when clearly late', () => {
    // B has just passed (0.3 s ago, the ball long gone); A runs into it at sprint speed, or at a walk.
    const late = (speed: number, level: FoulStrictness): GameState => {
      const s = duel(rules(level), at, { x: at.x - 29, y: at.y });
      s.possession = null;
      s.ball.pos = { x: at.x + 300, y: at.y };
      s.ball.vel = { x: 300, y: 0 };
      s.players[B].kickAge = 0.3;
      s.players[B].vel = { x: -120, y: 0 };
      s.players[A].vel = { x: speed, y: 0 };
      return run(s, 1, () => ({ ...NEUTRAL_INPUT, moveX: 1, sprint: true }));
    };
    expect(fouls(late(330, 'strict'))).toBe(1);
    expect(fouls(late(120, 'strict'))).toBe(0);
    expect(fouls(late(120, 'lenient'))).toBe(0);
  });
});

describe('free kicks', () => {
  it('near goal, a wall of AI defenders forms on the line to goal, at the wall distance; the rest are kept back', () => {
    // Team 1 attacks left: B is fouled 260 px out from team 0's goal, so the wall is 2 of team 0's AI players.
    const at = { x: PITCH_LEFT + 260, y: MID_Y - 60 };
    let s = run(duel(rules('lenient'), at, { x: at.x, y: at.y - 40 }, Math.PI / 2), 30, slide(0, 1));
    const r = s.restart!;
    expect(r.type).toBe('free-kick');
    expect(r.wall).toHaveLength(2);
    const goal = { x: PITCH_LEFT, y: MID_Y };
    const toGoal = Math.atan2(goal.y - r.pos.y, goal.x - r.pos.x);
    for (const id of r.wall!) {
      const p = s.players[id];
      expect(p.team).toBe(0);
      expect(id).not.toBe(s.controlled[0]); // never the human
      const d = Math.hypot(p.pos.x - r.pos.x, p.pos.y - r.pos.y);
      expect(d).toBeGreaterThanOrEqual(WALL_DISTANCE - 0.5);
      expect(d).toBeLessThan(WALL_DISTANCE + 20);
      const off = Math.atan2(p.pos.y - r.pos.y, p.pos.x - r.pos.x) - toGoal;
      expect(Math.abs(Math.atan2(Math.sin(off), Math.cos(off)))).toBeLessThan(0.25);
    }
    // While it waits, the AI wall holds and no defender comes within the clear radius.
    const wallAt = r.wall!.map((id) => ({ ...s.players[id].pos }));
    s = run(s, 20, () => ({ ...NEUTRAL_INPUT, moveX: 1 })); // (A, team 0's human, tries to walk in)
    expect(s.restart?.type).toBe('free-kick');
    r.wall!.forEach((id, i) => expect(Math.hypot(s.players[id].pos.x - wallAt[i].x, s.players[id].pos.y - wallAt[i].y)).toBeLessThan(4));
    for (const p of s.players) if (p.team === 0) expect(Math.hypot(p.pos.x - r.pos.x, p.pos.y - r.pos.y)).toBeGreaterThanOrEqual(FREE_KICK_CLEAR_RADIUS);
  });

  it('far from goal there is no wall; the taker plays it like a set piece (the ball stays put until struck)', () => {
    const at = { x: MID_X + 100, y: MID_Y };
    let s = run(duel(rules('lenient'), at, { x: at.x, y: at.y - 40 }, Math.PI / 2), 30, slide(0, 1));
    const r = s.restart!;
    expect(r.type).toBe('free-kick');
    expect(r.wall).toEqual([]);
    expect(r.taker).toBe(s.controlled[1]);
    const spot = { ...s.ball.pos };
    s = run(s, 10, undefined, () => ({ ...NEUTRAL_INPUT, moveX: -1 })); // walking into it doesn't move it
    expect(s.ball.pos).toEqual(spot);
    s = run(s, 2, undefined, (i) => ({ ...NEUTRAL_INPUT, moveX: -1, pass: i === 0 }));
    expect(s.restart).toBeNull();
    expect(s.ball.vel.x).toBeLessThan(-300);
  });
});

/** A penalty to team 1 (B fouled in team 0's box), both teams human: team 0's control goes to its keeper. */
function penaltyState(): GameState {
  const at = { x: PITCH_LEFT + 80, y: MID_Y - 30 };
  return run(duel(rules('lenient'), at, { x: at.x, y: at.y - 40 }, Math.PI / 2), 30, slide(0, 1));
}

describe('penalties', () => {
  it('a foul in the box is a penalty: taker on the spot, keeper on its line (human-controlled), everyone else outside the box', () => {
    const s = penaltyState();
    const r = s.restart!;
    expect(r.type).toBe('penalty');
    expect(r.team).toBe(1);
    expect(r.pos).toEqual(penaltySpot(PITCH_LEFT));
    expect(r.taker).toBe(B);
    const keeper = s.players[0];
    expect(s.controlled[0]).toBe(keeper.id);
    expect(keeper.pos.x).toBeCloseTo(PITCH_LEFT + KEEPER_LINE_OFFSET, 0);
    for (const p of s.players) if (p.id !== r.taker && p.role !== 'keeper') expect(inPenaltyBox(p.pos, PITCH_LEFT)).toBe(false);
  });

  it('aims left / centre / right from the move keys across the goal', () => {
    const r = { pos: penaltySpot(PITCH_RIGHT) };
    const y = (moveX: number, moveY: number): number => {
      const a = penaltyAim(r, { moveX, moveY }, 0, 180);
      return r.pos.y + Math.tan(a) * (PITCH_RIGHT - r.pos.x);
    };
    expect(y(0, -1)).toBeLessThan(MID_Y - 50);
    expect(y(1, -1)).toBeLessThan(MID_Y - 50); // a diagonal is the same corner
    expect(y(1, 0)).toBeCloseTo(MID_Y, 5);
    expect(y(0, 1)).toBeGreaterThan(MID_Y + 50);
    expect(Math.abs(y(0, 1) - MID_Y)).toBeLessThan(90); // inside the post
  });

  /** Team 1's taker shoots (power, charged) to one side; team 0's human keeper dives `dive` (+1 down / -1 up) as it is struck. */
  function takePenalty(side: number, dive: number): GameState {
    let s = penaltyState();
    const charge = 20;
    s = run(
      s,
      200,
      (i) => ({ ...NEUTRAL_INPUT, seq: i, moveY: i === charge ? dive : 0, tackle: i === charge }),
      (i) => ({ ...NEUTRAL_INPUT, seq: i, moveX: -0.3, moveY: side * 0.3, shoot: i < charge }),
    );
    return s;
  }

  it('struck one way with the keeper diving the other: a goal, recorded as a scored penalty', () => {
    const s = takePenalty(-1, 1);
    expect(s.score).toEqual([0, 1]);
    const res = s.events.find((e) => e.type === 'penalty-result');
    expect(res?.scored).toBe(true);
    expect(s.stats.penalties).toEqual([expect.objectContaining({ team: 1, player: B, scored: true })]);
  });

  it('with the keeper diving the right way: saved, and the human gets an outfield player back', () => {
    const s = takePenalty(-1, -1);
    expect(s.score).toEqual([0, 0]);
    const res = s.events.find((e) => e.type === 'penalty-result');
    expect(res?.scored).toBe(false);
    expect(res?.saved).toBe(true);
    expect(s.stats.penalties[0]?.scored).toBe(false);
    expect(s.players[s.controlled[0]].role).toBe('outfield');
  });

  it('the keeper stays on its line until it dives or the kick is taken', () => {
    let s = penaltyState();
    const before = { ...s.players[0].pos };
    s = run(s, 20, () => ({ ...NEUTRAL_INPUT, moveX: 1, moveY: 1 })); // walking out: ignored
    expect(s.players[0].pos.x).toBeCloseTo(before.x, 3);
    expect(s.players[0].pos.y).toBeCloseTo(before.y, 3);
  });

  it('the AI takes a penalty it is given', () => {
    let s = penaltyState();
    s.controlled = [-1, -1]; // both teams AI from here on
    for (let i = 0; i < 400 && (s.restart || s.penalty); i++) s = step(s, [undefined, undefined], SIM_DT);
    expect(s.restart?.type === 'penalty').toBe(false);
    expect(s.events.some((e) => e.type === 'penalty-result')).toBe(true);
  });
});

describe('cards', () => {
  /** A slides into B from behind (a reckless foul); the free kick is then cleared away for the next one. */
  function recklessFoul(s: GameState): GameState {
    const at = { x: MID_X, y: MID_Y };
    s.restart = null;
    s.grace = null;
    s.players[B].pos = { ...at };
    s.players[B].facing = 0;
    s.players[B].vel = { x: 0, y: 0 };
    s.players[A].pos = { x: at.x - 40, y: at.y };
    s.players[A].tackleCooldown = 0;
    s.controlled = [A, B];
    s.possession = { player: B, angle: 0, roll: 0 };
    s.ball.pos = { x: at.x + 24.5, y: at.y };
    s.ball.vel = { x: 0, y: 0 };
    return run(s, 30, slide(1, 0));
  }

  it('with cards on, a reckless slide is a yellow; a second is a red: sent off for the rest of the half, back for the next', () => {
    let s = createInitialState({ humans: [true, true], rules: rules('strict', true) });
    s = recklessFoul(s);
    expect(s.players[A].yellow).toBe(1);
    expect(s.stats.cards).toEqual([expect.objectContaining({ team: 0, player: A, card: 'yellow' })]);
    expect(s.events.some((e) => e.type === 'yellow-card' && e.player === A)).toBe(true);
    s = recklessFoul(s);
    expect(s.players[A].sentOff).toBe(true);
    expect(s.players[A].pos).toEqual(SENT_OFF_POS);
    expect(s.stats.cards.map((c) => c.card)).toEqual(['yellow', 'red']);
    expect(s.controlled[0]).not.toBe(A); // the human moves to a teammate
    // Off the pitch it takes no part: still there after more play, never on the ball.
    s.restart = null;
    s = run(s, 60);
    expect(s.players[A].pos).toEqual(SENT_OFF_POS);
    // Half-time: back on in formation, the yellow wiped.
    s.phase = 'half-time';
    s.phaseTimer = 0.001;
    s = run(s, 1);
    expect(s.half).toBe(2);
    expect(s.players[A].sentOff).toBe(false);
    expect(s.players[A].yellow).toBe(0);
    expect(s.players[A].pos.x).toBeGreaterThan(PITCH_LEFT);
  });

  it('with cards off (Lenient, Arcade) a reckless foul is still a foul, but no card', () => {
    let s = createInitialState({ humans: [true, true], rules: rules('lenient', false) });
    s = recklessFoul(s);
    expect(s.stats.fouls[0]).toBe(1);
    expect(s.stats.cards).toEqual([]);
    expect(s.players[A].yellow).toBe(0);
  });
});

describe('penalty shoot-out', () => {
  const so = (first: 0 | 1, kicks: boolean[]) => ({ first, kicks });

  it('best of five: over as soon as one team cannot catch up', () => {
    expect(shootoutWinner(so(0, [true, false, true, false, true, false]))).toBe(0); // 3-0 after three each
    expect(shootoutWinner(so(0, [true, false, true, false, true]))).toBeNull(); // 3-0, but team 1 has three left
    expect(shootoutWinner(so(1, [true, true, true, true, false, false]))).toBeNull(); // 2-2 after three each
    expect(shootoutWinner(so(0, [true, true, true, true, true, true, true, true, true, false]))).toBe(0); // 5-4
  });

  it('level after five each: sudden death, decided only after a pair of kicks', () => {
    const five = Array.from({ length: 10 }, () => true);
    expect(shootoutWinner(so(0, five))).toBeNull();
    expect(shootoutWinner(so(0, [...five, false]))).toBeNull(); // team 0 misses its sixth: team 1 still to kick
    expect(shootoutWinner(so(0, [...five, false, true]))).toBe(1);
    expect(shootoutWinner(so(0, [...five, true, true]))).toBeNull();
    expect(shootoutWinner(so(1, [...five, true, false]))).toBe(1); // team 1 went first and scored, team 0 missed
    expect(shootoutTally(so(1, [...five, true, false]))).toEqual({ goals: [5, 6], taken: [6, 6] });
  });

  it('a drawn match goes to a shoot-out: kicks alternate at one goal, the score stands, and a winner is named', () => {
    let s = createMatchState({ aiVsAi: true, seed: 5, halfLength: 2, rules: rulesFor('arcade') });
    let sawShootout = false;
    for (let i = 0; i < 60 * 600 && s.phase !== 'full-time'; i++) {
      s = step(s, [undefined, undefined], SIM_DT);
      if (s.phase === 'shootout') sawShootout = true;
    }
    expect(s.score).toEqual([0, 0]);
    expect(sawShootout).toBe(true);
    expect(s.phase).toBe('full-time');
    const rec = s.stats.shootout!;
    expect(rec).not.toBeNull();
    expect(rec.winner).toBe(shootoutWinner(rec));
    expect(rec.kicks.length).toBeGreaterThanOrEqual(6);
    const results = s.events.filter((e) => e.type === 'penalty-result');
    results.forEach((e, i) => i > 0 && expect(e.team).not.toBe(results[i - 1].team));
  });

  it('draws Off: a draw stays a draw', () => {
    let s = createMatchState({ aiVsAi: true, seed: 5, halfLength: 2, rules: { ...rulesFor('arcade'), draws: 'off' } });
    for (let i = 0; i < 60 * 30 && s.phase !== 'full-time'; i++) s = step(s, [undefined, undefined], SIM_DT);
    expect(s.phase).toBe('full-time');
    expect(s.shootout).toBeNull();
  });

  it('golden goal: a draw gets extra time, and the first goal in it ends the match', () => {
    let s = createMatchState({ aiVsAi: true, seed: 5, halfLength: 2, rules: { ...rulesFor('arcade'), draws: 'golden-goal' } });
    for (let i = 0; i < 60 * 30 && !(s.half > HALVES && s.phase === 'playing'); i++) s = step(s, [undefined, undefined], SIM_DT);
    expect(s.half).toBe(HALVES + 1);
    expect(s.events.some((e) => e.type === 'extra-time')).toBe(true);
    // Put the ball in the net (team 0 defends the right goal in extra time: ends swapped twice).
    s.restart = null;
    s.possession = null;
    s.ball.pos = { x: PITCH_RIGHT + 30, y: MID_Y };
    s.ball.vel = { x: 0, y: 0 };
    for (let i = 0; i < 60 * 5 && s.phase !== 'full-time'; i++) s = step(s, [undefined, undefined], SIM_DT);
    expect(s.phase).toBe('full-time');
    expect(s.score[0] + s.score[1]).toBe(1);
    expect(s.shootout).toBeNull();
  });
});

describe('network', () => {
  it('snapshots carry the shoot-out and the cards (protocol 7)', () => {
    const s = createInitialState();
    s.phase = 'shootout';
    s.shootout = { first: 1, kicks: [true, false, true], winner: -1, pause: 0 };
    s.players[3].yellow = 1;
    s.players[7].sentOff = true;
    s.restart = { type: 'penalty', team: 1, pos: penaltySpot(PITCH_RIGHT), taker: 7, timer: 2 };
    const back = decodeSnapshot(encodeSnapshot(takeSnapshot(s, { ack: 3, paused: false, resumeIn: 0 })))!;
    expect(back.phase).toBe('shootout');
    expect(back.restart).toEqual({ type: 'penalty', team: 1 });
    expect(back.shootout).toEqual({ first: 1, kicks: [true, false, true], winner: -1 });
    expect(back.players[3].yellow).toBe(1);
    expect(back.players[7].sentOff).toBe(true);
    expect(back.players[2].sentOff).toBe(false);
    // A decided shoot-out, and a long sudden death keeps whole pairs.
    s.shootout = { first: 0, kicks: Array.from({ length: 70 }, (_, i) => i % 3 === 0), winner: 1, pause: 0 };
    const long = decodeSnapshot(encodeSnapshot(takeSnapshot(s, { ack: 3, paused: false, resumeIn: 0 })))!;
    expect(long.shootout!.winner).toBe(1);
    expect(long.shootout!.kicks).toEqual(s.shootout.kicks.slice(6));
  });

  it('the penalty box helper', () => {
    expect(inPenaltyBox({ x: PITCH_LEFT + PENALTY_BOX_WIDTH - 1, y: MID_Y }, PITCH_LEFT)).toBe(true);
    expect(inPenaltyBox({ x: PITCH_LEFT + PENALTY_BOX_WIDTH + 1, y: MID_Y }, PITCH_LEFT)).toBe(false);
  });
});

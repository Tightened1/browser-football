// T16: corners. A defender's touch over their own goal line (outside the posts) is a corner, whatever the touch was
// and in either half; the ball going out by the corner flag is called on the right line; corners are taken like throw-ins.
import { describe, expect, it } from 'vitest';
import {
  BALL_RADIUS,
  CORNER_HARD_MAX_SPEED,
  CORNER_LOW_SPEED,
  KEEPER_RADIUS,
  KICK_REACH,
  PENALTY_BOX_HEIGHT,
  PENALTY_BOX_WIDTH,
  PITCH_BOTTOM,
  PITCH_HEIGHT,
  PITCH_LEFT,
  PITCH_RIGHT,
  PITCH_TOP,
  PLAYER_RADIUS,
  SHOT_MAX_CHARGE_TIME,
  SIM_DT,
} from '../src/config';
import { lastTouchText } from '../src/matchStats';
import { applySnapshot, decodeSnapshot, encodeSnapshot, takeSnapshot } from '../src/net/snapshot';
import { createAiState } from '../src/sim/ai';
import { updateTouches } from '../src/sim/control';
import { updatePossession } from '../src/sim/dribble';
import { rulesFor } from '../src/sim/matchRules';
import { restartAim } from '../src/sim/setpiece';
import { cloneState, createInitialState, createMatchState, createPlayer, NEUTRAL_INPUT, step } from '../src/sim/simulation';
import type { GameState, InputFrame, PlayerRole, RulesPreset, TeamId } from '../src/sim/types';

const midY = PITCH_TOP + PITCH_HEIGHT / 2;
const CONTACT = PLAYER_RADIUS + BALL_RADIUS;
const input = (o: Partial<InputFrame> = {}): InputFrame => ({ ...NEUTRAL_INPUT, ...o });
const idle = (): InputFrame => input();

interface Spec {
  team: TeamId;
  role?: PlayerRole;
  /** Distance in front of team 1's goal line (into the pitch), and y. */
  d: number;
  y: number;
}

/**
 * A bare pitch in `half` with a few players, each team's first player human-controlled (so nobody moves unless told
 * to). Team 1 defends `goal.x`; `goal.inward` points from that goal line into the pitch.
 */
function scene(half: 1 | 2, specs: Spec[], preset: RulesPreset = 'arcade'): { s: GameState; goal: { x: number; inward: number } } {
  const s = createInitialState({ humans: [true, true], rules: rulesFor(preset) });
  if (half === 2) {
    s.half = 2;
    s.attackDir = [-1, 1];
  }
  const inward = s.attackDir[1]; // team 1 attacks away from its own goal
  const goalX = inward > 0 ? PITCH_LEFT : PITCH_RIGHT;
  s.players = specs.map((o, i) => createPlayer(i, o.team, goalX + inward * o.d, o.y, o.role ?? 'outfield', o.role === 'keeper' ? 0 : 1 + i));
  for (const p of s.players) p.facing = s.attackDir[p.team] > 0 ? 0 : Math.PI;
  s.controlled = [0, 1].map((t) => s.players.find((p) => p.team === t)?.id ?? -1) as [number, number];
  s.ai = createAiState(s.players, s.controlled);
  s.ball.vel = { x: 0, y: 0 };
  s.lastTouch = null;
  return { s, goal: { x: goalX, inward } };
}

/** Steps until a restart, a goal or `max` ticks, with each team's human input from `f`. */
function untilRestart(s: GameState, f: (n: number) => [InputFrame, InputFrame] = () => [idle(), idle()], max = 180): GameState {
  for (let i = 0; i < max && !s.restart && s.phase === 'playing'; i++) s = step(s, f(i), SIM_DT);
  return s;
}

const HALVES = [1, 2] as const;
/** Clearly outside the posts of either goal width (big goals are 180 wide). */
const WIDE_Y = midY - 150;

describe.each(HALVES)('a defender puts it over their own goal line: corner for the attackers (half %i)', (half) => {
  it('a kick', () => {
    const { s: s0, goal } = scene(half, [
      { team: 0, d: 400, y: midY },
      { team: 1, d: 60, y: WIDE_Y },
    ]);
    // The defender has the ball at its feet, facing its own goal line.
    s0.ball.pos = { x: s0.players[1].pos.x - goal.inward * (CONTACT + 2), y: WIDE_Y };
    let s = step(s0, [idle(), input({ moveX: -goal.inward })], SIM_DT);
    expect(s.possession?.player).toBe(1);
    s = untilRestart(s, (n) => [idle(), input({ moveX: -goal.inward, moveY: -0.2, pass: n === 0 })]);
    expect(s.restart).toMatchObject({ type: 'corner', team: 0 });
  });

  it('a deflection off a defender’s body', () => {
    const { s, goal } = scene(half, [
      { team: 0, d: 500, y: midY },
      { team: 1, d: 50, y: WIDE_Y },
    ]);
    // An attacker's shot clips the defender and runs on behind.
    s.lastTouch = { team: 0, player: 0 };
    s.ball.pos = { x: goal.x + goal.inward * 250, y: WIDE_Y + 16 };
    s.ball.vel = { x: -goal.inward * 800, y: 0 };
    const out = untilRestart(s);
    expect(out.restart).toMatchObject({ type: 'corner', team: 0 });
  });

  it('a slide tackle', () => {
    const { s, goal } = scene(half, [
      { team: 0, d: 400, y: midY },
      { team: 1, d: 70, y: WIDE_Y },
    ]);
    s.lastTouch = { team: 0, player: 0 };
    // Loose, just beyond kicking reach: the defender slides in and knocks it behind.
    s.ball.pos = { x: goal.x + goal.inward * (70 - (CONTACT + KICK_REACH + 1)), y: WIDE_Y };
    const out = untilRestart(s, (n) => [idle(), input({ moveX: -goal.inward, tackle: n === 0 })]);
    expect(out.restart).toMatchObject({ type: 'corner', team: 0 });
  });

  it('an attacker merely standing next to the ball does not "touch" it', () => {
    const { s, goal } = scene(half, [
      // 4.8 px from the ball: within kicking reach, too far to control it, not touching.
      { team: 0, d: PLAYER_RADIUS + 1, y: WIDE_Y - 22 },
      { team: 1, d: 300, y: midY },
    ]);
    // The defender's clearance has stopped with its centre just over the line, within the attacker's reach but not
    // touching them.
    s.lastTouch = { team: 1, player: 1 };
    s.ball.pos = { x: goal.x - goal.inward * 2, y: WIDE_Y };
    s.ball.vel = { x: 0, y: 0 };
    const out = untilRestart(s);
    expect(out.restart).toMatchObject({ type: 'corner', team: 0 });
  });

  it('a defender body-checks the carrier and knocks it behind', () => {
    const { s: s0, goal } = scene(half, [
      { team: 0, d: 30, y: WIDE_Y - 60 },
      { team: 1, d: 30, y: WIDE_Y - 60 + 2 * CONTACT + 2 },
    ]);
    // The attacker runs along the goal line with the ball on the line side of its body; the defender stands in its path.
    const c = s0.players[0];
    const angle = Math.atan2(1, -goal.inward * 0.8);
    s0.possession = { player: 0, angle, roll: 0 };
    s0.lastTouch = { team: 0, player: 0 };
    s0.ball.pos = { x: c.pos.x + Math.cos(angle) * (CONTACT + 1), y: c.pos.y + Math.sin(angle) * (CONTACT + 1) };
    // Defender: just inside the line, touching the ball from the pitch side.
    const o = s0.players[1];
    o.pos = { x: s0.ball.pos.x + goal.inward * 6, y: s0.ball.pos.y + CONTACT + 1 };
    // The knock itself is credited to the defender (who may then control it)...
    const knocked = cloneState(s0);
    updatePossession(knocked);
    expect(knocked.possession?.player ?? -1).not.toBe(0);
    expect(knocked.lastTouch).toEqual({ team: 1, player: 1 });
    // ...and if they can't (still recovering from a stab at it), it runs out behind off them: a corner.
    o.touchTimer = 0.3;

    const out = untilRestart(s0, () => [input({ moveY: 1 }), idle()]);
    expect(out.restart).toMatchObject({ type: 'corner', team: 0 });
  });

  it('a keeper parries a shot wide', () => {
    const { s, goal } = scene(half, [
      { team: 0, d: 400, y: midY },
      { team: 1, role: 'keeper', d: 25, y: midY - 70 },
    ]);
    // A hard shot at the keeper's outside shoulder, from wide (too fast to catch).
    const k = s.players[1];
    s.lastTouch = { team: 0, player: 0 };
    s.ball.pos = { x: goal.x + goal.inward * 260, y: k.pos.y - 75 };
    const aim = Math.atan2(k.pos.y - KEEPER_RADIUS * 1.2 - s.ball.pos.y, k.pos.x - s.ball.pos.x);
    s.ball.vel = { x: Math.cos(aim) * 1000, y: Math.sin(aim) * 1000 };
    let touched = false;
    let out = s;
    for (let i = 0; i < 180 && !out.restart && out.phase === 'playing'; i++) {
      out = step(out, [idle(), idle()], SIM_DT);
      if (out.lastTouch?.player === 1) touched = true;
    }
    expect(touched).toBe(true);
    expect(out.restart).toMatchObject({ type: 'corner', team: 0 });
  });

  it('a diving keeper turns it round the post', () => {
    const { s, goal } = scene(half, [
      { team: 0, d: 400, y: midY },
      { team: 1, role: 'keeper', d: 25, y: midY + 15 },
    ]);
    s.lastTouch = { team: 0, player: 0 };
    // Heading just outside the post; the keeper dives from the middle of its goal and turns it round.
    s.ball.pos = { x: goal.x + goal.inward * 230, y: midY - 60 };
    const target = { x: goal.x, y: midY - 105 };
    const aim = Math.atan2(target.y - s.ball.pos.y, target.x - s.ball.pos.x);
    s.ball.vel = { x: Math.cos(aim) * 950, y: Math.sin(aim) * 950 };
    const out = untilRestart(s, (n) => [idle(), input({ moveY: -1, tackle: n === 0 })]);
    expect(out.restart).toMatchObject({ type: 'corner', team: 0 });
  });

  it('still a goal kick when an attacker put it there', () => {
    const { s, goal } = scene(half, [
      { team: 0, d: 400, y: midY },
      { team: 1, d: 300, y: midY },
    ]);
    s.lastTouch = { team: 0, player: 0 };
    s.ball.pos = { x: goal.x + goal.inward * 40, y: WIDE_Y };
    s.ball.vel = { x: -goal.inward * 400, y: 0 };
    expect(untilRestart(s).restart).toMatchObject({ type: 'goal-kick', team: 1 });
  });
});

describe('out by the corner flag', () => {
  /** Ball near a corner of team 1's goal line, moving out at (vAlong, vOut): along = towards the goal line, out = over the touchline. */
  function nearFlag(half: 1 | 2, last: TeamId, pos: { d: number; out: number }, vel: { toLine: number; out: number }): GameState {
    const { s, goal } = scene(half, [
      { team: 0, d: 500, y: midY },
      { team: 1, d: 500, y: midY + 100 },
    ]);
    s.lastTouch = { team: last, player: last };
    s.ball.pos = { x: goal.x + goal.inward * pos.d, y: PITCH_TOP - pos.out };
    s.ball.vel = { x: -goal.inward * vel.toLine, y: -vel.out };
    return untilRestart(s);
  }

  for (const half of HALVES) {
    it(`a ball heading over the end line, straddling the touchline, is a corner or goal kick, not a throw-in (half ${half})`, () => {
      expect(nearFlag(half, 1, { d: 2, out: 8 }, { toLine: 400, out: 100 }).restart).toMatchObject({ type: 'corner', team: 0 });
      expect(nearFlag(half, 0, { d: 2, out: 8 }, { toLine: 400, out: 100 }).restart).toMatchObject({ type: 'goal-kick', team: 1 });
      expect(nearFlag(half, 1, { d: 10, out: 5 }, { toLine: 400, out: 100 }).restart).toMatchObject({ type: 'corner', team: 0 });
      expect(nearFlag(half, 1, { d: 4, out: -3 }, { toLine: 500, out: 60 }).restart).toMatchObject({ type: 'corner', team: 0 });
    });

    it(`a ball heading over the touchline by the flag is still a throw-in (half ${half})`, () => {
      expect(nearFlag(half, 1, { d: 5, out: -3 }, { toLine: 60, out: 400 }).restart).toMatchObject({ type: 'throw-in', team: 0 });
    });
  }

  it('the bottom corners too', () => {
    const { s, goal } = scene(1, [
      { team: 0, d: 500, y: midY },
      { team: 1, d: 500, y: midY + 100 },
    ]);
    s.lastTouch = { team: 1, player: 1 };
    s.ball.pos = { x: goal.x + goal.inward * 10, y: PITCH_BOTTOM + 5 };
    s.ball.vel = { x: -goal.inward * 400, y: 100 };
    expect(untilRestart(s).restart).toMatchObject({ type: 'corner', team: 0 });
  });
});

describe('last touch', () => {
  it('a ball within reach of a player but not touching them is not theirs, moving or not', () => {
    const { s } = scene(1, [
      { team: 0, d: 400, y: midY },
      { team: 1, d: 300, y: midY },
    ]);
    s.lastTouch = { team: 0, player: 0 };
    s.ball.pos = { x: s.players[1].pos.x, y: midY + CONTACT + KICK_REACH - 1 };
    s.ball.vel = { x: 0, y: 0 };
    updateTouches(s);
    expect(s.lastTouch).toEqual({ team: 0, player: 0 });
  });
});

/** A corner for team 0 at the top of team 1's goal line, with full AI teams (team 0's human idle unless `human`). */
function cornerForHome(half: 1 | 2, human: boolean): GameState {
  let s = createInitialState({ humans: [human, false], rules: rulesFor('arcade'), seed: 3 });
  if (half === 2) {
    s.half = 2;
    s.attackDir = [-1, 1];
  }
  const goalX = s.attackDir[1] > 0 ? PITCH_LEFT : PITCH_RIGHT;
  s.lastTouch = { team: 1, player: 6 };
  s.ball.pos = { x: goalX - s.attackDir[1] * (BALL_RADIUS + 3), y: midY - 200 };
  s = step(s, [human ? idle() : undefined, undefined], SIM_DT);
  expect(s.restart).toMatchObject({ type: 'corner', team: 0 });
  return s;
}

describe('taking a corner', () => {
  it('the human taker stands still with the ball and aims it with the arrow, like a throw-in', () => {
    let s = cornerForHome(1, true);
    const r = s.restart!;
    expect(s.controlled[0]).toBe(r.taker);
    const at = { ...s.players[r.taker].pos };
    s = step(s, [input({ moveX: -1, moveY: 1 }), undefined], SIM_DT);
    s = step(s, [input({ moveX: -1, moveY: 1 }), undefined], SIM_DT);
    expect(s.possession).toBeNull();
    expect(s.ball.pos).toEqual(r.pos);
    expect(s.players[r.taker].pos).toEqual(at);
    expect(s.players[r.taker].facing).toBeCloseTo(restartAim(r, { moveX: -1, moveY: 1 }, 0), 6);
  });

  it('pass is a low cross, a charged shoot a harder one, both going where the arrow points', () => {
    const aimKeys = { moveX: -1, moveY: 1 };
    let low = cornerForHome(1, true);
    const r = low.restart!;
    low = step(low, [input({ ...aimKeys, pass: true }), undefined], SIM_DT);
    expect(low.restart).toBeNull();
    expect(Math.abs(Math.hypot(low.ball.vel.x, low.ball.vel.y) - CORNER_LOW_SPEED)).toBeLessThan(CORNER_LOW_SPEED * 0.03);
    expect(Math.atan2(low.ball.vel.y, low.ball.vel.x)).toBeCloseTo(restartAim(r, aimKeys, 0), 2);
    expect(low.lastTouch).toEqual({ team: 0, player: r.taker });

    let hard = cornerForHome(1, true);
    for (let i = 0; i < Math.ceil(SHOT_MAX_CHARGE_TIME / SIM_DT) + 2; i++) hard = step(hard, [input({ ...aimKeys, shoot: true }), undefined], SIM_DT);
    expect(hard.restart).not.toBeNull();
    hard = step(hard, [input(aimKeys), undefined], SIM_DT);
    expect(hard.restart).toBeNull();
    const v = Math.hypot(hard.ball.vel.x, hard.ball.vel.y);
    expect(v).toBeGreaterThan(CORNER_LOW_SPEED * 1.4);
    expect(v).toBeLessThanOrEqual(CORNER_HARD_MAX_SPEED + 1);
  });

  for (const half of HALVES) {
    it(`the AI attackers go into the box and the AI taker crosses it in (half ${half})`, () => {
      let s = cornerForHome(half, false);
      const goalX = s.attackDir[0] > 0 ? PITCH_RIGHT : PITCH_LEFT;
      const inBox = (g: GameState): number =>
        g.players.filter(
          (p) => p.team === 0 && p.role !== 'keeper' && Math.abs(p.pos.x - goalX) < PENALTY_BOX_WIDTH && Math.abs(p.pos.y - midY) < PENALTY_BOX_HEIGHT / 2,
        ).length;
      let most = 0;
      let crossed = false;
      for (let i = 0; i < 6 / SIM_DT && s.phase === 'playing'; i++) {
        const taken = !!s.restart;
        s = step(s, [undefined, undefined], SIM_DT);
        if (s.restart) most = Math.max(most, inBox(s));
        if (taken && !s.restart && !crossed) {
          crossed = true;
          // Played into the box: heading towards the goal mouth area.
          const b = s.ball;
          const t = (goalX - (goalX > PITCH_LEFT ? 1 : -1) * 90 - b.pos.x) / b.vel.x;
          expect(t).toBeGreaterThan(0);
          expect(Math.abs(b.pos.y + b.vel.y * t - midY)).toBeLessThan(PENALTY_BOX_HEIGHT / 2);
        }
      }
      expect(most).toBeGreaterThanOrEqual(2);
      expect(crossed).toBe(true);
    });
  }
});

describe('online: the guest sees the corner', () => {
  it('a corner survives the snapshot round trip, with the human taker known', () => {
    const s = cornerForHome(2, true);
    const snap = decodeSnapshot(encodeSnapshot(takeSnapshot(s, { ack: 0, paused: false, resumeIn: 0 })))!;
    expect(snap.restart).toEqual({ type: 'corner', team: 0 });
    const guest = createMatchState({ humans: [true, true] });
    applySnapshot(guest, snap);
    expect(guest.restart).toMatchObject({ type: 'corner', team: 0, taker: s.restart!.taker });
  });
});

describe('debug overlay', () => {
  it('names the last toucher and the pending restart', () => {
    const name = (t: TeamId): string => (t === 0 ? 'Home' : 'Away');
    const s = cornerForHome(1, false);
    const keeper = s.players.find((p) => p.team === 1 && p.role === 'keeper')!;
    s.lastTouch = { team: 1, player: keeper.id };
    expect(lastTouchText(s, name)).toBe(`last touch: Away #${keeper.number} (GK)   restart: corner to Home`);
    s.lastTouch = null;
    s.restart = null;
    expect(lastTouchText(s, name)).toBe('last touch: nobody');
  });
});

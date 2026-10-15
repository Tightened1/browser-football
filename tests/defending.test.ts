// T17: fairer AI defending (telegraphed slides, a separate tackle profile against a human carrier, standing tackles that
// can fail) and the human's tools to beat a defender (sprint and stamina, shield, feint), over the network too.
import { describe, expect, it } from 'vitest';
import {
  AI_DEFENDING_VS_HUMAN,
  AI_PROFILES,
  BALL_RADIUS,
  FEINT_DOUBLE_TAP_MS,
  FEINT_SPEED,
  PITCH_HEIGHT,
  PITCH_TOP,
  PLAYER_MAX_SPEED,
  PLAYER_RADIUS,
  SIM_DT,
  SPRINT_DRAIN,
  SPRINT_RECOVER,
  SPRINT_RESUME,
  SPRINT_SPEED_FACTOR,
  STAND_TACKLE_COOLDOWN,
} from '../src/config';
import { DoubleTap } from '../src/input/keyboard';
import { decodeInputs, decodeSnapshot, encodeInputs, encodeSnapshot, mergeInputs, takeSnapshot } from '../src/net/snapshot';
import { analyse, choosePressers, createAiState, defendingAiProfile } from '../src/sim/ai';
import { updatePossession } from '../src/sim/dribble';
import { rulesFor } from '../src/sim/matchRules';
import { createInitialState, createPlayer, NEUTRAL_INPUT, step, updatePlayer } from '../src/sim/simulation';
import { DEFAULT_BINDINGS, sanitizeSettings } from '../src/settings';
import type { AiDefending, GameState, InputFrame, PlayerState } from '../src/sim/types';

const midY = PITCH_TOP + PITCH_HEIGHT / 2;
const CONTACT = PLAYER_RADIUS + BALL_RADIUS;
const input = (o: Partial<InputFrame> = {}): InputFrame => ({ ...NEUTRAL_INPUT, ...o });

/** Player 0 (home) carrying the ball at (400, midY), facing +x; player 1 (away) at `away`. Both teams have a human. */
function carrierAnd(away: [number, number], defending: AiDefending = 'relaxed', seed = 1): GameState {
  const s0 = createInitialState({ humans: [true, true], rules: rulesFor('arcade', 'rules', defending), seed });
  s0.players = [createPlayer(0, 0, 400, midY), createPlayer(1, 1, away[0], away[1])];
  s0.controlled = [0, 1];
  s0.ai = createAiState(s0.players, s0.controlled, undefined, seed);
  s0.ball.pos = { x: 400 + CONTACT + 2, y: midY };
  const s = step(s0, [input(), input()], SIM_DT);
  expect(s.possession?.player).toBe(0);
  return s;
}

describe('telegraphed tackles (wind-up)', () => {
  it("an AI slide at a human winds up first (the level's windup), committed to its direction; a human's slide starts at once", () => {
    // A human runs at AI defenders on 'tough' and hard until one of them decides to slide in.
    let seen = false;
    for (let seed = 1; seed <= 12 && !seen; seed++) {
      let s = createInitialState({ humans: [true, false], difficulty: ['hard', 'hard'], rules: rulesFor('classic', 'rules', 'tough'), seed });
      s.players = [createPlayer(0, 0, 300, midY), createPlayer(1, 1, 520, midY + 10)];
      s.controlled = [0, -1];
      s.ai = createAiState(s.players, s.controlled, ['hard', 'hard'], seed);
      s.ball.pos = { x: 300 + CONTACT + 2, y: midY };
      for (let i = 0; i < 180 && !seen; i++) {
        const before = s.players[1];
        s = step(s, [input({ moveX: 1 })], SIM_DT);
        const p = s.players[1];
        if (before.windup === 0 && p.windup > 0) {
          seen = true;
          const facing = p.facing;
          expect(p.tackleTimer).toBe(0);
          let ticks = 0;
          while (s.players[1].tackleTimer === 0 && ticks < 60) {
            expect(s.players[1].facing).toBeCloseTo(facing, 9); // committed: no steering during the wind-up
            s = step(s, [input({ moveX: 1 })], SIM_DT);
            ticks++;
          }
          // The slide starts after the wind-up (to within a tick), in the wound-up direction.
          expect(Math.abs(ticks * SIM_DT - AI_DEFENDING_VS_HUMAN.tough.windup)).toBeLessThanOrEqual(SIM_DT + 1e-9);
          expect(s.players[1].facing).toBeCloseTo(facing, 9);
        }
      }
    }
    expect(seen).toBe(true);

    // A human presses tackle: the slide is on straight away.
    let h = carrierAnd([520, midY]);
    h = step(h, [input(), input({ tackle: true, moveX: -1 })], SIM_DT);
    expect(h.players[1].windup).toBe(0);
    expect(h.players[1].tackleTimer).toBeGreaterThan(0);
  });

  it('the wind-up and the other T17 flags reach the guest in snapshots, with stamina', () => {
    const s = carrierAnd([520, midY]);
    s.players[1].windup = 0.1;
    s.players[0].stamina = 0.42;
    s.players[0].sprintLock = true;
    s.players[0].shielding = true;
    s.players[0].feintTimer = 0.1;
    s.players[1].sprinting = true;
    const snap = decodeSnapshot(encodeSnapshot(takeSnapshot(s, { ack: 0, paused: false, resumeIn: 0 })))!;
    expect(snap.players[1].windup).toBe(true);
    expect(snap.players[1].sprinting).toBe(true);
    expect(snap.players[0]).toMatchObject({ shielding: true, feinting: true, sprintLock: true });
    expect(snap.players[0].stamina).toBeCloseTo(0.42, 2);
  });
});

describe('a separate tackle profile against a human carrier', () => {
  it('uses the "AI defending vs humans" profile when the carrier is human, and the normal one against an AI carrier', () => {
    const s = carrierAnd([560, midY], 'relaxed');
    s.ai.difficulty = ['hard', 'hard'];
    const base = AI_PROFILES.hard;
    const vsHuman = defendingAiProfile(s, analyse(s, [true, false]), 1);
    const relaxed = AI_DEFENDING_VS_HUMAN.relaxed;
    expect(vsHuman.tackleChance).toBeCloseTo(base.tackleChance * relaxed.tackleChance, 9);
    expect(vsHuman.reactionTime).toBeCloseTo(base.reactionTime + relaxed.extraReaction, 9);
    expect(vsHuman.pressers).toBe(1);
    // The same carrier driven by the AI: the AI's own profile, unchanged.
    expect(defendingAiProfile(s, analyse(s, [false, false]), 1)).toEqual(base);
  });

  it('presses a human carrier with one player away from goal, but an AI carrier with two', () => {
    const s0 = createInitialState({ humans: [true, false], difficulty: ['hard', 'hard'], rules: rulesFor('classic'), seed: 3 });
    const carrier = s0.players.find((p) => p.team === 0 && p.slot === 3)!;
    carrier.pos = { x: 420, y: midY };
    s0.controlled = [carrier.id, -1];
    s0.ball.pos = { x: 420 + CONTACT + 2, y: midY };
    const s = step(s0, [input()], SIM_DT);
    expect(s.possession?.player).toBe(carrier.id);
    expect(choosePressers(s, analyse(s, [true, false]), 1)).toHaveLength(1);
    expect(choosePressers(s, analyse(s, [false, false]), 1)).toHaveLength(2);
  });

  it('standing tackles on a human carrier win at the level\'s standWin rate and then cool down; on an AI carrier, always', () => {
    const trials = 200;
    const rate = (defending: AiDefending, humanCarrier: boolean): number => {
      let won = 0;
      for (let k = 0; k < trials; k++) {
        const s = carrierAnd([400 + CONTACT * 2 + PLAYER_RADIUS + 4, midY], defending, 100 + k);
        // The AI challenger stands right on the held ball, in front of the carrier.
        s.players[1].pos = { x: s.ball.pos.x + BALL_RADIUS + PLAYER_RADIUS + 2, y: midY };
        updatePossession(s, [humanCarrier, false]);
        if (s.possession?.player !== 0) won++;
        else expect(s.players[1].standCooldown).toBeCloseTo(STAND_TACKLE_COOLDOWN, 9);
      }
      return won / trials;
    };
    expect(rate('relaxed', false)).toBe(1);
    expect(Math.abs(rate('relaxed', true) - AI_DEFENDING_VS_HUMAN.relaxed.standWin)).toBeLessThan(0.1);
    expect(Math.abs(rate('normal', true) - AI_DEFENDING_VS_HUMAN.normal.standWin)).toBeLessThan(0.1);
    expect(rate('relaxed', true)).toBeLessThan(rate('tough', true));
  });
});

describe('sprint and stamina', () => {
  const sprinter = (): PlayerState => createPlayer(0, 0, 300, midY);

  it('sprinting is faster and drains stamina; the bar recovers when not sprinting', () => {
    const p = sprinter();
    for (let i = 0; i < 60; i++) updatePlayer(p, input({ moveX: 1, sprint: true }), SIM_DT);
    expect(p.sprinting).toBe(true);
    expect(Math.hypot(p.vel.x, p.vel.y)).toBeCloseTo(PLAYER_MAX_SPEED * SPRINT_SPEED_FACTOR, 3);
    expect(p.stamina).toBeCloseTo(1 - SPRINT_DRAIN, 6);
    for (let i = 0; i < 60; i++) updatePlayer(p, input({ moveX: 1 }), SIM_DT);
    expect(p.sprinting).toBe(false);
    expect(Math.hypot(p.vel.x, p.vel.y)).toBeCloseTo(PLAYER_MAX_SPEED, 3);
    expect(p.stamina).toBeCloseTo(1 - SPRINT_DRAIN + SPRINT_RECOVER, 6);
  });

  it('an emptied bar stops the sprint until it has recovered to SPRINT_RESUME', () => {
    const p = sprinter();
    let ticks = 0;
    while (p.stamina > 0 && ticks < 2000) {
      updatePlayer(p, input({ moveX: 1, sprint: true }), SIM_DT);
      ticks++;
    }
    expect(ticks * SIM_DT).toBeCloseTo(1 / SPRINT_DRAIN, 1);
    updatePlayer(p, input({ moveX: 1, sprint: true }), SIM_DT);
    expect(p.sprintLock).toBe(true);
    expect(p.sprinting).toBe(false);
    // Still holding sprint: it can't sprint again until the bar is back to SPRINT_RESUME.
    let wait = 0;
    while (!p.sprinting && wait < 2000) {
      updatePlayer(p, input({ moveX: 1, sprint: true }), SIM_DT);
      wait++;
    }
    expect(wait * SIM_DT).toBeCloseTo(SPRINT_RESUME / SPRINT_RECOVER, 1);
  });

  it('standing still with sprint held does not drain it, and sprint and shield bits survive the wire', () => {
    const p = sprinter();
    for (let i = 0; i < 30; i++) updatePlayer(p, input({ sprint: true }), SIM_DT);
    expect(p.stamina).toBe(1);
    const frames = [input({ seq: 7, moveX: 1, sprint: true }), input({ seq: 8, shield: true, feint: true })];
    const back = decodeInputs(encodeInputs(frames))!;
    expect(back[0]).toMatchObject({ sprint: true, shield: false, feint: false });
    expect(back[1]).toMatchObject({ sprint: false, shield: true, feint: true });
    // The host's backlog keeps a one-frame feint.
    expect(mergeInputs(input({ feint: true }), input()).feint).toBe(true);
  });
});

describe('shield', () => {
  /** A slide from beside the ball (south of it, going north) at a carrier who has stood still for half a second. */
  function sideSlide(shield: boolean, seed: number): boolean {
    let s = carrierAnd([400 + CONTACT + 2, midY + 75], 'relaxed', seed);
    for (let i = 0; i < 30; i++) s = step(s, [input({ shield }), input()], SIM_DT);
    s = step(s, [input({ shield }), input({ tackle: true, moveY: -1 })], SIM_DT);
    for (let i = 0; i < 30; i++) s = step(s, [input({ shield }), input()], SIM_DT);
    return s.possession?.player !== 0;
  }

  it('makes a slide from the side or behind much less likely to win the ball', () => {
    let open = 0;
    let shielded = 0;
    for (let k = 0; k < 30; k++) {
      if (sideSlide(false, 10 + k)) open++;
      if (sideSlide(true, 10 + k)) shielded++;
    }
    expect(open).toBeGreaterThanOrEqual(27);
    expect(shielded).toBeLessThanOrEqual(10);
  });

  it('keeps the ball on the far side from the nearest opponent, and slows you down', () => {
    let s = carrierAnd([400, midY + 60]); // opponent just south
    for (let i = 0; i < 40; i++) s = step(s, [input({ shield: true, moveX: 1 }), input()], SIM_DT);
    expect(s.players[0].shielding).toBe(true);
    expect(s.ball.pos.y).toBeLessThan(s.players[0].pos.y); // held to the north, away from them
    expect(Math.hypot(s.players[0].vel.x, s.players[0].vel.y)).toBeLessThan(PLAYER_MAX_SPEED * 0.5);
  });
});

describe('feint / drag-back', () => {
  it('a double tap of a move key within FEINT_DOUBLE_TAP_MS is a feint; a slower one is not', () => {
    const tap = new DoubleTap(DEFAULT_BINDINGS);
    expect(tap.press('ArrowLeft', 1000)).toBe(false);
    expect(tap.press('ArrowLeft', 1000 + FEINT_DOUBLE_TAP_MS - 20)).toBe(true);
    expect(tap.press('KeyA', 2000)).toBe(false);
    expect(tap.press('KeyA', 2000 + FEINT_DOUBLE_TAP_MS + 50)).toBe(false);
    expect(tap.press('ArrowLeft', 3000)).toBe(false);
    expect(tap.press('ArrowUp', 3050)).toBe(false); // different directions don't pair up
    expect(tap.press('KeyX', 3100)).toBe(false); // not a move key
  });

  it('drags the ball across and steps that way, and a standing tackle can\'t win it meanwhile', () => {
    let s = carrierAnd([560, midY], 'tough');
    s = step(s, [input({ moveY: 1, feint: true }), input()], SIM_DT);
    const p = s.players[0];
    expect(s.possession?.player).toBe(0);
    expect(p.feintTimer).toBeGreaterThan(0);
    expect(p.vel.y).toBeGreaterThan(FEINT_SPEED * 0.9);
    // An AI challenger right on the ball during the feint: no standing tackle wins it.
    s.players[1].pos = { x: s.ball.pos.x + BALL_RADIUS + PLAYER_RADIUS + 1, y: s.ball.pos.y };
    updatePossession(s, [true, false]);
    expect(s.possession?.player).toBe(0);
  });
});

describe('settings', () => {
  it('keys saved before T17 get sprint on Shift (taken from switch) and shield on V, keeping the rest', () => {
    const old = { ...DEFAULT_BINDINGS, pass: ['KeyK', ''], switch: ['KeyZ', 'ShiftLeft'] } as Record<string, unknown>;
    delete old.sprint;
    delete old.shield;
    const b = sanitizeSettings({ bindings: old }).bindings;
    expect(b.pass).toEqual(['KeyK', '']);
    expect(b.sprint).toEqual(['ShiftLeft', '']);
    expect(b.switch).toEqual(['KeyZ', '']);
    expect(b.shield).toEqual(['KeyV', '']);
  });

  it('"AI defending vs humans" defaults to the rules (Arcade Relaxed, Classic Normal) and can be fixed', () => {
    expect(rulesFor('arcade').aiDefending).toBe('relaxed');
    expect(rulesFor('classic').aiDefending).toBe('normal');
    const d = sanitizeSettings(null);
    expect(d.aiDefending).toBe('rules');
    expect(sanitizeSettings({ aiDefending: 'tough' }).aiDefending).toBe('tough');
    expect(sanitizeSettings({ aiDefending: 'brutal' }).aiDefending).toBe('rules');
    expect(rulesFor('arcade', 'rules', 'tough').aiDefending).toBe('tough');
  });
});

// T13: sticky dribbling, the kick buffer, keepers catching, and possession over the network.
import { describe, expect, it } from 'vitest';
import {
  BALL_RADIUS,
  DRIBBLE_ROLL_AMPLITUDE,
  DRIBBLE_SPEED_FACTOR,
  KICK_BUFFER_TIME,
  KICK_REACH,
  PASS_SPEED,
  PITCH_HEIGHT,
  PITCH_RIGHT,
  PITCH_TOP,
  PLAYER_MAX_SPEED,
  PLAYER_RADIUS,
  SHOT_MAX_CHARGE_TIME,
  SIM_DT,
} from '../src/config';
import { KickCueWatcher } from '../src/audio/cues';
import { createInitialState, createPlayer, createSoloState, NEUTRAL_INPUT, step } from '../src/sim/simulation';
import { createAiState } from '../src/sim/ai';
import { decodeSnapshot, encodeSnapshot, mergeInputs, takeSnapshot } from '../src/net/snapshot';
import type { GameState, InputFrame } from '../src/sim/types';

const midY = PITCH_TOP + PITCH_HEIGHT / 2;
const CONTACT = PLAYER_RADIUS + BALL_RADIUS;
const input = (o: Partial<InputFrame> = {}): InputFrame => ({ ...NEUTRAL_INPUT, ...o });
const speedOf = (v: { x: number; y: number }) => Math.hypot(v.x, v.y);
const gapOf = (s: GameState, id = 0) => Math.hypot(s.ball.pos.x - s.players[id].pos.x, s.ball.pos.y - s.players[id].pos.y) - CONTACT;

function run(s: GameState, ticks: number, f: (n: number) => InputFrame): GameState {
  for (let i = 0; i < ticks; i++) s = step(s, [f(i)], SIM_DT);
  return s;
}

/** A lone human player at (300, midY) with the ball at its feet, already carrying it. */
function carrying(): GameState {
  let s = createSoloState(300, midY);
  s.ball.pos = { x: 300 + CONTACT + 2, y: midY };
  s = step(s, [input()], SIM_DT);
  expect(s.possession?.player).toBe(0);
  return s;
}

/** Player 0 (home, human) and player 1 (away, idle human input) on an empty pitch. */
function duel(home: [number, number], away: [number, number]): GameState {
  const s = createInitialState({ humans: [true, true] });
  s.players = [createPlayer(0, 0, home[0], home[1]), createPlayer(1, 1, away[0], away[1])];
  s.controlled = [0, 1];
  s.ai = createAiState(s.players, s.controlled);
  return s;
}

describe('sticky dribbling', () => {
  it('keeps the ball attached, in front, while running the length of the pitch', () => {
    let s = carrying();
    let prev = { ...s.ball.pos };
    let maxJump = 0;
    let minGap = Infinity;
    let maxGap = 0;
    for (let i = 0; i < 200; i++) {
      s = step(s, [input({ moveX: 1 })], SIM_DT);
      expect(s.possession?.player).toBe(0);
      maxJump = Math.max(maxJump, Math.hypot(s.ball.pos.x - prev.x, s.ball.pos.y - prev.y));
      prev = { ...s.ball.pos };
      if (i > 30) {
        minGap = Math.min(minGap, gapOf(s));
        maxGap = Math.max(maxGap, gapOf(s));
        expect(s.ball.pos.x).toBeGreaterThan(s.players[0].pos.x + PLAYER_RADIUS); // in front
      }
    }
    expect(s.players[0].pos.x).toBeGreaterThan(PITCH_RIGHT - 300); // ran most of the pitch
    expect(maxGap).toBeLessThanOrEqual(KICK_REACH); // always kickable
    expect(maxGap - minGap).toBeGreaterThan(DRIBBLE_ROLL_AMPLITUDE * 0.5); // visibly rolls, not glued
    expect(maxJump).toBeLessThan(PLAYER_MAX_SPEED * SIM_DT * 2); // never teleports
  });

  it('turns with the player smoothly, through 90 degrees and back', () => {
    let s = carrying();
    s = run(s, 40, () => input({ moveX: 1 }));
    let prev = { ...s.ball.pos };
    for (const dir of [{ moveY: 1 }, { moveX: -0.7, moveY: 0.7 }, { moveY: -1 }, { moveX: 1 }]) {
      for (let i = 0; i < 40; i++) {
        s = step(s, [input(dir)], SIM_DT);
        expect(s.possession?.player).toBe(0);
        expect(gapOf(s)).toBeLessThanOrEqual(KICK_REACH);
        expect(Math.hypot(s.ball.pos.x - prev.x, s.ball.pos.y - prev.y)).toBeLessThan(12);
        prev = { ...s.ball.pos };
      }
    }
    // After turning, the ball sits in front again (in the facing direction).
    const p = s.players[0];
    const toBall = Math.atan2(s.ball.pos.y - p.pos.y, s.ball.pos.x - p.pos.x);
    expect(Math.abs(toBall - p.facing)).toBeLessThan(0.2);
  });

  it('runs a little slower with the ball', () => {
    const s = run(carrying(), 90, () => input({ moveX: 1 }));
    expect(speedOf(s.players[0].vel)).toBeCloseTo(PLAYER_MAX_SPEED * DRIBBLE_SPEED_FACTOR, 0);
  });

  it('loses the ball on a very sharp turn at full speed (it runs on)', () => {
    let s = run(carrying(), 60, () => input({ moveX: 1 }));
    s = step(s, [input({ moveX: -1 })], SIM_DT);
    expect(s.possession).toBeNull();
    expect(s.ball.vel.x).toBeGreaterThan(100);
  });

  it('controls a slow loose ball automatically, but a hard shot bounces off', () => {
    let s = createSoloState(500, midY);
    s.ball.pos = { x: 600, y: midY };
    s.ball.vel = { x: -200, y: 0 };
    s = run(s, 40, () => input());
    expect(s.possession?.player).toBe(0);

    // A hard shot hits the player and is knocked away, not trapped.
    s = createSoloState(500, midY);
    s.ball.pos = { x: 600, y: midY };
    s.ball.vel = { x: -1000, y: 0 };
    let hit = -1;
    for (let i = 0; i < 20; i++) {
      s = step(s, [input()], SIM_DT);
      if (hit < 0 && s.lastTouch?.player === 0) hit = i;
      if (hit >= 0 && i <= hit + 5) expect(s.possession).toBeNull();
    }
    expect(hit).toBeGreaterThanOrEqual(0);
  });

  it("controls a teammate's firm pass that would bounce off as a loose ball", () => {
    const s0 = createInitialState();
    for (const p of s0.players) p.pos = { x: 1000, y: PITCH_TOP + 30 + p.id * 20 }; // everyone out of the way
    s0.players[3].pos = { x: 400, y: midY };
    s0.players[4].pos = { x: 600, y: midY };
    s0.controlled = [4, -1];
    s0.ball.pos = { x: 400 + CONTACT + 1, y: midY };
    s0.ball.vel = { x: 650, y: 0 };
    s0.lastTouch = { team: 0, player: 3 };
    let s = s0;
    for (let i = 0; i < 40 && !s.possession; i++) s = step(s, [input()], SIM_DT);
    expect(s.possession?.player).toBe(4);
  });

  it('a slide tackle wins the ball off the carrier', () => {
    let s = duel([400, midY], [480, midY]);
    s.players[1].facing = Math.PI;
    s.ball.pos = { x: 400 + CONTACT + 2, y: midY };
    s = step(s, [input(), input()], SIM_DT);
    expect(s.possession?.player).toBe(0);
    s = step(s, [input(), input({ tackle: true, moveX: -1 })], SIM_DT);
    let slideTouched = false;
    for (let i = 0; i < 20; i++) {
      s = step(s, [input(), input()], SIM_DT);
      if (s.lastTouch?.player === 1) slideTouched = true;
    }
    expect(s.possession?.player).not.toBe(0);
    expect(slideTouched).toBe(true); // (the knocked ball may then bounce off the carrier's body: their touch)
  });

  it('an opponent body-checking from the front takes it; one behind the carrier is shielded', () => {
    // Running into an opponent standing in front.
    let s = duel([400, midY], [520, midY]);
    s.ball.pos = { x: 400 + CONTACT + 2, y: midY };
    for (let i = 0; i < 60 && s.possession?.player !== 1; i++) s = step(s, [input({ moveX: 1 }), input()], SIM_DT);
    expect(s.possession?.player).toBe(1);

    // An opponent pushing in from behind never gets it.
    s = duel([400, midY], [370, midY]);
    s.ball.pos = { x: 400 + CONTACT + 2, y: midY };
    for (let i = 0; i < 60; i++) {
      s = step(s, [input({ moveX: 0.6 }), input({ moveX: 1 })], SIM_DT);
      expect(s.possession?.player).not.toBe(1);
    }
    expect(s.possession?.player).toBe(0);
  });
});

describe('kicks from possession always fire', () => {
  it('pass and shot fire on the press / release, at every point of a dribble and turn', () => {
    const turns = [{ moveX: 1 }, { moveY: 1 }, { moveX: 0.7, moveY: -0.7 }, { moveX: -1 }];
    for (let ticks = 3; ticks < 60; ticks += 7) {
      for (const turn of turns) {
        for (const kick of ['pass', 'shoot'] as const) {
          let s = run(carrying(), 30, () => input({ moveX: 1 }));
          s = run(s, ticks, () => input(turn));
          if (s.possession?.player !== 0) continue; // (a sharp turn lost it: not a kick from possession)
          if (kick === 'pass') s = step(s, [input({ ...turn, pass: true })], SIM_DT);
          else {
            s = run(s, 12, () => input({ ...turn, shoot: true }));
            expect(s.possession?.player).toBe(0);
            s = step(s, [input(turn)], SIM_DT);
          }
          expect(s.possession).toBeNull();
          expect(speedOf(s.ball.vel)).toBeGreaterThan(PASS_SPEED * 0.8);
          expect(s.players[0].kickFlash).toBeGreaterThan(0);
        }
      }
    }
  });

  it('a shot goes where the move keys point at release, not where the player was running', () => {
    let s = run(carrying(), 40, () => input({ moveX: 1 }));
    s = run(s, 20, () => input({ moveX: 1, shoot: true }));
    s = step(s, [input({ moveY: -1 })], SIM_DT); // release while pressing up
    const dir = Math.atan2(s.ball.vel.y, s.ball.vel.x);
    expect(dir).toBeLessThan(-Math.PI / 2 + 0.4); // mostly upwards (plus a little of the run)
    expect(dir).toBeGreaterThan(-Math.PI / 2 - 0.1);
  });

  it('a full charge from a dribble is a full-power shot', () => {
    let s = run(carrying(), 30, () => input({ moveX: 1 }));
    s = run(s, Math.round(SHOT_MAX_CHARGE_TIME / SIM_DT) + 5, () => input({ moveX: 1, shoot: true }));
    s = step(s, [input({ moveX: 1 })], SIM_DT);
    expect(s.ball.vel.x).toBeGreaterThan(1100);
  });
});

describe('kick buffer', () => {
  /** Ball rolling towards a standing player from `dist` px away at `speed`; the player presses pass now. */
  function pressThenArrive(dist: number, speed: number): GameState {
    let s = createSoloState(500, midY);
    s.players[0].facing = 0;
    s.ball.pos = { x: 500 - CONTACT - dist, y: midY };
    s.ball.vel = { x: speed, y: 0 };
    s = step(s, [input({ pass: true, moveY: -0.01 })], SIM_DT); // aim straight up
    expect(s.players[0].kickQueue).toBeGreaterThan(0); // queued, not dropped
    // Until it fires (or 1 s).
    for (let i = 0; i < 60 && s.players[0].kickFlash === 0; i++) s = step(s, [input()], SIM_DT);
    return s;
  }

  it('fires a pass pressed just before the ball arrives, in the aimed direction', () => {
    // Arrives after about 0.15 s, inside the window.
    const s = pressThenArrive(30, 200);
    expect(s.players[0].kickFlash).toBeGreaterThan(0);
    expect(s.ball.vel.y).toBeLessThan(-PASS_SPEED * 0.8);
    expect(s.players[0].kickQueue).toBe(0);
  });

  it('expires after KICK_BUFFER_TIME if the ball arrives later', () => {
    // Arrives after about 0.5 s: the press has expired, so the player just controls the ball.
    const s = pressThenArrive(130, 320);
    expect(s.players[0].kickFlash).toBe(0); // never fired
    expect(Math.abs(s.ball.vel.y)).toBeLessThan(50);
    expect(s.possession?.player).toBe(0);
  });

  it('the window is about KICK_BUFFER_TIME', () => {
    let s = createSoloState(500, midY);
    s = step(s, [input({ pass: true })], SIM_DT);
    let ticks = 0;
    while (s.players[0].kickQueue > 0 && ticks < 100) {
      s = step(s, [input()], SIM_DT);
      ticks++;
    }
    expect(ticks * SIM_DT).toBeCloseTo(KICK_BUFFER_TIME, 1);
  });

  it('a shot released out of reach is queued too (with its charge), and the charge bar shows off the ball', () => {
    let s = createSoloState(500, midY);
    s.ball.pos = { x: 900, y: 150 };
    s = run(s, 20, () => input({ shoot: true }));
    expect(s.players[0].charge).toBeGreaterThan(0.3);
    s = step(s, [input()], SIM_DT);
    expect(s.players[0].kickQueue).toBeGreaterThan(0);
    expect(s.players[0].queuedShot).toBe(true);
    expect(s.players[0].queuedSpeed).toBeGreaterThan(PASS_SPEED);
  });
});

describe('keepers', () => {
  function shotAtKeeper(speed: number): GameState {
    let s = createInitialState({ aiVsAi: true });
    for (const p of s.players) if (p.id !== 5) p.pos = { x: 300, y: PITCH_TOP + 30 + p.id * 30 };
    const keeper = s.players[5]; // away keeper, right goal
    s.ball.pos = { x: keeper.pos.x - 120, y: keeper.pos.y };
    s.ball.vel = { x: speed, y: 0 };
    s.lastTouch = { team: 0, player: 3 };
    for (let i = 0; i < 30; i++) s = step(s, [], SIM_DT);
    return s;
  }

  it('catch a catchable shot in the box and parry a hard one', () => {
    expect(shotAtKeeper(600).possession?.player).toBe(5);
    const hard = shotAtKeeper(1150);
    expect(hard.possession).toBeNull();
    expect(hard.score).toEqual([0, 0]);
  });
});

describe('network', () => {
  it('possession and the kick flags survive snapshot encode/decode', () => {
    let s = run(carrying(), 20, () => input({ moveX: 0.6, moveY: 0.8 }));
    s.players[0].kickQueue = 0.1;
    const snap = takeSnapshot(s, { ack: 3, paused: false, resumeIn: 0 });
    const back = decodeSnapshot(encodeSnapshot(snap))!;
    expect(back.possession?.player).toBe(0);
    expect(back.possession!.angle).toBeCloseTo(s.possession!.angle, 1);
    expect(back.possession!.roll).toBeCloseTo(s.possession!.roll, 0);
    expect(back.players[0].queued).toBe(true);
    s.possession = null;
    s.players[0].kickFlash = 0.1;
    const loose = decodeSnapshot(encodeSnapshot(takeSnapshot(s, { ack: 3, paused: false, resumeIn: 0 })))!;
    expect(loose.possession).toBeNull();
    expect(loose.players[0].kicked).toBe(true);
  });

  it("the host's input backlog keeps a quick shoot tap", () => {
    const tap = input({ seq: 1, shoot: true });
    const after = input({ seq: 2 });
    expect(mergeInputs(tap, after).shoot).toBe(true);
  });
});

describe('kick cues', () => {
  it('reports queued, fired and expired once each', () => {
    const w = new KickCueWatcher();
    expect(w.update(3, false, false)).toBeNull();
    expect(w.update(3, true, false)).toBe('queued');
    expect(w.update(3, true, false)).toBeNull();
    expect(w.update(3, false, false)).toBe('expired');
    expect(w.update(3, true, false)).toBe('queued');
    expect(w.update(3, false, true)).toBe('fired');
    expect(w.update(3, false, true)).toBeNull();
    expect(w.update(4, true, false)).toBeNull(); // a different player: no cue for what it was already doing
  });
});

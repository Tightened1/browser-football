import { describe, expect, it } from 'vitest';
import { SHOT_MAX_CHARGE_TIME, SIM_DT } from '../src/config';
import {
  applySnapshot,
  decodeInputs,
  decodeSnapshot,
  encodeInputs,
  encodeSnapshot,
  mergeInputs,
  quantizeInput,
  snapshotBytes,
  takeSnapshot,
  type Snapshot,
} from '../src/net/snapshot';
import { decode, fromBase64, toBase64 } from '../src/net/protocol';
import { createMatchState, NEUTRAL_INPUT, step } from '../src/sim/simulation';
import type { GameState, InputFrame } from '../src/sim/types';

const NET = { ack: 41, paused: false, resumeIn: 0 };

/** A real mid-match state: a few seconds of AI vs AI. */
function playedState(seconds = 6): GameState {
  let s = createMatchState({ aiVsAi: true, seed: 7 });
  for (let i = 0; i < seconds * 60; i++) s = step(s, [undefined, undefined], SIM_DT);
  return s;
}

function expectClose(a: Snapshot, b: Snapshot): void {
  const tol = { pos: 1 / 32 + 1e-9, vel: 1 / 16 + 1e-9, time: 0.005 + 1e-9 };
  expect(b.tick).toBe(a.tick);
  expect(b.ack).toBe(a.ack);
  expect(b.phase).toBe(a.phase);
  expect(b.half).toBe(a.half);
  expect(b.score).toEqual(a.score);
  expect(Math.abs(b.clock - a.clock)).toBeLessThanOrEqual(tol.time);
  expect(Math.abs(b.phaseTimer - Math.max(0, a.phaseTimer))).toBeLessThanOrEqual(tol.time);
  expect(b.attackDir0).toBe(a.attackDir0);
  expect(b.kickoffTeam).toBe(a.kickoffTeam);
  expect(b.controlled).toEqual(a.controlled);
  expect(b.restart).toEqual(a.restart);
  expect(b.lastEventId).toBe(a.lastEventId);
  expect(b.paused).toBe(a.paused);
  expect(b.players.length).toBe(a.players.length);
  const bodies = [[a.ball, b.ball], ...a.players.map((p, i) => [p, b.players[i]])] as const;
  for (const [x, y] of bodies) {
    expect(Math.abs(y.x - x.x)).toBeLessThanOrEqual(tol.pos);
    expect(Math.abs(y.y - x.y)).toBeLessThanOrEqual(tol.pos);
    expect(Math.abs(y.vx - x.vx)).toBeLessThanOrEqual(tol.vel);
    expect(Math.abs(y.vy - x.vy)).toBeLessThanOrEqual(tol.vel);
  }
  a.players.forEach((p, i) => {
    const q = b.players[i];
    const dAngle = Math.abs(Math.atan2(Math.sin(q.facing - p.facing), Math.cos(q.facing - p.facing)));
    expect(dAngle).toBeLessThanOrEqual(Math.PI / 256 + 1e-9);
    expect(Math.abs(q.charge - p.charge)).toBeLessThanOrEqual(SHOT_MAX_CHARGE_TIME / 510 + 1e-9);
    expect(q.tackling).toBe(p.tackling);
  });
}

describe('snapshot encode/decode', () => {
  it('round-trips a real match state within the quantisation step', () => {
    const s = playedState();
    const snap = takeSnapshot(s, NET);
    expectClose(snap, decodeSnapshot(encodeSnapshot(snap))!);
  });

  it('round-trips every phase, restarts, pause flags and negative facings / velocities', () => {
    const s = playedState(2);
    const base = takeSnapshot(s, NET);
    const variants: Snapshot[] = [
      { ...base, phase: 'goal-scored', score: [3, 2], restart: null, paused: true, resumeIn: 1.5, ack: -1 },
      { ...base, phase: 'half-time', half: 2, attackDir0: -1, kickoffTeam: 1, controlled: [-1, 9] },
      { ...base, phase: 'playing', restart: { type: 'corner', team: 1 }, lastEventId: 999 },
      { ...base, phase: 'full-time', restart: { type: 'throw-in', team: 0 } },
      {
        ...base,
        ball: { x: 12.5, y: -3.25, vx: -1399.5, vy: 812.125 },
        players: base.players.map((p, i) => ({ ...p, facing: -Math.PI + i * 0.6, vx: -p.vx, charge: (i / 10) * SHOT_MAX_CHARGE_TIME, tackling: i % 3 === 0 })),
      },
    ];
    for (const v of variants) {
      const back = decodeSnapshot(encodeSnapshot(v))!;
      expectClose(v, back);
      expect(back.resumeIn).toBeCloseTo(v.resumeIn, 1);
    }
  });

  it('is small: reports bytes per snapshot (vs JSON)', () => {
    const s = playedState();
    const bytes = encodeSnapshot(takeSnapshot(s, NET));
    const jsonSnapshot = JSON.stringify(takeSnapshot(s, NET)).length;
    const jsonState = JSON.stringify(s).length;
    console.log(`[snapshot] ${bytes.length} bytes binary · ${jsonSnapshot} bytes as JSON · full GameState ${jsonState} bytes as JSON · at 30/s: ${((bytes.length * 30) / 1024).toFixed(1)} KB/s`);
    expect(bytes.length).toBe(snapshotBytes(10));
    expect(bytes.length).toBe(146);
    expect(bytes.length).toBeLessThan(jsonSnapshot / 5);
  });

  it('rejects malformed packets', () => {
    const good = encodeSnapshot(takeSnapshot(playedState(1), NET));
    expect(decodeSnapshot(new Uint8Array(0))).toBeNull();
    expect(decodeSnapshot(good.slice(0, good.length - 1))).toBeNull(); // truncated
    const wrongType = good.slice();
    wrongType[0] = 99;
    expect(decodeSnapshot(wrongType)).toBeNull();
    const badPhase = good.slice();
    badPhase[9] = 17;
    expect(decodeSnapshot(badPhase)).toBeNull();
    expect(decodeSnapshot(encodeInputs([NEUTRAL_INPUT]))).toBeNull(); // an input packet is not a snapshot
  });

  it('decodes from a view into a larger buffer (as received)', () => {
    const good = encodeSnapshot(takeSnapshot(playedState(1), NET));
    const big = new Uint8Array(good.length + 10);
    big.set(good, 5);
    expect(decodeSnapshot(big.subarray(5, 5 + good.length))).not.toBeNull();
  });

  it('applies a snapshot to a guest state so it draws the same match', () => {
    const host = playedState();
    const guest = createMatchState({ humans: [true, true] });
    applySnapshot(guest, decodeSnapshot(encodeSnapshot(takeSnapshot(host, NET)))!);
    expect(guest.score).toEqual(host.score);
    expect(guest.phase).toBe(host.phase);
    expect(guest.clock).toBeCloseTo(host.clock, 2);
    expect(guest.controlled).toEqual(host.controlled);
    expect(guest.ball.pos.x).toBeCloseTo(host.ball.pos.x, 1);
    host.players.forEach((p, i) => {
      expect(guest.players[i].pos.x).toBeCloseTo(p.pos.x, 1);
      expect(guest.players[i].pos.y).toBeCloseTo(p.pos.y, 1);
      expect(guest.players[i].tackleTimer > 0).toBe(p.tackleTimer > 0);
    });
  });
});

describe('input packets', () => {
  const frame = (seq: number, over: Partial<InputFrame> = {}): InputFrame => ({ ...NEUTRAL_INPUT, seq, ...over });

  it('round-trips redundant frames, oldest first, with buttons and quantised movement', () => {
    const frames = [
      frame(100, { moveX: 1 }),
      frame(101, { moveX: Math.SQRT1_2, moveY: -Math.SQRT1_2, pass: true }),
      frame(102, { shoot: true, switchPlayer: true }),
      frame(103, { moveY: 1, tackle: true }),
    ];
    const bytes = encodeInputs(frames);
    expect(bytes.length).toBe(6 + 4 * 3);
    const back = decodeInputs(bytes)!;
    expect(back).toEqual(frames.map(quantizeInput));
    expect(back[1].moveX).toBeCloseTo(Math.SQRT1_2, 2);
  });

  it('quantises exactly as the wire does (so prediction matches the host)', () => {
    const f = frame(5, { moveX: 0.3333, moveY: -0.9 });
    expect(decodeInputs(encodeInputs([f]))![0]).toEqual(quantizeInput(f));
  });

  it('rejects malformed input packets', () => {
    expect(decodeInputs(new Uint8Array([2, 3, 0, 0, 0, 0]))).toBeNull();
    expect(decodeInputs(new Uint8Array([1]))).toBeNull();
  });

  it('merging a backlog keeps button presses', () => {
    const m = mergeInputs(frame(1, { pass: true, moveX: 1 }), frame(2, { moveY: 1 }));
    expect(m).toMatchObject({ seq: 2, pass: true, moveX: 0, moveY: 1 });
  });
});

describe('fallback over the reliable channel', () => {
  it('base64 round trip inside a valid fast message', () => {
    const bytes = encodeSnapshot(takeSnapshot(playedState(1), NET));
    const msg = decode({ t: 'fast', b: toBase64(bytes) });
    expect(msg).not.toBeNull();
    expect(fromBase64((msg as { b: string }).b)).toEqual(bytes);
    expect(fromBase64('***')).toBeNull();
  });
});

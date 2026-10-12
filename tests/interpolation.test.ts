import { describe, expect, it } from 'vitest';
import { NET_CLOCK_RESET_TICKS, NET_MAX_EXTRAPOLATION_MS, NET_TELEPORT_DISTANCE, SIM_DT, SIM_HZ } from '../src/config';
import { extrapolateSnapshot, interpolateSnapshots, lerp, lerpAngle, PlaybackClock, SnapshotBuffer } from '../src/net/interpolation';
import { NetConditioner } from '../src/net/netsim';
import { takeSnapshot, type Snapshot } from '../src/net/snapshot';
import { LossMeter, RateMeter } from '../src/net/stats';
import { createMatchState, step } from '../src/sim/simulation';

const base = takeSnapshot(createMatchState({ humans: [true, true] }), { ack: -1, paused: false, resumeIn: 0 });

/** A snapshot at `tick` with the ball at (x, y) moving at (vx, vy) and player 0 at px. */
function snap(tick: number, x: number, over: Partial<Snapshot> = {}, vx = 0): Snapshot {
  return {
    ...base,
    tick,
    phase: 'playing',
    clock: tick / SIM_HZ,
    ball: { x, y: 300, vx, vy: 0 },
    players: base.players.map((p, i) => (i === 0 ? { ...p, x, facing: 0 } : p)),
    ...over,
  };
}

describe('interpolation maths', () => {
  it('lerps', () => {
    expect(lerp(10, 20, 0)).toBe(10);
    expect(lerp(10, 20, 0.25)).toBe(12.5);
    expect(lerp(10, 20, 1)).toBe(20);
  });

  it('interpolates angles the short way round', () => {
    expect(lerpAngle(0, Math.PI / 2, 0.5)).toBeCloseTo(Math.PI / 4);
    // 170° -> -170° goes through 180°, not through 0°.
    const a = (170 * Math.PI) / 180;
    const r = lerpAngle(a, -a, 0.5);
    expect(Math.abs(r)).toBeCloseTo(Math.PI);
    expect(lerpAngle(-3, 3, 0)).toBeCloseTo(-3);
    expect(lerpAngle(-3, 3, 1)).toBeCloseTo(3);
  });

  it('interpolates positions, velocities, clock and facing between two snapshots', () => {
    const a = snap(100, 200, {}, 60);
    const b = snap(102, 202, { players: base.players.map((p, i) => (i === 0 ? { ...p, x: 202, facing: Math.PI / 2 } : p)) }, 120);
    const m = interpolateSnapshots(a, b, 0.5);
    expect(m.tick).toBe(101);
    expect(m.ball.x).toBeCloseTo(201);
    expect(m.ball.vx).toBeCloseTo(90);
    expect(m.players[0].x).toBeCloseTo(201);
    expect(m.players[0].facing).toBeCloseTo(Math.PI / 4);
    expect(m.clock).toBeCloseTo(101 / SIM_HZ);
  });

  it('takes discrete fields from the older snapshot until the newer one is reached', () => {
    const a = snap(100, 200, { score: [0, 0], phase: 'playing' });
    const b = snap(102, 200, { score: [1, 0], phase: 'goal-scored', clock: 5, phaseTimer: 2 });
    expect(interpolateSnapshots(a, b, 0.99).score).toEqual([0, 0]);
    expect(interpolateSnapshots(a, b, 0.99).phase).toBe('playing');
    expect(interpolateSnapshots(a, b, 1).score).toEqual([1, 0]);
    expect(interpolateSnapshots(a, b, 1).phaseTimer).toBe(2);
  });

  it('snaps (does not slide) when something teleports, e.g. the kickoff reset', () => {
    const a = snap(100, 200);
    const b = snap(102, 200 + NET_TELEPORT_DISTANCE + 50);
    expect(interpolateSnapshots(a, b, 0.5).ball.x).toBe(200);
    expect(interpolateSnapshots(a, b, 1).ball.x).toBe(200 + NET_TELEPORT_DISTANCE + 50);
  });

  it('extrapolates along velocity, capped', () => {
    const s = snap(100, 200, {}, 300);
    expect(extrapolateSnapshot(s, 0.05).ball.x).toBeCloseTo(215);
    const cap = NET_MAX_EXTRAPOLATION_MS / 1000;
    expect(extrapolateSnapshot(s, 5).ball.x).toBeCloseTo(200 + 300 * cap);
  });

  it('matches the real sim: halfway between two snapshots of a rolling ball is close to the true position', () => {
    const s = createMatchState({ aiVsAi: true, seed: 3 });
    s.phase = 'playing';
    s.ball.vel = { x: 500, y: 120 };
    const net = { ack: -1, paused: false, resumeIn: 0 };
    const s0 = s;
    const s1 = step(s0, [undefined, undefined], SIM_DT);
    const s2 = step(s1, [undefined, undefined], SIM_DT);
    const m = interpolateSnapshots(takeSnapshot(s0, net), takeSnapshot(s2, net), 0.5);
    expect(Math.hypot(m.ball.x - s1.ball.pos.x, m.ball.y - s1.ball.pos.y)).toBeLessThan(0.5);
  });
});

describe('snapshot buffer', () => {
  it('keeps snapshots ordered, ignoring duplicates and out-of-date ones', () => {
    const buf = new SnapshotBuffer(4);
    expect(buf.push(snap(10, 0))).toBe(true);
    expect(buf.push(snap(14, 0))).toBe(true);
    expect(buf.push(snap(12, 0))).toBe(true); // arrived late, slots in
    expect(buf.push(snap(12, 0))).toBe(false); // duplicate
    expect(buf.items.map((s) => s.tick)).toEqual([10, 12, 14]);
    buf.push(snap(16, 0));
    buf.push(snap(18, 0));
    expect(buf.items.map((s) => s.tick)).toEqual([12, 14, 16, 18]);
    expect(buf.push(snap(11, 0))).toBe(false); // older than everything kept, buffer full
    expect(buf.newest?.tick).toBe(18);
    expect(buf.aheadOf(13)).toBe(3);
  });

  it('samples by interpolating, holding before the start and extrapolating after the end', () => {
    const buf = new SnapshotBuffer();
    buf.push(snap(10, 100, {}, 60));
    buf.push(snap(12, 102, {}, 60));
    buf.push(snap(14, 104, {}, 60));
    expect(buf.sample(13)!.snap.ball.x).toBeCloseTo(103);
    expect(buf.sample(13)!.extrapolating).toBe(false);
    expect(buf.sample(5)!.snap.ball.x).toBe(100);
    const after = buf.sample(17)!;
    expect(after.extrapolating).toBe(true);
    expect(after.snap.ball.x).toBeCloseTo(104 + 60 * (3 / SIM_HZ));
    expect(new SnapshotBuffer().sample(1)).toBeNull();
  });

  it('bridges a lost snapshot', () => {
    const buf = new SnapshotBuffer();
    buf.push(snap(10, 100));
    buf.push(snap(14, 104)); // 12 never arrived
    expect(buf.sample(12)!.snap.ball.x).toBeCloseTo(102);
  });
});

describe('playback clock', () => {
  const delay = 6; // 100 ms at 60 Hz
  const msPerTick = 1000 / SIM_HZ;

  it('runs a fixed delay behind the newest snapshot', () => {
    const c = new PlaybackClock(delay);
    expect(c.update(0)).toBe(-1); // nothing yet
    for (let tick = 0; tick <= 120; tick += 2) c.onSnapshot(tick, 1000 + tick * msPerTick);
    expect(c.update(1000 + 120 * msPerTick)).toBeCloseTo(120 - delay, 5);
  });

  it('is not dragged back by jitter (adapts fast to early packets, slowly to late ones)', () => {
    const c = new PlaybackClock(delay);
    let seed = 1;
    const rand = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let tick = 0; tick <= 600; tick += 2) c.onSnapshot(tick, 1000 + tick * msPerTick + rand() * 40); // 0-40 ms late
    const t = c.update(1000 + 600 * msPerTick);
    // Tracks close to the earliest arrivals: well under half the jitter (2.4 ticks) behind the ideal.
    expect(t).toBeLessThanOrEqual(600 - delay + 0.01);
    expect(t).toBeGreaterThan(600 - delay - 1.2);
  });

  it('never runs backwards, but jumps after a long gap (e.g. the host paused)', () => {
    const c = new PlaybackClock(delay);
    for (let tick = 0; tick <= 60; tick += 2) c.onSnapshot(tick, tick * msPerTick);
    const t1 = c.update(60 * msPerTick);
    c.onSnapshot(58, 61 * msPerTick); // a late packet
    expect(c.update(60.5 * msPerTick)).toBeGreaterThanOrEqual(t1);
    // Host paused for 5 s, then carries on from tick 62.
    const later = 60 * msPerTick + 5000;
    c.onSnapshot(62, later);
    expect(c.update(later)).toBeCloseTo(62 - delay, 5);
    expect(NET_CLOCK_RESET_TICKS).toBeLessThan(300);
  });
});

describe('network meters', () => {
  it('estimates loss from sequence gaps, counting late arrivals', () => {
    const m = new LossMeter(2, 100);
    expect(m.loss()).toBe(0);
    for (let t = 0; t < 200; t += 2) if (t % 20 !== 0) m.record(t); // every 10th lost
    expect(m.loss()).toBeCloseTo(0.1, 1);
    const n = new LossMeter(1);
    [1, 3, 2, 4].forEach((s) => n.record(s)); // reordered, none lost
    expect(n.loss()).toBe(0);
  });

  it('measures rates over a window', () => {
    const r = new RateMeter(1000);
    for (let t = 0; t < 1000; t += 1000 / 30) r.record(t);
    expect(r.rate(999)).toBeCloseTo(30, 0);
    expect(r.rate(5000)).toBe(0);
  });

  it('simulated conditions delay, drop unreliable sends only, and keep reliable ones in order', () => {
    const queue: { at: number; fn: () => void }[] = [];
    let now = 0;
    const rolls = [0.9, 0.5, 0.0, 0.99, 0.1];
    let i = 0;
    const c = new NetConditioner({ latencyMs: 50, jitterMs: 100, loss: 0.2 }, () => rolls[i++ % rolls.length], () => now, (fn, ms) => queue.push({ at: now + ms, fn }));
    const got: string[] = [];
    c.send(() => got.push('r1'), true); // 50 + 90 = 140
    c.send(() => got.push('r2'), true); // 50 + 50 = 100, but must not overtake r1
    c.send(() => got.push('u-lost'), false); // roll 0.0 < 0.2: dropped
    c.send(() => got.push('u1'), false); // roll 0.99 keeps it, roll 0.1 -> 60 ms
    queue.sort((a, b) => a.at - b.at);
    now = 1000;
    for (const q of queue) q.fn();
    expect(got).toEqual(['u1', 'r1', 'r2']);
    expect(queue.map((q) => q.at)).toEqual([60, 140, 140]);
  });
});

// Snapshot buffering, interpolation and the guest's render clock. Pure: no PeerJS, no DOM (time is passed in).
import {
  NET_CLOCK_ADAPT_EARLY,
  NET_CLOCK_ADAPT_LATE,
  NET_CLOCK_RESET_TICKS,
  NET_MAX_EXTRAPOLATION_MS,
  NET_SNAPSHOT_BUFFER_SIZE,
  NET_TELEPORT_DISTANCE,
  SIM_HZ,
} from '../config';
import type { BodySnap, PlayerSnap, Snapshot } from './snapshot';

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Interpolates angles the short way round (result in -PI..PI]. */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  let r = a + d * t;
  while (r > Math.PI) r -= Math.PI * 2;
  while (r <= -Math.PI) r += Math.PI * 2;
  return r;
}

function lerpBody<T extends BodySnap>(a: T, b: T, t: number): BodySnap {
  if (Math.hypot(b.x - a.x, b.y - a.y) > NET_TELEPORT_DISTANCE) return t < 1 ? { x: a.x, y: a.y, vx: a.vx, vy: a.vy } : { x: b.x, y: b.y, vx: b.vx, vy: b.vy };
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), vx: lerp(a.vx, b.vx, t), vy: lerp(a.vy, b.vy, t) };
}

/**
 * The state between snapshots `a` (older) and `b` at t (0..1). Positions, velocities, facing, charge and the
 * clocks are interpolated; anything discrete (phase, score, who is controlled) and anything that teleported
 * comes from `a` until t reaches 1, so it always matches the positions drawn.
 */
export function interpolateSnapshots(a: Snapshot, b: Snapshot, t: number): Snapshot {
  t = Math.min(1, Math.max(0, t));
  const base = t < 1 ? a : b;
  const players: PlayerSnap[] = a.players.map((pa, i) => {
    const pb = b.players[i] ?? pa;
    const pbase = base.players[i] ?? pa;
    return {
      // Discrete flags (incl. T17's sprint, shield, wind-up, feint) come from the base snapshot; stamina is interpolated.
      ...pbase,
      ...lerpBody(pa, pb, t),
      stamina: lerp(pa.stamina, pb.stamina, t),
      facing: lerpAngle(pa.facing, pb.facing, t),
      charge: pb.charge >= pa.charge ? lerp(pa.charge, pb.charge, t) : base === a ? pa.charge : pb.charge,
    };
  });
  const samePhase = a.phase === b.phase && a.half === b.half;
  return {
    ...base,
    tick: lerp(a.tick, b.tick, t),
    clock: samePhase ? lerp(a.clock, b.clock, t) : base.clock,
    phaseTimer: samePhase ? lerp(a.phaseTimer, b.phaseTimer, t) : base.phaseTimer,
    ball: lerpBody(a.ball, b.ball, t),
    players,
  };
}

/** Moves things on along their velocities for `seconds` (capped at NET_MAX_EXTRAPOLATION_MS). */
export function extrapolateSnapshot(s: Snapshot, seconds: number): Snapshot {
  const dt = Math.min(Math.max(0, seconds), NET_MAX_EXTRAPOLATION_MS / 1000);
  const move = <T extends BodySnap>(b: T): T => ({ ...b, x: b.x + b.vx * dt, y: b.y + b.vy * dt });
  return { ...s, tick: s.tick + dt * SIM_HZ, ball: move(s.ball), players: s.players.map(move) };
}

/** Snapshots ordered by tick; duplicates and ones older than everything kept are ignored. */
export class SnapshotBuffer {
  readonly items: Snapshot[] = [];

  constructor(private readonly capacity = NET_SNAPSHOT_BUFFER_SIZE) {}

  /** False if the snapshot was a duplicate or too old to be useful. */
  push(s: Snapshot): boolean {
    const items = this.items;
    if (items.length >= this.capacity && s.tick <= items[0].tick) return false;
    let i = items.length;
    while (i > 0 && items[i - 1].tick > s.tick) i--;
    if (i > 0 && items[i - 1].tick === s.tick) return false;
    items.splice(i, 0, s);
    if (items.length > this.capacity) items.splice(0, items.length - this.capacity);
    return true;
  }

  get newest(): Snapshot | undefined {
    return this.items[this.items.length - 1];
  }

  /** How many snapshots are newer than `tick` (the guest's safety margin). */
  aheadOf(tick: number): number {
    let n = 0;
    for (let i = this.items.length - 1; i >= 0 && this.items[i].tick > tick; i--) n++;
    return n;
  }

  clear(): void {
    this.items.length = 0;
  }

  /**
   * The state at `tick`: interpolated between the snapshots either side, extrapolated (briefly) past the newest,
   * or the oldest if `tick` is before everything. `extrapolating` says the buffer ran dry.
   */
  sample(tick: number): { snap: Snapshot; extrapolating: boolean } | null {
    const items = this.items;
    if (items.length === 0) return null;
    if (tick <= items[0].tick) return { snap: items[0], extrapolating: false };
    const last = items[items.length - 1];
    if (tick >= last.tick) return { snap: extrapolateSnapshot(last, (tick - last.tick) / SIM_HZ), extrapolating: tick > last.tick };
    let i = items.length - 2;
    while (i > 0 && items[i].tick > tick) i--;
    const a = items[i];
    const b = items[i + 1];
    return { snap: interpolateSnapshots(a, b, (tick - a.tick) / (b.tick - a.tick)), extrapolating: false };
  }
}

/**
 * The guest's render clock, in host ticks. It estimates the host's current tick from when snapshots arrive
 * (adapting quickly to early ones and slowly to late ones, so jitter doesn't drag it back), and runs a fixed
 * delay behind that. It never runs backwards except when it jumps (first snapshot, after a pause, big drift).
 */
export class PlaybackClock {
  /** Estimated host tick minus local time in ticks; null until the first snapshot. */
  private offset: number | null = null;
  renderTick = -1;

  constructor(private readonly delayTicks: number) {}

  get started(): boolean {
    return this.offset !== null;
  }

  onSnapshot(tick: number, nowMs: number): void {
    const sample = tick - (nowMs * SIM_HZ) / 1000;
    if (this.offset === null || Math.abs(sample - this.offset) > NET_CLOCK_RESET_TICKS) {
      this.offset = sample;
      return;
    }
    this.offset += (sample - this.offset) * (sample > this.offset ? NET_CLOCK_ADAPT_EARLY : NET_CLOCK_ADAPT_LATE);
  }

  /** Advances to `nowMs` and returns the tick to draw. */
  update(nowMs: number): number {
    if (this.offset === null) return this.renderTick;
    const target = this.offset + (nowMs * SIM_HZ) / 1000 - this.delayTicks;
    if (this.renderTick < 0 || Math.abs(target - this.renderTick) > NET_CLOCK_RESET_TICKS) this.renderTick = target;
    else this.renderTick = Math.max(this.renderTick, target);
    return this.renderTick;
  }

  reset(): void {
    this.offset = null;
    this.renderTick = -1;
  }
}

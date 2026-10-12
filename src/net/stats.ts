// Small meters for the network debug overlay. Pure: time is passed in (ms).

/** Counts things per second over a sliding window. */
export class RateMeter {
  private readonly times: number[] = [];

  constructor(private readonly windowMs = 2_000) {}

  record(nowMs: number): void {
    this.times.push(nowMs);
    this.trim(nowMs);
  }

  rate(nowMs: number): number {
    this.trim(nowMs);
    return (this.times.length * 1000) / this.windowMs;
  }

  private trim(nowMs: number): void {
    while (this.times.length && this.times[0] <= nowMs - this.windowMs) this.times.shift();
  }
}

/**
 * Packet loss from sequence numbers spaced `stride` apart (e.g. snapshot ticks): of the sequence numbers that
 * should have arrived over the last `window` of them, the fraction that didn't. Late (reordered) packets still count.
 */
export class LossMeter {
  private readonly seen = new Set<number>();
  private newest = -Infinity;

  constructor(
    private readonly stride = 1,
    private readonly window = 120,
  ) {}

  record(seq: number): void {
    this.seen.add(seq);
    if (seq > this.newest) this.newest = seq;
    const oldest = this.newest - this.window * this.stride;
    for (const s of this.seen) if (s <= oldest) this.seen.delete(s);
  }

  /** 0..1, or 0 before anything has arrived. */
  loss(): number {
    if (this.newest === -Infinity || this.seen.size === 0) return 0;
    let first = this.newest;
    for (const s of this.seen) if (s < first) first = s;
    const expected = Math.floor((this.newest - first) / this.stride) + 1;
    return expected > 0 ? Math.max(0, 1 - this.seen.size / expected) : 0;
  }

  reset(): void {
    this.seen.clear();
    this.newest = -Infinity;
  }
}

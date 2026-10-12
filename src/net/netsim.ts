// Simulated latency / jitter / packet loss on what this side sends (for testing on one machine). See NET_SIMULATION.
import { NET_SIMULATION } from '../config';

export interface NetConditions {
  latencyMs: number;
  jitterMs: number;
  loss: number;
}

/** NET_SIMULATION from config.ts, overridden by ?lag=, ?jitter= and ?loss= in the URL. */
export function netConditions(search = typeof window === 'undefined' ? '' : window.location.search): NetConditions {
  const q = new URLSearchParams(search);
  const num = (key: string, fallback: number, max: number): number => {
    const v = Number(q.get(key));
    return q.has(key) && Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : fallback;
  };
  return {
    latencyMs: num('lag', NET_SIMULATION.latencyMs, 2_000),
    jitterMs: num('jitter', NET_SIMULATION.jitterMs, 1_000),
    loss: num('loss', NET_SIMULATION.loss, 1),
  };
}

export const describeConditions = (c: NetConditions): string =>
  c.latencyMs || c.jitterMs || c.loss ? `+${c.latencyMs}ms (±${c.jitterMs}) one way, ${Math.round(c.loss * 100)}% loss` : 'off';

/**
 * Delays (and, for unreliable sends, drops) outgoing messages. Reliable sends keep their order, like the real
 * channel; unreliable ones may arrive out of order, like the real one.
 */
export class NetConditioner {
  private reliableAt = 0;

  constructor(
    readonly conditions: NetConditions = netConditions(),
    private readonly random: () => number = Math.random,
    private readonly now: () => number = () => performance.now(),
    private readonly schedule: (fn: () => void, ms: number) => void = (fn, ms) => void setTimeout(fn, ms),
  ) {}

  get active(): boolean {
    const c = this.conditions;
    return c.latencyMs > 0 || c.jitterMs > 0 || c.loss > 0;
  }

  /** Longest a send can be held back (ms). */
  get maxDelayMs(): number {
    return this.conditions.latencyMs + this.conditions.jitterMs;
  }

  send(deliver: () => void, reliable: boolean): void {
    if (!this.active) {
      deliver();
      return;
    }
    const c = this.conditions;
    if (!reliable && this.random() < c.loss) return;
    const now = this.now();
    let at = now + c.latencyMs + this.random() * c.jitterMs;
    if (reliable) {
      at = Math.max(at, this.reliableAt);
      this.reliableAt = at;
    }
    if (at <= now) deliver();
    else this.schedule(deliver, at - now);
  }
}

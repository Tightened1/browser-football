// Works out what the match "sounds like" from what is drawn: new match events, and kicks / bounces seen in the ball's
// motion. Pure (no Phaser, no Web Audio), so the host and the online guest get the same cues from the same state, and
// it is unit-tested. Nothing here ever touches the simulation.
import {
  CUE_COOLDOWN,
  CUE_MIN_DELTA_V,
  CUE_POST_REACH,
  CUE_POWER_MAX_SPEED,
  CUE_POWER_MIN_SPEED,
  CUE_WINDOW,
  NET_TELEPORT_DISTANCE,
  PITCH_LEFT,
  PITCH_RIGHT,
  POST_RADIUS,
} from '../config';
import type { MatchEvent, Vec2 } from '../sim/types';

export type BallCueType = 'kick' | 'post' | 'net';

export interface BallCue {
  type: BallCueType;
  /** 0 (soft) .. 1 (hard). */
  power: number;
  pos: Vec2;
  /** Unit vector the ball now travels along (0,0 if it is almost still). */
  dir: Vec2;
}

interface Sample {
  t: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export function kickPower(speed: number): number {
  return Math.min(1, Math.max(0, (speed - CUE_POWER_MIN_SPEED) / (CUE_POWER_MAX_SPEED - CUE_POWER_MIN_SPEED)));
}

/**
 * Watches the drawn ball frame by frame. A sudden change of velocity is a kick, or a bounce off a post / the back of
 * the net. Comparing with the ball a few frames ago (not just the last one) also catches a kick that an online guest
 * sees spread over two interpolated frames.
 */
export class BallCueDetector {
  private hist: Sample[] = [];
  private t = 0;
  private lastCue = -Infinity;

  reset(): void {
    this.hist.length = 0;
    this.lastCue = -Infinity;
  }

  /** `dt` is the real time since the last call (s); `posts` the goal post centres. */
  update(ball: { pos: Vec2; vel: Vec2; radius: number }, dt: number, posts: readonly Vec2[]): BallCue | null {
    this.t += dt;
    const cur: Sample = { t: this.t, x: ball.pos.x, y: ball.pos.y, vx: ball.vel.x, vy: ball.vel.y };
    const last = this.hist[this.hist.length - 1];
    // A teleport (kickoff, set piece, new match) is not a kick: start the history afresh.
    if (last && Math.hypot(cur.x - last.x, cur.y - last.y) > NET_TELEPORT_DISTANCE) this.hist.length = 0;
    this.hist.push(cur);
    while (this.hist.length > 2 && this.hist[1].t <= this.t - CUE_WINDOW * 2) this.hist.shift();
    if (this.hist.length < 2 || this.t - this.lastCue < CUE_COOLDOWN) return null;

    // The newest sample that is at least CUE_WINDOW old (or the oldest we have).
    let ref = this.hist[0];
    for (const s of this.hist) if (s.t <= this.t - CUE_WINDOW) ref = s;
    if (ref === cur) return null;
    const dv = Math.hypot(cur.vx - ref.vx, cur.vy - ref.vy);
    if (dv < CUE_MIN_DELTA_V) return null;

    this.lastCue = this.t;
    const speed = Math.hypot(cur.vx, cur.vy);
    const reach = ball.radius + POST_RADIUS + CUE_POST_REACH;
    const nearPost = posts.some((p) => Math.hypot(p.x - cur.x, p.y - cur.y) < reach || Math.hypot(p.x - ref.x, p.y - ref.y) < reach);
    const inNet = cur.x < PITCH_LEFT - ball.radius || cur.x > PITCH_RIGHT + ball.radius;
    const type: BallCueType = nearPost ? 'post' : inNet ? 'net' : 'kick';
    // A kick's loudness follows how fast the ball leaves; a bounce's follows how hard it hit.
    const power = type === 'kick' ? kickPower(speed) : kickPower(Math.max(speed, dv));
    return { type, power, pos: { x: cur.x, y: cur.y }, dir: speed > 1 ? { x: cur.vx / speed, y: cur.vy / speed } : { x: 0, y: 0 } };
  }
}

export interface EventScan {
  /** Events not seen before, oldest first. */
  fresh: MatchEvent[];
  /** Pass this back in next time. */
  lastId: number;
}

/**
 * Picks out the events a consumer has not handled yet. Ids only ever increase within a match; when `restarted` (a new
 * match began and the ids start again) everything in the list is new.
 */
export function scanEvents(events: readonly MatchEvent[], lastId: number, restarted = false): EventScan {
  const base = restarted ? 0 : lastId;
  const fresh = events.filter((e) => e.id > base);
  const newest = events.length ? events[events.length - 1].id : base;
  return { fresh, lastId: restarted ? newest : Math.max(base, newest) };
}

export type SoundId = 'whistle-short' | 'whistle-half' | 'whistle-full' | 'goal';

/** The sound (if any) a match event makes. */
export function eventSound(event: MatchEvent): SoundId | null {
  switch (event.type) {
    case 'kickoff':
      return 'whistle-short';
    case 'half-time':
      return 'whistle-half';
    case 'full-time':
      return 'whistle-full';
    case 'goal':
      return 'goal';
    default:
      return null;
  }
}

/** How worked up the crowd is (0..1): rises as the ball nears either goal. */
export function crowdExcitement(ballX: number, ballSpeed: number, pitchLeft: number, pitchRight: number): number {
  const toGoal = Math.min(Math.abs(ballX - pitchLeft), Math.abs(pitchRight - ballX));
  const near = Math.min(1, Math.max(0, 1 - toGoal / 320));
  const fast = Math.min(1, ballSpeed / 900);
  return Math.min(1, near * 0.8 + fast * 0.2);
}

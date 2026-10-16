// T23: instant replays and full-time highlights. A rolling buffer of the match's binary snapshots (the same encoding
// the host sends the guest), cut into clips around goals and big saves, and played back into a separate GameState for
// drawing. The live match state is never touched. Pure: no Phaser, no PeerJS, no DOM (time is passed in).
import {
  NET_SNAPSHOT_INTERVAL_TICKS,
  REPLAY_BUFFER_SECONDS,
  REPLAY_BUILDUP_SECONDS,
  REPLAY_MAX_CLIPS,
  REPLAY_SAVE_BUILDUP_SECONDS,
  REPLAY_SAVE_TAIL_SECONDS,
  REPLAY_SLOWMO_AFTER_SECONDS,
  REPLAY_SLOWMO_SECONDS,
  REPLAY_SLOWMO_SPEED,
  REPLAY_TAIL_SECONDS,
  SIM_HZ,
} from '../config';
import type { GameState, MatchEvent, TeamId } from '../sim/types';
import { SnapshotBuffer } from './interpolation';
import { applySnapshot, decodeSnapshot, type Snapshot } from './snapshot';

/** Replays setting: none, a replay after each goal, or that plus the full-time highlights. */
export type ReplayMode = 'off' | 'goals' | 'all';
export const REPLAY_MODES: readonly ReplayMode[] = ['off', 'goals', 'all'];

/* ---- Ring buffer ----------------------------------------------------------------------------------- */

/**
 * The last `capacity` encoded snapshots, in one preallocated slab (no allocation per frame once it is big enough).
 * Ticks only go up: a frame not newer than the newest is refused (a late, out-of-order packet on the guest).
 */
export class ReplayRing {
  private slab: Uint8Array;
  private slot: number;
  private readonly lens: Uint16Array;
  private readonly ticks: Float64Array;
  /** Index the next frame is written to; `count` frames end just before it. */
  private head = 0;
  private count = 0;

  constructor(readonly capacity: number, slotBytes = 256) {
    this.slot = slotBytes;
    this.slab = new Uint8Array(capacity * slotBytes);
    this.lens = new Uint16Array(capacity);
    this.ticks = new Float64Array(capacity);
  }

  get length(): number {
    return this.count;
  }

  /** Bytes held by the slab (for tests and the curious). */
  get bytes(): number {
    return this.slab.byteLength;
  }

  get newestTick(): number {
    return this.count ? this.ticks[(this.head - 1 + this.capacity) % this.capacity] : -1;
  }

  get oldestTick(): number {
    return this.count ? this.ticks[(this.head - this.count + this.capacity) % this.capacity] : -1;
  }

  /** False if the frame was refused (not newer than the newest kept, empty or too big for a u16 length). */
  push(tick: number, frame: Uint8Array): boolean {
    if (frame.length === 0 || frame.length > 0xffff || (this.count > 0 && tick <= this.newestTick)) return false;
    if (frame.length > this.slot) this.grow(frame.length);
    const i = this.head;
    this.slab.set(frame, i * this.slot);
    this.lens[i] = frame.length;
    this.ticks[i] = tick;
    this.head = (i + 1) % this.capacity;
    this.count = Math.min(this.capacity, this.count + 1);
    return true;
  }

  /** Copies of the frames with from <= tick <= to, oldest first. */
  range(from: number, to: number): { tick: number; frame: Uint8Array }[] {
    const out: { tick: number; frame: Uint8Array }[] = [];
    for (let k = 0; k < this.count; k++) {
      const i = (this.head - this.count + k + this.capacity) % this.capacity;
      const tick = this.ticks[i];
      if (tick < from || tick > to) continue;
      out.push({ tick, frame: this.slab.slice(i * this.slot, i * this.slot + this.lens[i]) });
    }
    return out;
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
  }

  /** A bigger frame than the slots hold (more players): re-lay the slab with bigger slots. */
  private grow(size: number): void {
    const slot = Math.max(size, this.slot * 2);
    const slab = new Uint8Array(this.capacity * slot);
    for (let i = 0; i < this.capacity; i++) slab.set(this.slab.subarray(i * this.slot, i * this.slot + this.lens[i]), i * slot);
    this.slab = slab;
    this.slot = slot;
  }
}

/** Frames the replay buffer holds: REPLAY_BUFFER_SECONDS of snapshots. */
export const REPLAY_RING_FRAMES = Math.ceil((REPLAY_BUFFER_SECONDS * SIM_HZ) / NET_SNAPSHOT_INTERVAL_TICKS);

/* ---- Clips ------------------------------------------------------------------------------------------ */

export type ClipKind = 'goal' | 'save';

export interface ReplayClip {
  kind: ClipKind;
  /** Tick of the goal (the ball over the line) or the save. */
  moment: number;
  /** Goal: the scoring team. Save: the keeper's team. */
  team: TeamId;
  ownGoal: boolean;
  half: number;
  /** Seconds into the half. */
  clock: number;
  /** Encoded snapshots, oldest first. */
  frames: Uint8Array[];
}

/** Build-up and tail (ticks) of a clip of this kind. */
export function clipWindow(kind: ClipKind): { before: number; after: number } {
  const [before, after] = kind === 'goal' ? [REPLAY_BUILDUP_SECONDS, REPLAY_TAIL_SECONDS] : [REPLAY_SAVE_BUILDUP_SECONDS, REPLAY_SAVE_TAIL_SECONDS];
  return { before: Math.round(before * SIM_HZ), after: Math.round(after * SIM_HZ) };
}

/** Which events get a clip: goals, and big saves (`save` events are only pushed for big ones). */
export function clipKind(e: MatchEvent): ClipKind | null {
  return e.type === 'goal' ? 'goal' : e.type === 'save' ? 'save' : null;
}

/**
 * The part of a clip worth playing: everything before the moment back to the last dead-ball spell (the previous goal's
 * celebration, half-time), so a goal straight after a kickoff doesn't replay the previous goal first.
 */
export function playableFrames(snaps: readonly Snapshot[], moment: number): Snapshot[] {
  let start = 0;
  for (let i = 0; i < snaps.length; i++) {
    if (snaps[i].tick >= moment) break;
    const p = snaps[i].phase;
    if (p === 'goal-scored' || p === 'half-time' || p === 'full-time') start = i + 1;
  }
  return snaps.slice(start);
}

/**
 * The full-time reel: every goal, and the big saves that aren't already in a goal's build-up, in match order. Capped at
 * REPLAY_MAX_CLIPS (saves are dropped first, then the oldest goals).
 */
export function highlightReel(clips: readonly ReplayClip[]): ReplayClip[] {
  const goals = clips.filter((c) => c.kind === 'goal');
  const before = clipWindow('goal').before;
  const saves = clips.filter((c) => c.kind === 'save' && !goals.some((g) => g.moment >= c.moment && g.moment - c.moment <= before));
  let reel = [...goals, ...saves].sort((a, b) => a.moment - b.moment);
  while (reel.length > REPLAY_MAX_CLIPS) {
    const save = reel.findIndex((c) => c.kind === 'save');
    reel.splice(save >= 0 ? save : 0, 1);
  }
  return reel;
}

/* ---- Timing ----------------------------------------------------------------------------------------- */

/** A clip's playback: ticks start..end, slowed down to `speed` between slowFrom and slowTo. */
export interface ReplayTiming {
  start: number;
  end: number;
  slowFrom: number;
  slowTo: number;
  speed: number;
}

export function replayTiming(start: number, end: number, moment: number): ReplayTiming {
  const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
  const slowFrom = clamp(moment - REPLAY_SLOWMO_SECONDS * SIM_HZ, start, end);
  const slowTo = clamp(moment + REPLAY_SLOWMO_AFTER_SECONDS * SIM_HZ, slowFrom, end);
  return { start, end, slowFrom, slowTo, speed: REPLAY_SLOWMO_SPEED };
}

/** Seconds of real time the clip takes to play. */
export function replayDuration(t: ReplayTiming): number {
  return (t.slowFrom - t.start + (t.slowTo - t.slowFrom) / t.speed + (t.end - t.slowTo)) / SIM_HZ;
}

/** The match tick shown `elapsed` seconds into the playback (holds on the last tick once it's over). */
export function replayTickAt(t: ReplayTiming, elapsed: number): number {
  let e = Math.max(0, elapsed) * SIM_HZ;
  const normal = t.slowFrom - t.start;
  if (e <= normal) return t.start + e;
  e -= normal;
  const slow = (t.slowTo - t.slowFrom) / t.speed;
  if (e <= slow) return t.slowFrom + e * t.speed;
  e -= slow;
  return Math.min(t.end, t.slowTo + e);
}

/** In the slow-motion part at `elapsed`? */
export function replaySlowAt(t: ReplayTiming, elapsed: number): boolean {
  const tick = replayTickAt(t, elapsed);
  return t.slowTo > t.slowFrom && tick > t.slowFrom && tick < t.slowTo;
}

/* ---- Playback --------------------------------------------------------------------------------------- */

/** One clip playing into its own GameState (a copy of the match's, so static player data is right). */
export class ClipPlayback {
  readonly state: GameState;
  readonly timing: ReplayTiming;
  readonly duration: number;
  elapsed = 0;
  private readonly buffer: SnapshotBuffer;

  constructor(readonly clip: ReplayClip, base: GameState) {
    const snaps = clip.frames.map((f) => decodeSnapshot(f)).filter((s): s is Snapshot => !!s && s.players.length === base.players.length);
    const frames = playableFrames(snaps, clip.moment);
    this.buffer = new SnapshotBuffer(Math.max(1, frames.length));
    for (const s of frames) this.buffer.push(s);
    const first = frames[0]?.tick ?? clip.moment;
    const last = frames[frames.length - 1]?.tick ?? clip.moment;
    this.timing = replayTiming(first, last, clip.moment);
    this.duration = frames.length > 1 ? replayDuration(this.timing) : 0;
    this.state = structuredClone(base);
    // Nothing in the replay is "new": no events, so no whistles or banners fire again.
    this.state.events = [];
    this.show();
  }

  get done(): boolean {
    return this.elapsed >= this.duration;
  }

  get slow(): boolean {
    return replaySlowAt(this.timing, this.elapsed);
  }

  /** 0..1 through the clip. */
  get progress(): number {
    return this.duration > 0 ? Math.min(1, this.elapsed / this.duration) : 1;
  }

  advance(dt: number): void {
    this.elapsed = Math.min(this.duration, this.elapsed + Math.max(0, dt));
    this.show();
  }

  private show(): void {
    const sample = this.buffer.sample(replayTickAt(this.timing, this.elapsed));
    if (!sample) return;
    applySnapshot(this.state, sample.snap);
    this.state.tick = Math.floor(sample.snap.tick);
  }
}

/** What MatchScene draws while a replay runs, and what the HUD says about it. */
export interface ReplayView {
  /** 'replay': the instant replay after a goal; 'highlights': the full-time reel. */
  mode: 'replay' | 'highlights';
  /** The state to draw (the replay's own). */
  state: GameState;
  clip: ReplayClip;
  slow: boolean;
  progress: number;
  /** Highlights: this clip's number (1-based) and how many there are. */
  index: number;
  total: number;
}

/* ---- The director ----------------------------------------------------------------------------------- */

/**
 * Records snapshots, cuts clips around goals and big saves, and plays an instant replay or the highlights reel.
 * Both match drivers own one: the host records the snapshots it encodes (also offline), the guest the ones it receives.
 */
export class Replays {
  private readonly ring = new ReplayRing(REPLAY_RING_FRAMES);
  /** Every clip cut this match (for the highlights), oldest first. */
  readonly clips: ReplayClip[] = [];
  /** Goal / save events whose clip isn't complete yet (the tail hasn't been recorded). */
  private waiting: MatchEvent[] = [];
  private lastEventId = 0;
  private playback: ClipPlayback | null = null;
  private mode: ReplayView['mode'] | null = null;
  private reel: ReplayClip[] = [];
  private reelIndex = 0;

  /** A snapshot of the live match (encoded), newest tick last. Cuts any clip whose tail is now in. */
  record(tick: number, frame: Uint8Array): void {
    if (!this.ring.push(tick, frame)) return;
    this.cut(false);
  }

  /** The match's events (any order of arrival; each id is looked at once): goals and big saves get a clip. */
  note(events: readonly MatchEvent[]): void {
    for (const e of events) {
      if (e.id <= this.lastEventId) continue;
      this.lastEventId = e.id;
      if (clipKind(e)) this.waiting.push(e);
    }
    this.cut(false);
  }

  /** The clip of the goal at `moment`; one still waiting for its tail is cut now with what there is. */
  clipFor(moment: number): ReplayClip | undefined {
    if (this.waiting.some((e) => e.tick === moment)) this.cut(true);
    return this.clips.find((c) => c.kind === 'goal' && c.moment === moment);
  }

  /** Cuts the clips whose window has been recorded (or all of them, `force`). */
  private cut(force: boolean): void {
    const newest = this.ring.newestTick;
    this.waiting = this.waiting.filter((e) => {
      const kind = clipKind(e)!;
      const { before, after } = clipWindow(kind);
      if (!force && newest < e.tick + after) return true;
      const frames = this.ring.range(e.tick - before, e.tick + after).map((f) => f.frame);
      if (frames.length > 1) {
        this.clips.push({ kind, moment: e.tick, team: e.team ?? 0, ownGoal: !!e.ownGoal, half: e.half, clock: e.clock, frames });
        if (this.clips.length > REPLAY_MAX_CLIPS * 2) {
          // A very long match: drop the oldest save (or else the oldest goal) to bound memory.
          const save = this.clips.findIndex((c) => c.kind === 'save');
          this.clips.splice(save >= 0 ? save : 0, 1);
        }
      }
      return false;
    });
  }

  get active(): boolean {
    return this.mode !== null;
  }

  get playingMode(): ReplayView['mode'] | null {
    return this.mode;
  }

  /** The instant replay of the goal at `moment`, drawn over a copy of `base`. False if there's no clip for it. */
  startReplay(moment: number, base: GameState): boolean {
    const clip = this.clipFor(moment);
    if (!clip) return false;
    this.playback = new ClipPlayback(clip, base);
    this.mode = 'replay';
    return true;
  }

  /** The full-time highlights. False if there is nothing to show. */
  startHighlights(base: GameState): boolean {
    this.cut(true);
    this.reel = highlightReel(this.clips);
    if (this.reel.length === 0) return false;
    this.reelIndex = 0;
    this.mode = 'highlights';
    this.playback = new ClipPlayback(this.reel[0], base);
    return true;
  }

  /** Advances the playback by `dt` seconds of real time; the replay ends, or the reel moves on, when a clip is done. */
  update(dt: number): void {
    const pb = this.playback;
    if (!pb) return;
    pb.advance(dt);
    if (!pb.done) return;
    if (this.mode === 'highlights' && this.reelIndex + 1 < this.reel.length) {
      this.reelIndex++;
      this.playback = new ClipPlayback(this.reel[this.reelIndex], pb.state);
    } else this.stop();
  }

  /** Ends whatever is playing (the instant replay, or the whole highlights reel). */
  stop(): void {
    this.playback = null;
    this.mode = null;
    this.reel = [];
  }

  view(): ReplayView | null {
    const pb = this.playback;
    if (!pb || !this.mode) return null;
    const reel = this.mode === 'highlights';
    return { mode: this.mode, state: pb.state, clip: pb.clip, slow: pb.slow, progress: pb.progress, index: reel ? this.reelIndex + 1 : 1, total: reel ? this.reel.length : 1 };
  }

  /** A new match: forget everything. */
  clear(): void {
    this.stop();
    this.ring.clear();
    this.clips.length = 0;
    this.waiting = [];
    this.lastEventId = 0;
  }
}

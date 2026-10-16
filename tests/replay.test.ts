// T23: the replay ring buffer, clip cutting and timing, and an offline match holding its kickoff for the replay.
import { describe, expect, it } from 'vitest';
import {
  GOAL_PAUSE,
  PITCH_BOTTOM,
  PITCH_RIGHT,
  PITCH_TOP,
  REPLAY_BUILDUP_SECONDS,
  REPLAY_MAX_CLIPS,
  REPLAY_SLOWMO_AFTER_SECONDS,
  REPLAY_SLOWMO_SECONDS,
  REPLAY_SLOWMO_SPEED,
  SIM_DT,
  SIM_HZ,
} from '../src/config';
import { HostMatch } from '../src/net/host';
import {
  ClipPlayback,
  highlightReel,
  playableFrames,
  REPLAY_RING_FRAMES,
  Replays,
  ReplayRing,
  replayDuration,
  replaySlowAt,
  replayTickAt,
  replayTiming,
  type ReplayClip,
} from '../src/net/replay';
import { encodeSnapshot, takeSnapshot, type Snapshot } from '../src/net/snapshot';
import { createInitialState, NEUTRAL_INPUT, step } from '../src/sim/simulation';
import type { GameState, MatchPhase } from '../src/sim/types';

const frame = (tick: number, size = 8): Uint8Array => new Uint8Array(size).fill(tick & 255);
const NET = { ack: -1, paused: false, resumeIn: 0 };

describe('ReplayRing', () => {
  it('keeps frames oldest first and refuses ticks that are not newer', () => {
    const ring = new ReplayRing(4);
    expect(ring.push(10, frame(10))).toBe(true);
    expect(ring.push(12, frame(12))).toBe(true);
    expect(ring.push(12, frame(12))).toBe(false); // duplicate
    expect(ring.push(11, frame(11))).toBe(false); // late, out of order (a guest's lost-then-found packet)
    expect(ring.push(13, new Uint8Array(0))).toBe(false);
    expect(ring.range(0, 99).map((f) => f.tick)).toEqual([10, 12]);
    expect([ring.oldestTick, ring.newestTick, ring.length]).toEqual([10, 12, 2]);
  });

  it('overwrites the oldest frames once full, keeping exactly the newest `capacity`', () => {
    const ring = new ReplayRing(5);
    for (let t = 0; t < 23; t++) ring.push(t * 2, frame(t * 2));
    expect(ring.length).toBe(5);
    expect(ring.range(-Infinity, Infinity).map((f) => f.tick)).toEqual([36, 38, 40, 42, 44]);
    expect(ring.range(38, 42).map((f) => f.tick)).toEqual([38, 40, 42]);
    for (const f of ring.range(0, 99)) expect(f.frame.every((b) => b === (f.tick & 255))).toBe(true);
  });

  it('hands out copies (the slab is reused) and grows its slots for bigger frames', () => {
    const ring = new ReplayRing(3, 4);
    ring.push(1, frame(1, 4));
    const copy = ring.range(1, 1)[0].frame;
    ring.push(2, frame(2, 10)); // bigger than a slot: re-laid
    ring.push(3, frame(3, 6));
    ring.push(4, frame(4, 4)); // overwrites tick 1's slot
    expect(copy).toEqual(frame(1, 4));
    expect(ring.range(0, 9).map((f) => [f.tick, f.frame.length])).toEqual([[2, 10], [3, 6], [4, 4]]);
    expect(ring.bytes).toBe(3 * 10);
  });

  it('holds ~6 s of real snapshots in a small preallocated slab', () => {
    const s = createInitialState();
    const bytes = encodeSnapshot(takeSnapshot(s, NET));
    const ring = new ReplayRing(REPLAY_RING_FRAMES, bytes.length);
    for (let t = 0; t < REPLAY_RING_FRAMES * 3; t += 1) ring.push(t * 2, bytes);
    expect(((ring.newestTick - ring.oldestTick) / SIM_HZ)).toBeGreaterThanOrEqual(6);
    expect(ring.bytes).toBeLessThan(64 * 1024); // vs. ~1 MB for the same seconds of GameState copies
  });

  it('clear() empties it', () => {
    const ring = new ReplayRing(3);
    ring.push(5, frame(5));
    ring.clear();
    expect(ring.length).toBe(0);
    expect(ring.push(1, frame(1))).toBe(true); // ticks may start again (a rematch)
  });
});

describe('replay timing', () => {
  const moment = 1000;
  const t = replayTiming(moment - 300, moment + 60, moment);

  it('plays the build-up at normal speed and the last second (and a moment after) in slow motion', () => {
    expect(t.slowFrom).toBe(moment - REPLAY_SLOWMO_SECONDS * SIM_HZ);
    expect(t.slowTo).toBe(moment + REPLAY_SLOWMO_AFTER_SECONDS * SIM_HZ);
    const normal = (300 - REPLAY_SLOWMO_SECONDS * SIM_HZ + 60 - REPLAY_SLOWMO_AFTER_SECONDS * SIM_HZ) / SIM_HZ;
    const slow = (REPLAY_SLOWMO_SECONDS + REPLAY_SLOWMO_AFTER_SECONDS) / REPLAY_SLOWMO_SPEED;
    expect(replayDuration(t)).toBeCloseTo(normal + slow, 9);
  });

  it('maps elapsed time to ticks: starts at the start, never goes backwards, ends on the end and holds there', () => {
    const d = replayDuration(t);
    expect(replayTickAt(t, 0)).toBe(t.start);
    expect(replayTickAt(t, -1)).toBe(t.start);
    let last = -Infinity;
    for (let e = 0; e <= d; e += 1 / 120) {
      const tick = replayTickAt(t, e);
      expect(tick).toBeGreaterThanOrEqual(last);
      last = tick;
    }
    expect(replayTickAt(t, d)).toBeCloseTo(t.end, 6);
    expect(replayTickAt(t, d + 5)).toBe(t.end);
  });

  it('runs at REPLAY_SLOWMO_SPEED only around the moment', () => {
    const intoSlow = (t.slowFrom - t.start) / SIM_HZ + 0.5;
    const rate = (replayTickAt(t, intoSlow + 0.1) - replayTickAt(t, intoSlow)) / (0.1 * SIM_HZ);
    expect(rate).toBeCloseTo(REPLAY_SLOWMO_SPEED, 9);
    expect(replaySlowAt(t, intoSlow)).toBe(true);
    expect(replaySlowAt(t, 1)).toBe(false);
    expect(replaySlowAt(t, replayDuration(t))).toBe(false);
    // The goal itself is shown slowed down.
    const atMoment = (t.slowFrom - t.start) / SIM_HZ + (moment - t.slowFrom) / SIM_HZ / REPLAY_SLOWMO_SPEED;
    expect(replayTickAt(t, atMoment)).toBeCloseTo(moment, 9);
  });

  it('copes with a clip shorter than the slow-motion window', () => {
    const short = replayTiming(990, 1005, 1000);
    expect(short.slowFrom).toBe(990);
    expect(short.slowTo).toBe(1005);
    expect(replayDuration(short)).toBeCloseTo(15 / SIM_HZ / REPLAY_SLOWMO_SPEED, 9);
  });
});

describe('clips', () => {
  const snap = (tick: number, phase: MatchPhase): Snapshot => ({ ...takeSnapshot(createInitialState(), NET), tick, phase });

  it("starts a goal's replay after the previous dead-ball spell, so a quick goal doesn't replay the last one", () => {
    const snaps = [snap(0, 'playing'), snap(2, 'goal-scored'), snap(4, 'goal-scored'), snap(6, 'pre-kickoff'), snap(8, 'playing'), snap(10, 'goal-scored'), snap(12, 'goal-scored')];
    expect(playableFrames(snaps, 10).map((s) => s.tick)).toEqual([6, 8, 10, 12]);
    expect(playableFrames(snaps.slice(4), 10).map((s) => s.tick)).toEqual([8, 10, 12]);
  });

  const clip = (kind: ReplayClip['kind'], moment: number): ReplayClip => ({ kind, moment, team: 0, ownGoal: false, player: -1, half: 1, clock: moment / SIM_HZ, frames: [] });

  it('highlights: every goal and the big saves outside a goal build-up, in match order', () => {
    const buildup = REPLAY_BUILDUP_SECONDS * SIM_HZ;
    const reel = highlightReel([clip('goal', 5000), clip('save', 1000), clip('save', 5000 - buildup / 2), clip('goal', 3000), clip('save', 9000)]);
    expect(reel.map((c) => `${c.kind}@${c.moment}`)).toEqual(['save@1000', 'goal@3000', 'goal@5000', 'save@9000']);
  });

  it('highlights are capped, dropping saves before goals', () => {
    const many = [...Array.from({ length: REPLAY_MAX_CLIPS }, (_, i) => clip('goal', 10_000 * (i + 1))), clip('save', 5)];
    const reel = highlightReel(many);
    expect(reel.length).toBe(REPLAY_MAX_CLIPS);
    expect(reel.every((c) => c.kind === 'goal')).toBe(true);
  });
});

/* ---- Recording a real match ------------------------------------------------------------------------ */

/** Puts the ball just over the right goal line, between the posts: the next step scores. */
function forceGoal(s: GameState): void {
  s.restart = null;
  s.possession = null;
  s.penalty = null;
  s.ball.pos = { x: PITCH_RIGHT + s.ball.radius + 4, y: (PITCH_TOP + PITCH_BOTTOM) / 2 };
  s.ball.vel = { x: 250, y: 0 };
}

const tickOnce = (m: HostMatch): void => m.advance(SIM_DT, () => NEUTRAL_INPUT, 0);
function runFor(m: HostMatch, seconds: number, until?: (m: HostMatch) => boolean): number {
  for (let i = 0; i < Math.round(seconds * SIM_HZ); i++) {
    if (until?.(m)) return i / SIM_HZ;
    tickOnce(m);
  }
  return seconds;
}

/** An offline match a few seconds in, then a goal. Returns the goal's tick. */
function matchWithGoal(m: HostMatch): number {
  runFor(m, 5);
  expect(m.state.phase).toBe('playing');
  forceGoal(m.state);
  runFor(m, 1, (x) => x.state.phase === 'goal-scored');
  expect(m.state.phase).toBe('goal-scored');
  return m.state.events.filter((e) => e.type === 'goal').at(-1)!.tick;
}

describe('instant replay (offline host)', () => {
  it('after a goal: the replay starts as the goal pause ends, the match is held (no clock, no kickoff) until it ends', () => {
    const m = new HostMatch({ localTeam: 0, seed: 3, replays: 'goals' });
    const goalTick = matchWithGoal(m);
    const waited = runFor(m, GOAL_PAUSE + 1, (x) => x.replay() !== null);
    expect(waited).toBeCloseTo(GOAL_PAUSE - SIM_DT, 1);
    const view = m.replay()!;
    expect(view.mode).toBe('replay');
    expect(view.clip.kind).toBe('goal');
    expect(view.clip.moment).toBe(goalTick);
    expect(view.clip.team).toBe(0); // team 0 attacks the right goal in the first half

    // Held: nothing in the live match moves while the replay plays.
    const held = { tick: m.state.tick, clock: m.state.clock, phase: m.state.phase, timer: m.state.phaseTimer };
    let sawSlow = false;
    let sawGoalMoment = false;
    const length = runFor(m, 20, (x) => {
      const v = x.replay();
      if (!v) return true;
      sawSlow ||= v.slow;
      sawGoalMoment ||= v.state.ball.pos.x > PITCH_RIGHT; // the replay shows the ball going in
      expect({ tick: x.state.tick, clock: x.state.clock, phase: x.state.phase, timer: x.state.phaseTimer }).toEqual(held);
      return false;
    });
    expect(sawSlow).toBe(true);
    expect(sawGoalMoment).toBe(true);
    // Build-up at normal speed, then the slow-motion seconds.
    const expected = replayDuration(replayTiming(goalTick - REPLAY_BUILDUP_SECONDS * SIM_HZ, goalTick + SIM_HZ, goalTick));
    expect(length).toBeGreaterThan(expected - 0.8);
    expect(length).toBeLessThan(expected + 0.2);

    // Then, within a tick or two (the goal pause's last tick), the kickoff, and the clock runs again once it is taken.
    runFor(m, 0.1, (x) => x.state.phase !== 'goal-scored');
    expect(m.state.phase).toBe('pre-kickoff');
    expect(m.state.tick - held.tick).toBeLessThanOrEqual(2);
    runFor(m, 3);
    expect(m.state.clock).toBeGreaterThan(held.clock);
    expect(m.replay()).toBeNull();
  });

  it('a skip ends it at once, and the kickoff follows; each goal is replayed only once', () => {
    const m = new HostMatch({ localTeam: 0, seed: 4, replays: 'goals' });
    matchWithGoal(m);
    runFor(m, GOAL_PAUSE + 1, (x) => x.replay() !== null);
    expect(m.replay()).not.toBeNull();
    runFor(m, 0.5);
    m.skipReplay();
    expect(m.replay()).toBeNull();
    const tick = m.state.tick;
    runFor(m, 0.1, (x) => x.state.phase !== 'goal-scored');
    expect(m.state.phase).toBe('pre-kickoff');
    expect(m.state.tick - tick).toBeLessThanOrEqual(2);
    runFor(m, 2);
    expect(m.replay()).toBeNull();
  });

  it('with replays off the kickoff comes after the goal pause, as before', () => {
    const m = new HostMatch({ localTeam: 0, seed: 3, replays: 'off' });
    matchWithGoal(m);
    const waited = runFor(m, GOAL_PAUSE + 1, (x) => x.state.phase !== 'goal-scored');
    expect(waited).toBeCloseTo(GOAL_PAUSE, 1);
    expect(m.replay()).toBeNull();
  });

  it('full-time highlights: every goal of the match, skippable', () => {
    const m = new HostMatch({ localTeam: 0, seed: 5, replays: 'all' });
    matchWithGoal(m);
    runFor(m, GOAL_PAUSE + 1, (x) => x.replay() !== null);
    m.skipReplay();
    runFor(m, 6);
    forceGoal(m.state);
    runFor(m, 1, (x) => x.state.phase === 'goal-scored');
    runFor(m, GOAL_PAUSE + 1, (x) => x.replay() !== null);
    m.skipReplay();
    // To the end of the match.
    expect(m.startHighlights()).toBe(false); // not over yet
    m.state.half = 2;
    m.state.clock = m.state.halfLength - 0.5;
    runFor(m, 4, (x) => x.state.phase === 'full-time');
    expect(m.state.phase).toBe('full-time');
    expect(m.startHighlights()).toBe(true);
    const v = m.replay()!;
    expect(v.mode).toBe('highlights');
    expect(v.total).toBeGreaterThanOrEqual(2);
    expect(v.index).toBe(1);
    // The reel moves on to the second clip by itself; a key skips the rest.
    runFor(m, 30, (x) => (x.replay()?.index ?? 0) >= 2);
    expect(m.replay()?.index).toBe(2);
    m.skipReplay();
    expect(m.replay()).toBeNull();
  });
});

describe('Replays (the guest records the snapshots it receives)', () => {
  it('cuts the same clip from received snapshots, out-of-order ones dropped, and plays the goal back', () => {
    let s = createInitialState();
    const replays = new Replays();
    const received: { tick: number; bytes: Uint8Array }[] = [];
    for (let i = 0; i < 240; i++) {
      if (i === 200) forceGoal(s);
      s = step(s, [], SIM_DT);
      if (s.tick % 2 === 0) received.push({ tick: s.tick, bytes: encodeSnapshot(takeSnapshot(s, NET)) });
    }
    // Snapshots arrive with some swapped and lost; events come on the reliable channel.
    for (let i = 0; i + 1 < received.length; i += 7) [received[i], received[i + 1]] = [received[i + 1], received[i]];
    for (const r of received.filter((_, i) => i % 11 !== 5)) replays.record(r.tick, r.bytes);
    replays.note(s.events);
    const goal = s.events.find((e) => e.type === 'goal')!;
    expect(goal).toBeDefined();
    const clip = replays.clipFor(goal.tick)!;
    expect(clip.frames.length).toBeGreaterThan(50);

    const pb = new ClipPlayback(clip, s);
    const t = pb.timing;
    expect(t.start).toBeLessThan(goal.tick - 3 * SIM_HZ);
    const atGoal = (t.slowFrom - t.start) / SIM_HZ + (goal.tick - t.slowFrom) / SIM_HZ / t.speed;
    pb.advance(atGoal + 0.05);
    expect(pb.state.ball.pos.x).toBeGreaterThan(PITCH_RIGHT);
    expect(pb.slow).toBe(true);
    expect(pb.state.events).toEqual([]); // nothing in a replay fires events again
    expect(s.ball.pos.x).toBeGreaterThan(PITCH_RIGHT); // and the live state wasn't touched (it is a copy)
  });
});

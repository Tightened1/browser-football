// T13: the online guest sees the ball its own predicted player carries without lag or rubber-banding, its kicks
// leave the foot at once, and the host's version wins. The real GuestMatch, against the real sim, over a fake
// link with simulated latency and packet loss (no PeerJS, no browser).
import { describe, expect, it, vi } from 'vitest';
import { BALL_RADIUS, KICK_REACH, NET_SNAPSHOT_INTERVAL_TICKS, PITCH_HEIGHT, PITCH_TOP, PLAYER_RADIUS, SIM_DT } from '../src/config';
import { createMatchState, NEUTRAL_INPUT, step } from '../src/sim/simulation';
import type { GameState, InputFrame } from '../src/sim/types';
import { decodeInputs, encodeSnapshot, mergeInputs, takeSnapshot } from '../src/net/snapshot';

vi.stubGlobal('window', { location: { search: '' }, addEventListener: () => {}, removeEventListener: () => {} });
const { GuestMatch } = await import('../src/net/client');
type GuestLobby = ConstructorParameters<typeof GuestMatch>[0];

const midY = PITCH_TOP + PITCH_HEIGHT / 2;
const CONTACT = PLAYER_RADIUS + BALL_RADIUS;

interface Run {
  /** Per drawn frame: the guest's own player and the ball as drawn, and who the host says has the ball. */
  /** `seq`: input frames sampled so far (the guest steps 0-2 fixed ticks per drawn frame). */
  frames: { seq: number; px: number; py: number; bx: number; by: number; drawnPoss: number; hostPoss: number }[];
  host: GameState;
}

/**
 * Host and guest at 60 Hz with `latencyMs` one way and `loss` of the (unreliable) snapshots dropped. The guest
 * controls away player 9, starting with the ball; `script(n)` is its keyboard for its n-th input frame. Other players
 * are kept far away.
 */
function play(latencyMs: number, loss: number, ticks: number, script: (n: number) => Partial<InputFrame>, onHost?: (host: GameState, tick: number) => void): Run {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  let host = createMatchState({ humans: [true, true], seed: 5 });
  host.phase = 'playing';
  host.phaseTimer = 0;
  // The guest's player in open space with the ball at its feet; everyone else parked far away.
  const me = host.players[9];
  me.pos = { x: 700, y: midY };
  me.facing = Math.PI;
  host.ball.pos = { x: 700 - CONTACT - 2, y: midY };
  const park = (s: GameState): void =>
    s.players.forEach((p, i) => {
      if (i === 9) return;
      p.pos = { x: 200 + i * 80, y: PITCH_TOP + 20 };
      p.vel = { x: 0, y: 0 };
    });
  park(host);
  host.controlled = [-1, 9];

  const toHost: { at: number; bytes: Uint8Array }[] = [];
  const toGuest: { at: number; bytes: Uint8Array }[] = [];
  const link = { onFast: (_b: Uint8Array) => {}, sendFast: (bytes: Uint8Array) => toHost.push({ at: now + latencyMs, bytes }) };
  const lobby = {
    view: { status: 'connected', rematch: { mine: false, theirs: false }, pingMs: latencyMs * 2 },
    matchLink: link,
    onMatchMessage: () => {},
    lastEventId: () => 0,
    onRestart: () => {},
    requestRematch: () => {},
  } as unknown as GuestLobby;
  const guest = new GuestMatch(lobby, 1, 180, 5);

  let queue: InputFrame[] = [];
  let last: InputFrame = { ...NEUTRAL_INPUT };
  let lastSeq = -1;
  let ack = -1;
  let seq = 0;
  let dropped = 0;
  const frames: Run['frames'] = [];
  for (let t = 0; t < ticks; t++) {
    now += SIM_DT * 1000;
    // Deliveries due now.
    while (toHost.length && toHost[0].at <= now) {
      for (const f of decodeInputs(toHost.shift()!.bytes)!) if (f.seq > lastSeq) {
        lastSeq = f.seq;
        queue.push(f);
      }
    }
    while (toGuest.length && toGuest[0].at <= now) link.onFast(toGuest.shift()!.bytes);
    // Host tick (as HostMatch does it).
    while (queue.length > 3) queue = [mergeInputs(queue[0], queue[1]), ...queue.slice(2)];
    const f = queue.shift();
    if (f) {
      last = f;
      ack = f.seq;
    }
    host = step(host, [undefined, last], SIM_DT);
    host.controlled = [-1, 9];
    park(host);
    onHost?.(host, t);
    if (host.tick % NET_SNAPSHOT_INTERVAL_TICKS === 0) {
      // Deterministic "random" loss.
      if ((dropped = (dropped + loss) % 1) < loss) continue;
      toGuest.push({ at: now + latencyMs, bytes: encodeSnapshot(takeSnapshot(host, { ack, paused: false, resumeIn: 0 })) });
    }
    // Guest frame.
    guest.advance(SIM_DT, () => ({ ...NEUTRAL_INPUT, ...script(seq), seq: seq++ }), now);
    const s = guest.state;
    const p = s.players[9];
    frames.push({ seq, px: p.pos.x, py: p.pos.y, bx: s.ball.pos.x, by: s.ball.pos.y, drawnPoss: s.possession?.player ?? -1, hostPoss: host.possession?.player ?? -1 });
  }
  vi.restoreAllMocks();
  return { frames, host };
}

const jump = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe('guest prediction of its own dribble (100 ms one way, 3% snapshot loss)', () => {
  // Run left with the ball for 1.5 s, turn up for 1 s, run right, charge a shot and release it on input frame SHOT.
  const SHOT = 225;
  const script = (n: number): Partial<InputFrame> =>
    n < 90 ? { moveX: -1 } : n < 150 ? { moveY: -1 } : n < 200 ? { moveX: 1 } : n < SHOT ? { moveX: 1, shoot: true } : { moveX: 1 };
  // Stop before the shot reaches the (empty) goal.
  const run = play(100, 0.03, 268, script);
  const shot = run.frames.findIndex((f) => f.seq > SHOT); // the first drawn frame that includes the release

  it('the host really carried the ball the whole time until the shot', () => {
    for (let t = 20; t < shot - 1; t++) expect(run.frames[t].hostPoss).toBe(9);
  });

  it("draws the held ball at the predicted player's feet: no lag behind them", () => {
    // From the first snapshots (two latencies plus the interpolation delay) until the shot.
    for (let t = 30; t < shot; t++) {
      const f = run.frames[t];
      const gap = Math.hypot(f.bx - f.px, f.by - f.py) - CONTACT;
      expect(gap).toBeLessThanOrEqual(KICK_REACH + 1);
      expect(gap).toBeGreaterThan(-3);
    }
  });

  it('nothing rubber-bands: the drawn player and ball move smoothly frame to frame', () => {
    for (let t = 31; t < run.frames.length; t++) {
      const a = run.frames[t - 1];
      const b = run.frames[t];
      expect(jump({ x: a.px, y: a.py }, { x: b.px, y: b.py })).toBeLessThan(8); // top speed is ~3.8 px a frame
      expect(jump({ x: a.bx, y: a.by }, { x: b.bx, y: b.by })).toBeLessThan(t >= shot ? 25 : 8);
    }
  });

  it('the shot leaves the foot on the frame it is released, and keeps going forwards', () => {
    expect(run.frames[shot].bx - run.frames[shot - 1].bx).toBeGreaterThan(8); // straight away on the guest's screen
    for (let t = shot + 1; t < run.frames.length; t++) expect(run.frames[t].bx).toBeGreaterThan(run.frames[t - 1].bx); // never goes back
    // ...and ends up drawn where the host has it (the drawn match is ~100 ms behind the host).
    const end = run.frames[run.frames.length - 1];
    expect(Math.abs(end.bx - run.host.ball.pos.x)).toBeLessThan(140);
  });
});

describe('guest prediction: the host wins a dispute', () => {
  // The guest runs left with the ball; on the host, at tick 120, the ball is knocked away (as a tackle would).
  const run = play(100, 0.03, 260, () => ({ moveX: -1 }), (host, t) => {
    if (t !== 120) return;
    host.possession = null;
    host.players[9].touchTimer = 1;
    host.ball.vel = { x: 0, y: 250 }; // (stays in play: a throw-in would switch prediction off)
  });

  it("stops predicting the ball, without jumps, and ends up drawing the host's", () => {
    for (let t = 31; t < run.frames.length; t++) {
      const a = run.frames[t - 1];
      const b = run.frames[t];
      expect(jump({ x: a.bx, y: a.by }, { x: b.bx, y: b.by })).toBeLessThan(16);
      expect(jump({ x: a.px, y: a.py }, { x: b.px, y: b.py })).toBeLessThan(8);
    }
    const end = run.frames[run.frames.length - 1];
    expect(end.drawnPoss).not.toBe(9);
    expect(Math.abs(end.by - run.host.ball.pos.y)).toBeLessThan(80);
    expect(end.by).toBeGreaterThan(midY + 60); // it went where the host knocked it
  });
});

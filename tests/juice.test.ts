import { describe, expect, it } from 'vitest';
import { BallCueDetector, crowdExcitement, eventSound, kickPower, scanEvents } from '../src/audio/cues';
import { CAMERA_MAX_LOOKAHEAD, FX_RIPPLE_SECONDS, PITCH_LEFT, PITCH_RIGHT, POST_RADIUS, BALL_RADIUS } from '../src/config';
import { approach, ballLift, cameraTarget, Effects, netBox, netGrid, netOffset } from '../src/render/effects';
import { BOUNDARY } from '../src/sim/physics';
import { defaultSettings, sanitizeSettings } from '../src/settings';
import type { MatchEvent } from '../src/sim/types';

const posts = BOUNDARY.posts.map((p) => p.pos);
const ball = (x: number, y: number, vx: number, vy: number) => ({ pos: { x, y }, vel: { x: vx, y: vy }, radius: BALL_RADIUS });
const event = (id: number, type: MatchEvent['type']): MatchEvent => ({ id, tick: id, type, half: 1, clock: 0, score: [0, 0] });

describe('ball cues', () => {
  it('hears a kick, louder for a harder one', () => {
    const soft = new BallCueDetector();
    soft.update(ball(500, 300, 0, 0), 1 / 60, posts);
    const s = soft.update(ball(500, 300, 450, 0), 1 / 60, posts);
    const hard = new BallCueDetector();
    hard.update(ball(500, 300, 0, 0), 1 / 60, posts);
    const h = hard.update(ball(500, 300, 1100, 0), 1 / 60, posts);
    expect(s?.type).toBe('kick');
    expect(h?.type).toBe('kick');
    expect(h!.power).toBeGreaterThan(s!.power);
    expect(h!.dir.x).toBeCloseTo(1);
  });

  it('ignores a rolling ball and friction', () => {
    const d = new BallCueDetector();
    let v = 600;
    for (let i = 0; i < 60; i++) {
      v -= 10;
      expect(d.update(ball(400 + i * 8, 300, v, 0), 1 / 60, posts)).toBeNull();
    }
  });

  it('ignores a teleport (kickoff reset)', () => {
    const d = new BallCueDetector();
    d.update(ball(100, 100, 800, 0), 1 / 60, posts);
    expect(d.update(ball(600, 400, 0, 0), 1 / 60, posts)).toBeNull();
  });

  it('calls a bounce next to a post a post hit', () => {
    const post = posts[0];
    const d = new BallCueDetector();
    d.update(ball(post.x + BALL_RADIUS + POST_RADIUS + 2, post.y, -800, 0), 1 / 60, posts);
    const cue = d.update(ball(post.x + BALL_RADIUS + POST_RADIUS + 2, post.y, 600, 0), 1 / 60, posts);
    expect(cue?.type).toBe('post');
  });

  it('calls a thud behind the goal line a net hit', () => {
    const d = new BallCueDetector();
    d.update(ball(PITCH_LEFT - 20, 410, -700, 0), 1 / 60, posts);
    expect(d.update(ball(PITCH_LEFT - 20, 410, 100, 0), 1 / 60, posts)?.type).toBe('net');
  });

  it('does not repeat itself within the cooldown, and still catches a kick spread over two frames', () => {
    const d = new BallCueDetector();
    d.update(ball(500, 300, 0, 0), 1 / 60, posts);
    expect(d.update(ball(500, 300, 200, 0), 1 / 60, posts)).toBeNull(); // half of a guest's interpolated kick: too small alone
    expect(d.update(ball(502, 300, 700, 0), 1 / 60, posts)?.type).toBe('kick');
    expect(d.update(ball(510, 300, 900, 0), 1 / 60, posts)).toBeNull();
  });

  it('maps speed to power', () => {
    expect(kickPower(0)).toBe(0);
    expect(kickPower(5000)).toBe(1);
    expect(kickPower(700)).toBeGreaterThan(kickPower(400));
  });
});

describe('events', () => {
  it('only reports events not seen before', () => {
    const list = [event(1, 'kickoff'), event(2, 'goal')];
    const a = scanEvents(list, 0);
    expect(a.fresh.map((e) => e.id)).toEqual([1, 2]);
    expect(scanEvents(list, a.lastId).fresh).toEqual([]);
    expect(scanEvents([...list, event(3, 'half-time')], a.lastId).fresh.map((e) => e.id)).toEqual([3]);
  });

  it('treats everything as new when a match restarts and the ids begin again', () => {
    const a = scanEvents([event(1, 'kickoff'), event(7, 'goal')], 0);
    const b = scanEvents([event(1, 'kickoff')], a.lastId, true);
    expect(b.fresh.map((e) => e.id)).toEqual([1]);
    expect(b.lastId).toBe(1);
  });

  it('knows which events make a sound', () => {
    expect(eventSound(event(1, 'goal'))).toBe('goal');
    expect(eventSound(event(1, 'kickoff'))).toBe('whistle-short');
    expect(eventSound(event(1, 'half-time'))).toBe('whistle-half');
    expect(eventSound(event(1, 'full-time'))).toBe('whistle-full');
    expect(eventSound(event(1, 'throw-in'))).toBeNull();
  });

  it('gets the crowd going near a goal', () => {
    expect(crowdExcitement(PITCH_LEFT + 20, 0, PITCH_LEFT, PITCH_RIGHT)).toBeGreaterThan(crowdExcitement((PITCH_LEFT + PITCH_RIGHT) / 2, 0, PITCH_LEFT, PITCH_RIGHT));
  });
});

describe('visual effects', () => {
  it('lifts only fast balls', () => {
    expect(ballLift(100)).toBe(0);
    expect(ballLift(1400)).toBe(1);
    expect(ballLift(800)).toBeGreaterThan(0);
  });

  it('ripples the net, pinned on the goal line and gone by the end', () => {
    const box = netBox(-1);
    const rp = { side: -1 as const, x: box.x0 + 10, y: (box.y0 + box.y1) / 2, age: 0.12, strength: 1 };
    const centre = netOffset(rp, box.x0 + 8, (box.y0 + box.y1) / 2);
    expect(Math.abs(centre.x)).toBeGreaterThan(1);
    expect(netOffset(rp, box.x1, (box.y0 + box.y1) / 2).x).toBeCloseTo(0, 6); // on the goal line
    expect(netOffset(rp, box.x0 + 8, box.y0).x).toBeCloseTo(0, 6); // on the side edge
    expect(netOffset({ ...rp, age: FX_RIPPLE_SECONDS }, box.x0 + 8, (box.y0 + box.y1) / 2).x).toBeCloseTo(0, 6);
  });

  it('builds a net grid that is still when nothing ripples', () => {
    const still = netGrid(1, []);
    const moving = netGrid(1, [{ side: 1, x: PITCH_RIGHT + 20, y: 340, age: 0.1, strength: 1 }]);
    expect(still.pts.length).toBe(still.cols * still.rows);
    expect(moving.pts.some((p, i) => p.x !== still.pts[i].x)).toBe(true);
  });

  it('spawns, ages and removes particles, within a cap', () => {
    const fx = new Effects();
    fx.dust(100, 100, { x: 1, y: 0 }, 1);
    fx.confetti(100, 100, [0xff0000], 1000);
    expect(fx.particles.length).toBeLessThanOrEqual(300);
    fx.ripple(PITCH_RIGHT + 10, 340, 1);
    expect(fx.netsMoving).toBe(true);
    for (let i = 0; i < 200; i++) fx.update(0.02);
    expect(fx.particles.length).toBe(0);
    expect(fx.netsMoving).toBe(false);
  });

  it('aims the camera ahead of the ball, within a cap', () => {
    const t = cameraTarget({ pos: { x: 500, y: 300 }, vel: { x: 100, y: 0 } });
    expect(t.x).toBeGreaterThan(500);
    const far = cameraTarget({ pos: { x: 500, y: 300 }, vel: { x: 5000, y: 0 } });
    expect(far.x - 500).toBeCloseTo(CAMERA_MAX_LOOKAHEAD);
  });

  it('approaches a target without overshooting, whatever the frame rate', () => {
    expect(approach(0, 10, 4, 0)).toBe(0);
    const slow = approach(approach(0, 10, 4, 1 / 30), 10, 4, 1 / 30);
    const fast = approach(0, 10, 4, 1 / 15);
    expect(slow).toBeCloseTo(fast, 6);
    expect(approach(0, 10, 4, 100)).toBeLessThanOrEqual(10);
  });
});

describe('camera setting', () => {
  it('defaults to auto and rejects unknown values', () => {
    expect(defaultSettings().camera).toBe('auto');
    expect(sanitizeSettings({ camera: 'follow' }).camera).toBe('follow');
    expect(sanitizeSettings({ camera: 'sideways' }).camera).toBe('auto');
  });
});

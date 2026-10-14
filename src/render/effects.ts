// Render-side visual effects: dust and confetti particles, the net ripple, the fake "height" of a hard shot and the
// camera's aim point. Pure maths plus small state (no Phaser calls except the draw helpers' Graphics argument), so it
// can be unit-tested. Nothing here reads or changes the simulation except through the arguments it is given.
import {
  CAMERA_LOOKAHEAD,
  CAMERA_MAX_LOOKAHEAD,
  FX_DUST_COLOR,
  FX_LIFT_MAX_SPEED,
  FX_LIFT_MIN_SPEED,
  FX_MAX_PARTICLES,
  FX_RIPPLE_AMPLITUDE,
  FX_RIPPLE_SECONDS,
  GOAL_DEPTH,
  GOAL_WIDTH,
  NET_CELL,
  PITCH_BOTTOM,
  PITCH_LEFT,
  PITCH_RIGHT,
  PITCH_TOP,
} from '../config';
import type { Vec2 } from '../sim/types';

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds lived and total lifetime. */
  age: number;
  life: number;
  size: number;
  /** Size added per second (dust puffs grow as they fade). */
  grow: number;
  color: number;
  alpha: number;
  /** Fake gravity for confetti (px/s^2); 0 for dust. */
  gravity: number;
  /** 'dust' puffs fade out; 'confetti' keeps its colour until the end. */
  kind: 'dust' | 'confetti';
}

export interface NetRipple {
  /** -1 = the left goal, 1 = the right goal. */
  side: -1 | 1;
  x: number;
  y: number;
  /** Seconds since it started. */
  age: number;
  /** 0..1 */
  strength: number;
}

const rand = (min: number, max: number): number => min + Math.random() * (max - min);
const smooth = (t: number): number => t * t * (3 - 2 * t);
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** 0 (rolling) .. 1 (full-power shot): how far the ball is drawn "off the ground". */
export function ballLift(speed: number): number {
  return smooth(clamp01((speed - FX_LIFT_MIN_SPEED) / (FX_LIFT_MAX_SPEED - FX_LIFT_MIN_SPEED)));
}

/** Where the goal frame is: the net's box, in world coordinates, for each side (the match's goal width: T15 rules). */
export function netBox(side: -1 | 1, goalWidth = GOAL_WIDTH): { x0: number; x1: number; y0: number; y1: number } {
  const midY = (PITCH_TOP + PITCH_BOTTOM) / 2;
  const y0 = midY - goalWidth / 2;
  const y1 = midY + goalWidth / 2;
  return side < 0 ? { x0: PITCH_LEFT - GOAL_DEPTH, x1: PITCH_LEFT, y0, y1 } : { x0: PITCH_RIGHT, x1: PITCH_RIGHT + GOAL_DEPTH, y0, y1 };
}

/**
 * How far a net point moves (px) while a ripple is running. The net is pinned along the goal line and the side edges;
 * the impact sends a wave outwards that fades. Returns zero once the ripple is over.
 */
export function netOffset(ripple: NetRipple, px: number, py: number, goalWidth = GOAL_WIDTH): Vec2 {
  const t = ripple.age;
  if (t >= FX_RIPPLE_SECONDS) return { x: 0, y: 0 };
  const box = netBox(ripple.side, goalWidth);
  const depthFromLine = ripple.side < 0 ? box.x1 - px : px - box.x0;
  const u = clamp01(depthFromLine / GOAL_DEPTH); // 0 at the goal line .. 1 at the back
  const v = clamp01((py - box.y0) / goalWidth);
  const pin = smooth(clamp01(u / 0.3)) * Math.sin(Math.PI * v) ** 0.5; // fixed on the goal line and side edges
  const d = Math.hypot(px - ripple.x, py - ripple.y);
  const fade = Math.exp(-t * 3.2) * Math.exp(-d / 85);
  const wave = Math.sin((t * 3.4 - d / 95) * Math.PI * 2);
  const amp = FX_RIPPLE_AMPLITUDE * ripple.strength * pin * fade * wave;
  // Mostly along x (the ball pushes the net outwards), with a little sideways spread away from the impact.
  const spread = d > 1 ? 0.35 * amp : 0;
  return { x: ripple.side * amp, y: d > 1 ? (spread * (py - ripple.y)) / d : 0 };
}

/** The point the camera aims at: the ball, plus a look-ahead along its velocity (capped). */
export function cameraTarget(ball: { pos: Vec2; vel: Vec2 }): Vec2 {
  let lx = ball.vel.x * CAMERA_LOOKAHEAD;
  let ly = ball.vel.y * CAMERA_LOOKAHEAD;
  const len = Math.hypot(lx, ly);
  if (len > CAMERA_MAX_LOOKAHEAD) {
    lx = (lx / len) * CAMERA_MAX_LOOKAHEAD;
    ly = (ly / len) * CAMERA_MAX_LOOKAHEAD;
  }
  return { x: ball.pos.x + lx, y: ball.pos.y + ly };
}

/** Framerate-independent exponential approach: `rate` is 1/seconds. */
export function approach(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

/** Particles and net ripples. Update with real time; draw after the players. */
export class Effects {
  readonly particles: Particle[] = [];
  readonly ripples: NetRipple[] = [];

  clear(): void {
    this.particles.length = 0;
    this.ripples.length = 0;
  }

  private add(p: Particle): void {
    if (this.particles.length >= FX_MAX_PARTICLES) this.particles.shift();
    this.particles.push(p);
  }

  /** A puff of dust kicked up at (x, y), thrown back against `dir` (the ball's direction). */
  dust(x: number, y: number, dir: Vec2, power: number, count = 3 + Math.round(power * 8)): void {
    const base = Math.atan2(-dir.y, -dir.x);
    const hasDir = dir.x !== 0 || dir.y !== 0;
    for (let i = 0; i < count; i++) {
      const a = hasDir ? base + rand(-0.9, 0.9) : rand(0, Math.PI * 2);
      const sp = rand(25, 70 + 110 * power);
      this.add({
        x: x + rand(-3, 3),
        y: y + rand(-3, 3),
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        age: 0,
        life: rand(0.3, 0.55),
        size: rand(2, 3.5),
        grow: rand(8, 16),
        color: FX_DUST_COLOR,
        alpha: 0.55,
        gravity: 0,
        kind: 'dust',
      });
    }
  }

  /** Confetti thrown up from (x, y). */
  confetti(x: number, y: number, colors: readonly number[], count: number): void {
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(80, 380);
      this.add({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 120,
        age: 0,
        life: rand(0.9, 1.8),
        size: rand(2.5, 4.5),
        grow: 0,
        color: colors[i % colors.length],
        alpha: 1,
        gravity: 320,
        kind: 'confetti',
      });
    }
  }

  /** The ball hit the net (or a goal went in) at (x, y). */
  ripple(x: number, y: number, strength: number): void {
    const side: -1 | 1 = x < (PITCH_LEFT + PITCH_RIGHT) / 2 ? -1 : 1;
    this.ripples.push({ side, x, y, age: 0, strength: clamp01(strength) });
    if (this.ripples.length > 4) this.ripples.shift();
  }

  /** Is any net moving? (Otherwise the nets need no redrawing.) */
  get netsMoving(): boolean {
    return this.ripples.length > 0;
  }

  update(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const drag = Math.exp(-(p.kind === 'dust' ? 4 : 1.2) * dt);
      p.vx *= drag;
      p.vy = p.vy * drag + p.gravity * dt;
      p.size += p.grow * dt;
    }
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      this.ripples[i].age += dt;
      if (this.ripples[i].age >= FX_RIPPLE_SECONDS) this.ripples.splice(i, 1);
    }
  }
}

/** The grid of points a net is drawn through, displaced by the running ripples. Row-major: `rows` x `cols` points. */
export function netGrid(side: -1 | 1, ripples: readonly NetRipple[], goalWidth = GOAL_WIDTH): { cols: number; rows: number; pts: Vec2[] } {
  const box = netBox(side, goalWidth);
  const cols = Math.round(GOAL_DEPTH / NET_CELL) + 1;
  const rows = Math.round(goalWidth / NET_CELL) + 1;
  const mine = ripples.filter((r) => r.side === side);
  const pts: Vec2[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const px = box.x0 + ((box.x1 - box.x0) * c) / (cols - 1);
      const py = box.y0 + ((box.y1 - box.y0) * r) / (rows - 1);
      let dx = 0;
      let dy = 0;
      for (const rp of mine) {
        const o = netOffset(rp, px, py, goalWidth);

        dx += o.x;
        dy += o.y;
      }
      pts.push({ x: px + dx, y: py + dy });
    }
  }
  return { cols, rows, pts };
}

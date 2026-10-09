// Circle movement, friction, collisions, wall bounces. Pure functions, no Phaser/DOM.
import {
  BALL_DRAG,
  BALL_FRICTION,
  BALL_STOP_SPEED,
  GOAL_DEPTH,
  GOAL_WIDTH,
  NET_RESTITUTION,
  PITCH_BOTTOM,
  PITCH_LEFT,
  PITCH_RIGHT,
  PITCH_TOP,
  POST_RADIUS,
  POST_RESTITUTION,
  WALL_RESTITUTION,
} from '../config';
import type { CircleBody, Vec2 } from './types';

export interface Wall {
  a: Vec2;
  b: Vec2;
  restitution: number;
}

export interface Post {
  pos: Vec2;
  radius: number;
}

export interface Boundary {
  walls: Wall[];
  posts: Post[];
}

/** Pitch outline with a goal-mouth opening in each end line, plus net walls and posts. */
export function buildBoundary(): Boundary {
  const midY = (PITCH_TOP + PITCH_BOTTOM) / 2;
  const goalTop = midY - GOAL_WIDTH / 2;
  const goalBottom = midY + GOAL_WIDTH / 2;
  const w = (ax: number, ay: number, bx: number, by: number, restitution: number): Wall => ({
    a: { x: ax, y: ay },
    b: { x: bx, y: by },
    restitution,
  });
  const L = PITCH_LEFT;
  const R = PITCH_RIGHT;
  const T = PITCH_TOP;
  const B = PITCH_BOTTOM;
  const walls: Wall[] = [
    w(L, T, R, T, WALL_RESTITUTION),
    w(L, B, R, B, WALL_RESTITUTION),
    // Left end line, split by the goal mouth.
    w(L, T, L, goalTop, WALL_RESTITUTION),
    w(L, goalBottom, L, B, WALL_RESTITUTION),
    // Left goal net: sides and back.
    w(L, goalTop, L - GOAL_DEPTH, goalTop, NET_RESTITUTION),
    w(L - GOAL_DEPTH, goalTop, L - GOAL_DEPTH, goalBottom, NET_RESTITUTION),
    w(L - GOAL_DEPTH, goalBottom, L, goalBottom, NET_RESTITUTION),
    // Right end line.
    w(R, T, R, goalTop, WALL_RESTITUTION),
    w(R, goalBottom, R, B, WALL_RESTITUTION),
    // Right goal net.
    w(R, goalTop, R + GOAL_DEPTH, goalTop, NET_RESTITUTION),
    w(R + GOAL_DEPTH, goalTop, R + GOAL_DEPTH, goalBottom, NET_RESTITUTION),
    w(R + GOAL_DEPTH, goalBottom, R, goalBottom, NET_RESTITUTION),
  ];
  const posts: Post[] = [
    { pos: { x: L, y: goalTop }, radius: POST_RADIUS },
    { pos: { x: L, y: goalBottom }, radius: POST_RADIUS },
    { pos: { x: R, y: goalTop }, radius: POST_RADIUS },
    { pos: { x: R, y: goalBottom }, radius: POST_RADIUS },
  ];
  return { walls, posts };
}

export const BOUNDARY: Boundary = buildBoundary();

export function speedOf(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

/** Advance a circle by its velocity. */
export function moveCircle(c: CircleBody, dt: number): void {
  c.pos.x += c.vel.x * dt;
  c.pos.y += c.vel.y * dt;
}

/** Clamp speed to a maximum, keeping direction. */
export function capSpeed(c: CircleBody, maxSpeed: number): void {
  const s = speedOf(c.vel);
  if (s > maxSpeed) {
    const k = maxSpeed / s;
    c.vel.x *= k;
    c.vel.y *= k;
  }
}

/** Rolling friction: constant deceleration plus drag; snaps to rest at very low speed. */
export function applyRollingFriction(
  c: CircleBody,
  dt: number,
  friction: number = BALL_FRICTION,
  drag: number = BALL_DRAG,
  stopSpeed: number = BALL_STOP_SPEED,
): void {
  const s = speedOf(c.vel);
  if (s === 0) return;
  const newSpeed = s - (friction + drag * s) * dt;
  if (newSpeed <= stopSpeed) {
    c.vel.x = 0;
    c.vel.y = 0;
    return;
  }
  const k = newSpeed / s;
  c.vel.x *= k;
  c.vel.y *= k;
}

/** Bounce a circle off a surface with outward normal (nx, ny). */
function reflect(c: CircleBody, nx: number, ny: number, restitution: number, tangentKeep: number): void {
  const vn = c.vel.x * nx + c.vel.y * ny;
  if (vn >= 0) return; // already moving away
  const tx = c.vel.x - vn * nx;
  const ty = c.vel.y - vn * ny;
  c.vel.x = tx * tangentKeep - vn * restitution * nx;
  c.vel.y = ty * tangentKeep - vn * restitution * ny;
}

/** Circle vs line segment. Pushes the circle out and bounces it. Returns true on contact. */
export function collideCircleSegment(
  c: CircleBody,
  a: Vec2,
  b: Vec2,
  restitution: number,
  tangentKeep = 1,
): boolean {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((c.pos.x - a.x) * abx + (c.pos.y - a.y) * aby) / lenSq));
  const dx = c.pos.x - (a.x + abx * t);
  const dy = c.pos.y - (a.y + aby * t);
  const distSq = dx * dx + dy * dy;
  if (distSq >= c.radius * c.radius) return false;
  let nx: number;
  let ny: number;
  let dist = Math.sqrt(distSq);
  if (dist > 1e-9) {
    nx = dx / dist;
    ny = dy / dist;
  } else {
    // Centre exactly on the segment: pick the perpendicular facing against the velocity.
    const len = Math.sqrt(lenSq) || 1;
    nx = -aby / len;
    ny = abx / len;
    if (nx * c.vel.x + ny * c.vel.y > 0) {
      nx = -nx;
      ny = -ny;
    }
    dist = 0;
  }
  c.pos.x += nx * (c.radius - dist);
  c.pos.y += ny * (c.radius - dist);
  reflect(c, nx, ny, restitution, tangentKeep);
  return true;
}

/**
 * Circle vs circle. Separates them and applies an impulse along the contact normal.
 * `invMassA/B` are inverse masses (0 = immovable, e.g. a post). Returns true on contact.
 */
export function collideCircles(
  a: CircleBody,
  b: CircleBody,
  restitution: number,
  invMassA = 1,
  invMassB = 1,
): boolean {
  const dx = b.pos.x - a.pos.x;
  const dy = b.pos.y - a.pos.y;
  const minDist = a.radius + b.radius;
  const distSq = dx * dx + dy * dy;
  if (distSq >= minDist * minDist) return false;
  const invSum = invMassA + invMassB;
  if (invSum === 0) return true;
  const dist = Math.sqrt(distSq);
  // Normal points from a to b; arbitrary axis if perfectly overlapping.
  const nx = dist > 1e-9 ? dx / dist : 1;
  const ny = dist > 1e-9 ? dy / dist : 0;
  const overlap = minDist - dist;
  a.pos.x -= nx * overlap * (invMassA / invSum);
  a.pos.y -= ny * overlap * (invMassA / invSum);
  b.pos.x += nx * overlap * (invMassB / invSum);
  b.pos.y += ny * overlap * (invMassB / invSum);
  const rvn = (b.vel.x - a.vel.x) * nx + (b.vel.y - a.vel.y) * ny;
  if (rvn < 0) {
    const j = (-(1 + restitution) * rvn) / invSum;
    a.vel.x -= j * invMassA * nx;
    a.vel.y -= j * invMassA * ny;
    b.vel.x += j * invMassB * nx;
    b.vel.y += j * invMassB * ny;
  }
  return true;
}

/** Collide a circle with the pitch walls, goal nets and posts. Returns true if anything was hit. */
export function collideWithBoundary(
  c: CircleBody,
  boundary: Boundary = BOUNDARY,
  tangentKeep = 1,
  /** Overrides the wall/post restitution (e.g. 0 for players, who should not bounce). */
  restitution?: number,
): boolean {
  let hit = false;
  for (const wall of boundary.walls) {
    if (collideCircleSegment(c, wall.a, wall.b, restitution ?? wall.restitution, tangentKeep)) hit = true;
  }
  for (const post of boundary.posts) {
    const postBody: CircleBody = { pos: { ...post.pos }, vel: { x: 0, y: 0 }, radius: post.radius };
    if (collideCircles(c, postBody, restitution ?? POST_RESTITUTION, 1, 0)) hit = true;
  }
  return hit;
}

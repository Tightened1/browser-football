// A scripted, human-like player for `npm run simulate -- --human` (T17): it drives one team's controlled player through
// InputFrames, the same as a keyboard would. It is deliberately simple -- it runs at goal with the ball, weaving a little,
// and shoots from close in -- so the numbers measure how the AI defends against a person, not how clever the bot is.
//   naive:   just dribbles (no sprint, shield or feints): the "before" and "after" baseline.
//   skilled: also uses the T17 tools: sprints into space, shields when a defender is on its back, and side-steps (feint)
//            when a defender winds up a slide.
import { PITCH_HEIGHT, PITCH_LEFT, PITCH_RIGHT, PITCH_TOP, SIM_DT } from '../src/config';
import { pendingHeldRestart } from '../src/sim/setpiece';
import type { GameState, InputFrame, PlayerState, TeamId, Vec2 } from '../src/sim/types';

export type BotSkill = 'naive' | 'skilled';

export interface BotMemory {
  /** Seconds since the bot started. */
  t: number;
  /** Seconds the shoot key has been held for the current shot (0 = not shooting). */
  shootHold: number;
  lastSwitch: number;
  lastTackle: number;
  lastFeint: number;
  /** The previous frame's buttons (taps are pressed for one frame, then released). */
  prev: InputFrame | null;
  /** Weave phase, so two bots don't move in step. */
  phase: number;
}

export function createBotMemory(seed = 0): BotMemory {
  return { t: 0, shootHold: 0, lastSwitch: -9, lastTackle: -9, lastFeint: -9, prev: null, phase: (seed % 17) * 0.37 };
}

const MID_Y = PITCH_TOP + PITCH_HEIGHT / 2;
const dist = (a: Vec2, b: Vec2): number => Math.hypot(b.x - a.x, b.y - a.y);
/** Shoots from this close to the goal centre (px), after holding shoot this long (s). */
const SHOOT_RANGE = 260;
const SHOOT_HOLD = 0.35;

function frame(seq: number, mx: number, my: number, extra: Partial<InputFrame> = {}): InputFrame {
  const l = Math.hypot(mx, my);
  return { seq, moveX: l > 1 ? mx / l : mx, moveY: l > 1 ? my / l : my, pass: false, shoot: false, tackle: false, switchPlayer: false, ...extra };
}

function nearestOpponent(s: GameState, p: PlayerState): PlayerState | null {
  let best: PlayerState | null = null;
  for (const o of s.players) if (o.team !== p.team && o.role !== 'keeper' && (!best || dist(o.pos, p.pos) < dist(best.pos, p.pos))) best = o;
  return best;
}

/** The bot's input for `team`'s controlled player this tick. */
export function botInput(s: GameState, team: TeamId, mem: BotMemory, seq: number, skill: BotSkill = 'naive'): InputFrame {
  mem.t += SIM_DT;
  const out = decide(s, team, mem, seq, skill);
  // A tap (pass, tackle, switch) must be released for a frame before it can be pressed again.
  if (mem.prev?.pass) out.pass = false;
  if (mem.prev?.tackle) out.tackle = false;
  if (mem.prev?.switchPlayer) out.switchPlayer = false;
  mem.prev = out;
  return out;
}

function decide(s: GameState, team: TeamId, mem: BotMemory, seq: number, skill: BotSkill): InputFrame {
  const id = s.controlled[team];
  if (id < 0) return frame(seq, 0, 0);
  const p = s.players[id];
  const dir = s.attackDir[team];
  const goal = { x: dir > 0 ? PITCH_RIGHT : PITCH_LEFT, y: MID_Y };
  const toGoal = { x: goal.x - p.pos.x, y: goal.y - p.pos.y };
  const ball = s.ball;

  // Set pieces: aim at goal and play it after a moment (a throw-in or corner is clamped into the pitch by the sim).
  const r = s.restart;
  if (r && r.taker === id) {
    const held = pendingHeldRestart(s);
    const ready = held ? held.timer < 2.2 : true;
    return frame(seq, toGoal.x, toGoal.y, { pass: ready && seq % 20 === 0 });
  }

  const carrying = s.possession?.player === id;
  // Finishing a shot: hold, then release.
  if (mem.shootHold > 0) {
    mem.shootHold += SIM_DT;
    const release = mem.shootHold >= SHOOT_HOLD;
    if (release) mem.shootHold = 0;
    return frame(seq, toGoal.x, toGoal.y, { shoot: !release });
  }

  if (carrying) {
    if (dist(p.pos, goal) < SHOOT_RANGE) {
      mem.shootHold = SIM_DT;
      return frame(seq, toGoal.x, toGoal.y, { shoot: true });
    }
    // Run at goal, weaving a little like a person steering with the keys.
    const base = Math.atan2(toGoal.y, toGoal.x);
    const a = base + 0.55 * Math.sin(mem.t * 2.1 + mem.phase);
    let mx = Math.cos(a);
    let my = Math.sin(a);
    const extra: Partial<InputFrame> = {};
    if (skill === 'skilled') {
      const o = nearestOpponent(s, p);
      const od = o ? dist(o.pos, p.pos) : Infinity;
      // React to a slide being wound up at us: step sideways (feint), away from the tackler.
      if (o && o.windup > 0 && od < 110 && mem.t - mem.lastFeint > 0.6) {
        const side = (o.pos.x - p.pos.x) * Math.sin(base) - (o.pos.y - p.pos.y) * Math.cos(base) > 0 ? -1 : 1;
        mx = Math.cos(base + side * 1.4);
        my = Math.sin(base + side * 1.4);
        extra.feint = true;
        mem.lastFeint = mem.t;
      } else if (o && od < 48 && (o.pos.x - p.pos.x) * dir < 0) {
        // A defender on our back: shield and turn.
        extra.shield = true;
      } else if (od > 90 && p.stamina > 0.35) {
        extra.sprint = true;
      }
    }
    return frame(seq, mx, my, extra);
  }

  // Off the ball: go for it, switch to a teammate who is clearly closer, and tackle a carrier we reach.
  const target = { x: ball.pos.x + ball.vel.x * 0.25, y: ball.pos.y + ball.vel.y * 0.25 };
  const extra: Partial<InputFrame> = {};
  let closest = p;
  for (const t of s.players) if (t.team === team && t.role !== 'keeper' && dist(t.pos, ball.pos) < dist(closest.pos, ball.pos)) closest = t;
  if (closest !== p && dist(p.pos, ball.pos) - dist(closest.pos, ball.pos) > 80 && mem.t - mem.lastSwitch > 1) {
    extra.switchPlayer = true;
    mem.lastSwitch = mem.t;
  }
  const carrier = s.possession ? s.players[s.possession.player] : null;
  if (carrier && carrier.team !== team && dist(p.pos, ball.pos) < 45 && mem.t - mem.lastTackle > 1.5) {
    extra.tackle = true;
    mem.lastTackle = mem.t;
  }
  if (skill === 'skilled' && dist(p.pos, target) > 150 && p.stamina > 0.5) extra.sprint = true;
  return frame(seq, target.x - p.pos.x, target.y - p.pos.y, extra);
}

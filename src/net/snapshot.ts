// Binary packets for the unreliable channel: host -> guest snapshots, guest -> host inputs. Pure: no PeerJS, no DOM.
import { DRIBBLE_ROLL_PERIOD, KICK_BUFFER_TIME, KICK_FLASH_TIME, SHOT_MAX_CHARGE_TIME } from '../config';
import type { GameState, InputFrame, MatchPhase, Possession, RestartType, ShootoutRecord, TeamId } from '../sim/types';

/* ---- Snapshot ---------------------------------------------------------------------------------- */

export interface BodySnap {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface PlayerSnap extends BodySnap {
  facing: number;
  /** Seconds the shot has been charged. */
  charge: number;
  tackling: boolean;
  /** A kick is waiting in the kick buffer. */
  queued: boolean;
  /** A kick has just been struck (the "kick fired" cue). */
  kicked: boolean;
  /** T17: sprint stamina (0..1) and whether it is emptied (locked until SPRINT_RESUME). */
  stamina: number;
  sprintLock: boolean;
  /** T17: sprinting, shielding the ball, winding up a slide, feinting. */
  sprinting: boolean;
  shielding: boolean;
  windup: boolean;
  feinting: boolean;
  /** T19: yellow cards this half, and sent off. */
  yellow: number;
  sentOff: boolean;
}

/** Everything the guest needs to draw one moment of the match (static player data comes from its own copy). */
export interface Snapshot {
  tick: number;
  /** Seq of the newest guest input the host had applied by this tick (-1 = none yet). */
  ack: number;
  phase: MatchPhase;
  half: number;
  score: [number, number];
  clock: number;
  phaseTimer: number;
  /** Direction team 0 attacks (team 1 attacks the other way). */
  attackDir0: 1 | -1;
  kickoffTeam: TeamId;
  controlled: [number, number];
  restart: { type: RestartType; team: TeamId } | null;
  /** Sticky dribbling: who carries the ball, and how it sits (null = loose). */
  possession: Possession | null;
  /** T19: the penalty shoot-out so far (null = none). At most SHOOTOUT_SNAP_KICKS kicks are sent (the newest). */
  shootout: ShootoutRecord | null;
  /** Id of the newest match event so far (events themselves go on the reliable channel). */
  lastEventId: number;
  /** Host has paused the match (connection trouble); resumeIn > 0 = counting down to resume (s). */
  paused: boolean;
  resumeIn: number;
  ball: BodySnap;
  players: PlayerSnap[];
}

/** Network-only fields the host adds to a snapshot. */
export interface SnapshotNet {
  ack: number;
  paused: boolean;
  resumeIn: number;
}

export function takeSnapshot(s: GameState, net: SnapshotNet): Snapshot {
  const body = (b: { pos: { x: number; y: number }; vel: { x: number; y: number } }): BodySnap => ({ x: b.pos.x, y: b.pos.y, vx: b.vel.x, vy: b.vel.y });
  return {
    tick: s.tick,
    ack: net.ack,
    phase: s.phase,
    half: s.half,
    score: [s.score[0], s.score[1]],
    clock: s.clock,
    phaseTimer: s.phaseTimer,
    attackDir0: s.attackDir[0] > 0 ? 1 : -1,
    kickoffTeam: s.kickoffTeam,
    controlled: [s.controlled[0], s.controlled[1]],
    restart: s.restart ? { type: s.restart.type, team: s.restart.team } : null,
    possession: s.possession ? { ...s.possession } : null,
    shootout: s.shootout ? { first: s.shootout.first, kicks: [...s.shootout.kicks], winner: s.shootout.winner } : null,
    lastEventId: s.events.length ? s.events[s.events.length - 1].id : 0,
    paused: net.paused,
    resumeIn: net.resumeIn,
    ball: body(s.ball),
    players: s.players.map((p) => ({
      ...body(p),
      facing: p.facing,
      charge: p.charge,
      tackling: p.tackleTimer > 0,
      queued: p.kickQueue > 1e-9,
      kicked: p.kickFlash > 0,
      stamina: p.stamina,
      sprintLock: p.sprintLock,
      sprinting: p.sprinting,
      shielding: p.shielding,
      windup: p.windup > 0,
      feinting: p.feintTimer > 0,
      yellow: p.yellow,
      sentOff: p.sentOff,
    })),
  };
}

/** Copies a snapshot into a GameState the renderer can draw (players' static data must already be there). */
export function applySnapshot(s: GameState, snap: Snapshot): void {
  s.tick = snap.tick;
  s.phase = snap.phase;
  s.half = snap.half;
  s.score = [snap.score[0], snap.score[1]];
  s.clock = snap.clock;
  s.phaseTimer = snap.phaseTimer;
  s.attackDir = [snap.attackDir0, -snap.attackDir0 as 1 | -1];
  s.kickoffTeam = snap.kickoffTeam;
  s.controlled = [snap.controlled[0], snap.controlled[1]];
  // The taker isn't sent: a human team's taker is always its controlled player (keepers take goal kicks, AI-controlled).
  const r = snap.restart;
  const taker = r && r.type !== 'goal-kick' ? snap.controlled[r.team] : -1;
  s.restart = r ? { ...r, pos: { x: snap.ball.x, y: snap.ball.y }, taker, timer: 0 } : null;
  s.possession = snap.possession ? { ...snap.possession } : null;
  s.shootout = snap.shootout ? { ...snap.shootout, kicks: [...snap.shootout.kicks], pause: 0 } : null;
  s.ball.pos = { x: snap.ball.x, y: snap.ball.y };
  s.ball.vel = { x: snap.ball.vx, y: snap.ball.vy };
  snap.players.forEach((ps, i) => {
    const p = s.players[i];
    if (!p) return;
    p.pos = { x: ps.x, y: ps.y };
    p.vel = { x: ps.vx, y: ps.vy };
    p.facing = ps.facing;
    p.charge = ps.charge;
    p.tackleTimer = ps.tackling ? 0.01 : 0;
    p.kickQueue = ps.queued ? KICK_BUFFER_TIME : 0;
    p.kickFlash = ps.kicked ? KICK_FLASH_TIME : 0;
    p.stamina = ps.stamina;
    p.sprintLock = ps.sprintLock;
    p.sprinting = ps.sprinting;
    p.shielding = ps.shielding;
    p.windup = ps.windup ? 0.01 : 0;
    p.feintTimer = ps.feinting ? 0.01 : 0;
    p.yellow = ps.yellow;
    p.sentOff = ps.sentOff;
  });
}

/* ---- Binary layout -------------------------------------------------------------------------------
 * Snapshot (little-endian):
 *   u8 type=1 · u32 tick · u32 ack+1 · u8 phase · u8 half · u8 score0 · u8 score1 · u16 clock (1/100 s)
 *   u16 phaseTimer (1/100 s) · u8 flags (attackDir0>0, kickoffTeam, paused) · u8 resumeIn (1/10 s)
 *   i8 controlled0 · i8 controlled1 · u8 restart (0 none, else type+1 | team<<4) · u16 lastEventId · u8 players
 *   i8 carrier (-1 none) · u8 hold angle (1/256 turn) · u8 roll (1/256 of DRIBBLE_ROLL_PERIOD)
 *   u8 shoot-out (0 none, else 1 | first<<1 | (winner+1)<<2) · u8 kicks sent · u8[8] scored bits, kick i at bit i
 *   ball: i16 x, y (1/16 px) · i16 vx, vy (1/8 px/s)
 *   per player: i16 x, y · i16 vx, vy · u8 facing (1/256 turn) · u8 charge (1/255 of max)
 *               u8 flags (tackling, queued, kicked, sprinting, shielding, wind-up, feinting) · u8 stamina (1/127) | sprint lock<<7
 *               u8 cards: yellows (0..3) | sent off<<2
 * Inputs: u8 type=2 · u8 count · u32 newest seq · per frame, newest first: i8 moveX, i8 moveY (1/127)
 *         u8 buttons (pass, shoot, tackle, switch, sprint, shield, feint)
 * ------------------------------------------------------------------------------------------------- */

export const PACKET_SNAPSHOT = 1;
export const PACKET_INPUTS = 2;

const PHASES: readonly MatchPhase[] = ['pre-kickoff', 'playing', 'goal-scored', 'half-time', 'full-time', 'shootout'];
const RESTARTS: readonly RestartType[] = ['kickoff', 'throw-in', 'goal-kick', 'corner', 'free-kick', 'penalty'];
const POS_SCALE = 16;
const VEL_SCALE = 8;
const TIME_SCALE = 100;
const SHOOTOUT_OFFSET = 28;
/** Shoot-out kicks a snapshot carries (the newest, if there were more: 32 rounds of sudden death). */
export const SHOOTOUT_SNAP_KICKS = 64;
const HEADER_BYTES = SHOOTOUT_OFFSET + 2 + SHOOTOUT_SNAP_KICKS / 8;
const BODY_BYTES = 8;
const PLAYER_BYTES = BODY_BYTES + 5;
const TAU = Math.PI * 2;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const i16 = (v: number, scale: number): number => clamp(Math.round(v * scale), -32768, 32767);
const u16 = (v: number, scale: number): number => clamp(Math.round(v * scale), 0, 65535);
const u8 = (v: number): number => clamp(Math.round(v), 0, 255);

/** An angle as 1/256 of a turn, and back (-PI..PI). */
function turnByte(a: number): number {
  return Math.round(((((a % TAU) + TAU) % TAU) / TAU) * 256) & 255;
}
function byteTurn(b: number): number {
  const a = (b / 256) * TAU;
  return a > Math.PI ? a - TAU : a;
}

export function snapshotBytes(players: number): number {
  return HEADER_BYTES + BODY_BYTES + players * PLAYER_BYTES;
}

function writeBody(v: DataView, o: number, b: BodySnap): number {
  v.setInt16(o, i16(b.x, POS_SCALE), true);
  v.setInt16(o + 2, i16(b.y, POS_SCALE), true);
  v.setInt16(o + 4, i16(b.vx, VEL_SCALE), true);
  v.setInt16(o + 6, i16(b.vy, VEL_SCALE), true);
  return o + BODY_BYTES;
}

function readBody(v: DataView, o: number): BodySnap {
  return {
    x: v.getInt16(o, true) / POS_SCALE,
    y: v.getInt16(o + 2, true) / POS_SCALE,
    vx: v.getInt16(o + 4, true) / VEL_SCALE,
    vy: v.getInt16(o + 6, true) / VEL_SCALE,
  };
}

export function encodeSnapshot(s: Snapshot): Uint8Array {
  const bytes = new Uint8Array(snapshotBytes(s.players.length));
  const v = new DataView(bytes.buffer);
  v.setUint8(0, PACKET_SNAPSHOT);
  v.setUint32(1, s.tick >>> 0, true);
  v.setUint32(5, (s.ack + 1) >>> 0, true);
  v.setUint8(9, PHASES.indexOf(s.phase));
  v.setUint8(10, u8(s.half));
  v.setUint8(11, u8(s.score[0]));
  v.setUint8(12, u8(s.score[1]));
  v.setUint16(13, u16(s.clock, TIME_SCALE), true);
  v.setUint16(15, u16(s.phaseTimer, TIME_SCALE), true);
  v.setUint8(17, (s.attackDir0 > 0 ? 1 : 0) | (s.kickoffTeam << 1) | (s.paused ? 4 : 0));
  v.setUint8(18, u8(s.resumeIn * 10));
  v.setInt8(19, clamp(s.controlled[0], -1, 127));
  v.setInt8(20, clamp(s.controlled[1], -1, 127));
  v.setUint8(21, s.restart ? (RESTARTS.indexOf(s.restart.type) + 1) | (s.restart.team << 4) : 0);
  v.setUint16(22, clamp(s.lastEventId, 0, 65535), true);
  v.setUint8(24, s.players.length);
  v.setInt8(25, s.possession ? clamp(s.possession.player, 0, 127) : -1);
  v.setUint8(26, s.possession ? turnByte(s.possession.angle) : 0);
  v.setUint8(27, s.possession ? Math.floor((s.possession.roll / DRIBBLE_ROLL_PERIOD) * 256) & 255 : 0);
  const so = s.shootout;
  if (so) {
    // Only the newest kicks fit; dropping whole pairs keeps who took which kick (they alternate from `first`).
    const drop = Math.max(0, so.kicks.length - SHOOTOUT_SNAP_KICKS);
    const skip = drop + (drop % 2);
    const kicks = so.kicks.slice(skip);
    v.setUint8(SHOOTOUT_OFFSET, 1 | (so.first << 1) | ((so.winner + 1) << 2));
    v.setUint8(SHOOTOUT_OFFSET + 1, kicks.length);
    kicks.forEach((k, i) => {
      if (k) bytes[SHOOTOUT_OFFSET + 2 + (i >> 3)] |= 1 << (i & 7);
    });
  }
  let o = writeBody(v, HEADER_BYTES, s.ball);
  for (const p of s.players) {
    o = writeBody(v, o, p);
    v.setUint8(o, turnByte(p.facing));
    v.setUint8(o + 1, u8((p.charge / SHOT_MAX_CHARGE_TIME) * 255));
    v.setUint8(o + 2, (p.tackling ? 1 : 0) | (p.queued ? 2 : 0) | (p.kicked ? 4 : 0) | (p.sprinting ? 8 : 0) | (p.shielding ? 16 : 0) | (p.windup ? 32 : 0) | (p.feinting ? 64 : 0));
    v.setUint8(o + 3, clamp(Math.round(p.stamina * 127), 0, 127) | (p.sprintLock ? 128 : 0));
    v.setUint8(o + 4, clamp(p.yellow, 0, 3) | (p.sentOff ? 4 : 0));
    o += 5;
  }
  return bytes;
}

/** Null if the bytes are not a well-formed snapshot. */
export function decodeSnapshot(bytes: Uint8Array): Snapshot | null {
  if (bytes.length < HEADER_BYTES + BODY_BYTES || bytes[0] !== PACKET_SNAPSHOT) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = v.getUint8(24);
  if (bytes.length !== snapshotBytes(count)) return null;
  const phase = PHASES[v.getUint8(9)];
  const restartByte = v.getUint8(21);
  const restartType = restartByte ? RESTARTS[(restartByte & 15) - 1] : undefined;
  if (!phase || (restartByte && !restartType)) return null;
  const flags = v.getUint8(17);
  const carrier = v.getInt8(25);
  if (carrier >= count) return null;
  const players: PlayerSnap[] = [];
  let o = HEADER_BYTES + BODY_BYTES;
  for (let i = 0; i < count; i++) {
    const b = readBody(v, o);
    o += BODY_BYTES;
    const pf = v.getUint8(o + 2);
    const st = v.getUint8(o + 3);
    const cards = v.getUint8(o + 4);
    players.push({
      ...b,
      facing: byteTurn(v.getUint8(o)),
      charge: (v.getUint8(o + 1) / 255) * SHOT_MAX_CHARGE_TIME,
      tackling: (pf & 1) !== 0,
      queued: (pf & 2) !== 0,
      kicked: (pf & 4) !== 0,
      sprinting: (pf & 8) !== 0,
      shielding: (pf & 16) !== 0,
      windup: (pf & 32) !== 0,
      feinting: (pf & 64) !== 0,
      stamina: (st & 127) / 127,
      sprintLock: (st & 128) !== 0,
      yellow: cards & 3,
      sentOff: (cards & 4) !== 0,
    });
    o += 5;
  }
  const sf = v.getUint8(SHOOTOUT_OFFSET);
  const kickCount = Math.min(SHOOTOUT_SNAP_KICKS, v.getUint8(SHOOTOUT_OFFSET + 1));
  const winnerBits = (sf >> 2) & 3;
  if (sf & 1 && winnerBits === 3) return null;
  const shootout: ShootoutRecord | null =
    sf & 1
      ? {
          first: ((sf >> 1) & 1) as TeamId,
          kicks: Array.from({ length: kickCount }, (_, i) => (bytes[SHOOTOUT_OFFSET + 2 + (i >> 3)] & (1 << (i & 7))) !== 0),
          winner: (winnerBits - 1) as TeamId | -1,
        }
      : null;
  return {
    tick: v.getUint32(1, true),
    ack: v.getUint32(5, true) - 1,
    phase,
    half: v.getUint8(10),
    score: [v.getUint8(11), v.getUint8(12)],
    clock: v.getUint16(13, true) / TIME_SCALE,
    phaseTimer: v.getUint16(15, true) / TIME_SCALE,
    attackDir0: flags & 1 ? 1 : -1,
    kickoffTeam: ((flags >> 1) & 1) as TeamId,
    controlled: [v.getInt8(19), v.getInt8(20)],
    restart: restartType ? { type: restartType, team: ((restartByte >> 4) & 1) as TeamId } : null,
    possession: carrier >= 0 ? { player: carrier, angle: byteTurn(v.getUint8(26)), roll: (v.getUint8(27) / 256) * DRIBBLE_ROLL_PERIOD } : null,
    shootout,
    lastEventId: v.getUint16(22, true),
    paused: (flags & 4) !== 0,
    resumeIn: v.getUint8(18) / 10,
    ball: readBody(v, HEADER_BYTES),
    players,
  };
}

/* ---- Inputs ------------------------------------------------------------------------------------- */

const BTN_PASS = 1;
const BTN_SHOOT = 2;
const BTN_TACKLE = 4;
const BTN_SWITCH = 8;
const BTN_SPRINT = 16;
const BTN_SHIELD = 32;
const BTN_FEINT = 64;
const MOVE_SCALE = 127;

/** The frame exactly as the host will see it after the trip through the wire format (prediction must use this). */
export function quantizeInput(f: InputFrame): InputFrame {
  const q = (x: number): number => clamp(Math.round(x * MOVE_SCALE), -MOVE_SCALE, MOVE_SCALE) / MOVE_SCALE;
  return { ...f, moveX: q(f.moveX), moveY: q(f.moveY) };
}

/** `frames` oldest first, with consecutive seqs; at most 255. */
export function encodeInputs(frames: readonly InputFrame[]): Uint8Array {
  const n = Math.min(255, frames.length);
  const bytes = new Uint8Array(6 + n * 3);
  const v = new DataView(bytes.buffer);
  v.setUint8(0, PACKET_INPUTS);
  v.setUint8(1, n);
  v.setUint32(2, n ? frames[frames.length - 1].seq >>> 0 : 0, true);
  for (let i = 0; i < n; i++) {
    const f = frames[frames.length - 1 - i];
    const o = 6 + i * 3;
    v.setInt8(o, clamp(Math.round(f.moveX * MOVE_SCALE), -MOVE_SCALE, MOVE_SCALE));
    v.setInt8(o + 1, clamp(Math.round(f.moveY * MOVE_SCALE), -MOVE_SCALE, MOVE_SCALE));
    v.setUint8(
      o + 2,
      (f.pass ? BTN_PASS : 0) | (f.shoot ? BTN_SHOOT : 0) | (f.tackle ? BTN_TACKLE : 0) | (f.switchPlayer ? BTN_SWITCH : 0) | (f.sprint ? BTN_SPRINT : 0) | (f.shield ? BTN_SHIELD : 0) | (f.feint ? BTN_FEINT : 0),
    );
  }
  return bytes;
}

/** Frames oldest first, or null if malformed. */
export function decodeInputs(bytes: Uint8Array): InputFrame[] | null {
  if (bytes.length < 6 || bytes[0] !== PACKET_INPUTS) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = v.getUint8(1);
  if (bytes.length !== 6 + n * 3) return null;
  const newest = v.getUint32(2, true);
  const frames: InputFrame[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const seq = newest - i;
    if (seq < 0) continue;
    const o = 6 + i * 3;
    const b = v.getUint8(o + 2);
    frames.push({
      seq,
      moveX: v.getInt8(o) / MOVE_SCALE,
      moveY: v.getInt8(o + 1) / MOVE_SCALE,
      pass: (b & BTN_PASS) !== 0,
      shoot: (b & BTN_SHOOT) !== 0,
      tackle: (b & BTN_TACKLE) !== 0,
      switchPlayer: (b & BTN_SWITCH) !== 0,
      sprint: (b & BTN_SPRINT) !== 0,
      shield: (b & BTN_SHIELD) !== 0,
      feint: (b & BTN_FEINT) !== 0,
    });
  }
  return frames;
}

/**
 * Combines two queued input frames into one (the host's backlog), keeping any button press from either. Shoot too: a
 * quick tap (held in the older frame only) would otherwise vanish with both its press and its release; kept, it is
 * released on the next frame instead. A feint (one frame long) is kept the same way; sprint and shield are held keys,
 * so the newer frame's state stands.
 */
export function mergeInputs(older: InputFrame, newer: InputFrame): InputFrame {
  return {
    ...newer,
    pass: older.pass || newer.pass,
    shoot: older.shoot || newer.shoot,
    tackle: older.tackle || newer.tackle,
    switchPlayer: older.switchPlayer || newer.switchPlayer,
    feint: !!older.feint || !!newer.feint,
  };
}

/** Packet type of a binary message (0 if empty). */
export function packetType(bytes: Uint8Array): number {
  return bytes.length ? bytes[0] : 0;
}

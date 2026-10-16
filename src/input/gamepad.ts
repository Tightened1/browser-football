// Gamepad -> InputFrame (T20). The first half is pure (a snapshot of the pad in, an InputFrame out) and unit-tested; the
// second half is the manager that polls the browser's Gamepad API ("standard" mapping), feeds the match, drives the
// menus by sending the same key presses the keyboard would, and rumbles. Input only ever produces InputFrames.
import { FEINT_DOUBLE_TAP_MS } from '../config';
import type { InputFrame } from '../sim/types';

/** Button indices of the "standard" gamepad mapping (Xbox names; PlayStation: Cross, Circle, Square, Triangle, L1, R1, L2, R2, Share, Options). */
export const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 } as const;

export type PadActionId = 'pass' | 'shoot' | 'tackle' | 'sprint' | 'shield' | 'switch';
/** One button per action (an index of the standard mapping). */
export type PadBindings = Record<PadActionId, number>;

export const PAD_ACTIONS: readonly { id: PadActionId; label: string }[] = [
  { id: 'pass', label: 'Pass' },
  { id: 'shoot', label: 'Shoot (hold)' },
  { id: 'tackle', label: 'Tackle / slide / dive' },
  { id: 'sprint', label: 'Sprint (hold)' },
  { id: 'shield', label: 'Shield the ball (hold)' },
  { id: 'switch', label: 'Switch player' },
];

export const DEFAULT_PAD_BINDINGS: PadBindings = { pass: PAD.A, shoot: PAD.B, tackle: PAD.X, sprint: PAD.RT, shield: PAD.LT, switch: PAD.LB };

/** The buttons an action can be bound to. RB (quick chat), Back / Start and the d-pad keep their jobs. */
export const PAD_BINDABLE: readonly number[] = [PAD.A, PAD.B, PAD.X, PAD.Y, PAD.LB, PAD.LT, PAD.RT, PAD.L3, PAD.R3];

export const PAD_DEAD_ZONE = { min: 0.05, max: 0.5, def: 0.2, step: 0.05 } as const;
export const PAD_TRIGGER = { min: 0.1, max: 0.9, def: 0.3, step: 0.1 } as const;

/** The triggers are analogue: held once past the trigger threshold. */
const ANALOGUE_BUTTONS: readonly number[] = [PAD.LT, PAD.RT];

export interface PadConfig {
  deadZone: number;
  trigger: number;
  bindings: PadBindings;
  rumble: boolean;
}

export const DEFAULT_PAD_CONFIG: PadConfig = { deadZone: PAD_DEAD_ZONE.def, trigger: PAD_TRIGGER.def, bindings: DEFAULT_PAD_BINDINGS, rumble: true };

/** The part of a browser `Gamepad` the mapping reads. */
export interface PadSnapshot {
  axes: readonly number[];
  buttons: readonly { pressed: boolean; value: number }[];
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Radial dead zone: inside `dz` nothing, outside it the stick's length is rescaled so the edge of the dead zone is 0 and full tilt is 1. */
export function applyDeadZone(x: number, y: number, dz: number): { x: number; y: number } {
  const mag = Math.hypot(x, y);
  if (!(mag > dz) || mag === 0) return { x: 0, y: 0 };
  const scaled = Math.min(1, (mag - dz) / (1 - dz));
  return { x: (x / mag) * scaled, y: (y / mag) * scaled };
}

/** Is a button held? Triggers count once their analogue value passes `trigger`, the others by their pressed flag. */
export function padDown(snap: PadSnapshot, index: number, trigger: number): boolean {
  const b = snap.buttons[index];
  if (!b) return false;
  return ANALOGUE_BUTTONS.includes(index) ? b.value >= trigger : b.pressed;
}

/** The d-pad as a unit direction (diagonals normalised). */
export function dpadVector(snap: PadSnapshot): { x: number; y: number } {
  const d = (i: number): number => (snap.buttons[i]?.pressed ? 1 : 0);
  const x = d(PAD.RIGHT) - d(PAD.LEFT);
  const y = d(PAD.DOWN) - d(PAD.UP);
  const len = Math.hypot(x, y);
  return len > 0 ? { x: x / len, y: y / len } : { x: 0, y: 0 };
}

/** Move vector: the left stick (length 0..1 = walk..run), or the d-pad at full speed when the stick is at rest. */
export function padMove(snap: PadSnapshot, deadZone: number, useDpad = true): { x: number; y: number } {
  const stick = applyDeadZone(snap.axes[0] ?? 0, snap.axes[1] ?? 0, deadZone);
  if (stick.x !== 0 || stick.y !== 0) return stick;
  return useDpad ? dpadVector(snap) : { x: 0, y: 0 };
}

/** RB held: the face buttons and d-pad send quick chat instead of acting. */
export const chatModifier = (snap: PadSnapshot): boolean => !!snap.buttons[PAD.RB]?.pressed;

/** An InputFrame from a snapshot of the pad. `feint`: the stick was flicked twice since the last frame (see FlickDetector). */
export function padFrame(snap: PadSnapshot, cfg: PadConfig, seq: number, feint = false): InputFrame {
  const chat = chatModifier(snap);
  const m = padMove(snap, cfg.deadZone, !chat);
  const down = (a: PadActionId): boolean => !chat && padDown(snap, cfg.bindings[a], cfg.trigger);
  return {
    seq,
    moveX: m.x,
    moveY: m.y,
    pass: down('pass'),
    shoot: down('shoot'),
    tackle: down('tackle'),
    switchPlayer: down('switch'),
    sprint: down('sprint'),
    shield: down('shield'),
    feint,
  };
}

/** Keyboard and pad together: the longer move vector wins, buttons are either's. */
export function mergeFrames(a: InputFrame, b: InputFrame): InputFrame {
  const pick = Math.hypot(b.moveX, b.moveY) > Math.hypot(a.moveX, a.moveY) ? b : a;
  return {
    seq: a.seq,
    moveX: pick.moveX,
    moveY: pick.moveY,
    pass: a.pass || b.pass,
    shoot: a.shoot || b.shoot,
    tackle: a.tackle || b.tackle,
    switchPlayer: a.switchPlayer || b.switchPlayer,
    sprint: a.sprint || b.sprint,
    shield: a.shield || b.shield,
    feint: a.feint || b.feint,
  };
}

/**
 * Spots a flick of the stick twice in quick succession (the pad's double tap, T17 feint): out past FLICK_HIGH from below
 * FLICK_LOW, twice within FEINT_DOUBLE_TAP_MS, in about the same direction. Pure apart from the times given.
 */
export const FLICK_HIGH = 0.75;
export const FLICK_LOW = 0.4;

export class FlickDetector {
  private armed = true;
  private lastAt = -Infinity;
  private lastDir = { x: 0, y: 0 };

  /** Raw stick (before the dead zone) at `timeMs`. Returns true when this completes a double flick. */
  update(x: number, y: number, timeMs: number): boolean {
    const mag = Math.hypot(x, y);
    if (mag < FLICK_LOW) {
      this.armed = true;
      return false;
    }
    if (mag < FLICK_HIGH || !this.armed) return false;
    this.armed = false;
    const dir = { x: x / mag, y: y / mag };
    const again = timeMs - this.lastAt <= FEINT_DOUBLE_TAP_MS && dir.x * this.lastDir.x + dir.y * this.lastDir.y > 0.5;
    if (again) {
      this.lastAt = -Infinity; // a third flick starts a new pair
      return true;
    }
    this.lastAt = timeMs;
    this.lastDir = dir;
    return false;
  }

  clear(): void {
    this.armed = true;
    this.lastAt = -Infinity;
  }
}

/** What a press means to a match, besides the frame. */
export type PadEvent = { type: 'pause' } | { type: 'skip' } | { type: 'mute' } | { type: 'chat'; id: number };

/** Button presses (not holds) between two snapshots, as match events: Start pauses, RB + A/B/X/Y or RB + d-pad up/down chat, RB + Back mutes, a face button skips a replay. */
export function padEvents(prev: PadSnapshot | null, cur: PadSnapshot): PadEvent[] {
  const edge = (i: number): boolean => !!cur.buttons[i]?.pressed && !prev?.buttons[i]?.pressed;
  const out: PadEvent[] = [];
  if (edge(PAD.START)) out.push({ type: 'pause' });
  if (chatModifier(cur)) {
    const chat = [PAD.A, PAD.B, PAD.X, PAD.Y, PAD.UP, PAD.DOWN];
    chat.forEach((b, id) => {
      if (edge(b)) out.push({ type: 'chat', id });
    });
    if (edge(PAD.BACK)) out.push({ type: 'mute' });
  } else if ([PAD.A, PAD.B, PAD.X, PAD.Y].some(edge)) out.push({ type: 'skip' });
  return out;
}

export type MenuDirection = 'up' | 'down' | 'left' | 'right';

/** The menu direction held: the d-pad, else the stick pushed past half way along its stronger axis. */
export function menuDirection(snap: PadSnapshot): MenuDirection | null {
  const b = (i: number): boolean => !!snap.buttons[i]?.pressed;
  if (b(PAD.UP)) return 'up';
  if (b(PAD.DOWN)) return 'down';
  if (b(PAD.LEFT)) return 'left';
  if (b(PAD.RIGHT)) return 'right';
  const x = snap.axes[0] ?? 0;
  const y = snap.axes[1] ?? 0;
  if (Math.hypot(x, y) < 0.5) return null;
  return Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : y > 0 ? 'down' : 'up';
}

export const MENU_REPEAT_DELAY_MS = 400;
export const MENU_REPEAT_MS = 120;

/** Turns a held direction into presses: one at once, then repeating after a delay. */
export class MenuRepeat {
  private dir: MenuDirection | null = null;
  private next = 0;

  update(dir: MenuDirection | null, nowMs: number): MenuDirection | null {
    if (dir !== this.dir) {
      this.dir = dir;
      this.next = nowMs + MENU_REPEAT_DELAY_MS;
      return dir;
    }
    if (dir && nowMs >= this.next) {
      this.next = nowMs + MENU_REPEAT_MS;
      return dir;
    }
    return null;
  }
}

/** Binds `button` to an action; if another action has it, the two swap. Returns an error for a button that can't be used. */
export function rebindPad(bindings: PadBindings, action: PadActionId, button: number): { bindings: PadBindings; error?: string } {
  if (!PAD_BINDABLE.includes(button)) return { bindings, error: `${padButtonLabel(button, 'xbox')} is kept for quick chat, pause and the menus.` };
  const next = { ...bindings };
  const other = PAD_ACTIONS.find((a) => a.id !== action && bindings[a.id] === button);
  if (other) next[other.id] = bindings[action];
  next[action] = button;
  return { bindings: next };
}

/** Stored bindings (anything) -> valid ones: every action a distinct bindable button, else the defaults. */
export function sanitizePadBindings(raw: unknown): PadBindings {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_PAD_BINDINGS };
  const r = raw as Record<string, unknown>;
  const out = {} as PadBindings;
  const used = new Set<number>();
  for (const a of PAD_ACTIONS) {
    const v = r[a.id];
    if (typeof v !== 'number' || !PAD_BINDABLE.includes(v) || used.has(v)) return { ...DEFAULT_PAD_BINDINGS };
    used.add(v);
    out[a.id] = v;
  }
  return out;
}

export const sanitizePadNumber = (v: unknown, range: { min: number; max: number; def: number; step: number }): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round((Math.round(clamp(v, range.min, range.max) / range.step) * range.step) * 100) / 100 : range.def;

/* ---- Labels ------------------------------------------------------------------------------------------------------ */

export type PadKind = 'xbox' | 'playstation';

/** Xbox or PlayStation from the gamepad id (the Sony vendor id 054c, or a name), Xbox when unsure. */
export function padKind(id: string): PadKind {
  return /054c|playstation|dualshock|dualsense|ps[345]|sony/i.test(id) ? 'playstation' : 'xbox';
}

const XBOX_LABELS = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'L3', 'R3', '↑', '↓', '←', '→'];
const PS_LABELS = ['✕', '○', '□', '△', 'L1', 'R1', 'L2', 'R2', 'Share', 'Options', 'L3', 'R3', '↑', '↓', '←', '→'];

export function padButtonLabel(index: number, kind: PadKind): string {
  return (kind === 'playstation' ? PS_LABELS : XBOX_LABELS)[index] ?? `Button ${index}`;
}

export const padTypeName = (kind: PadKind): string => (kind === 'playstation' ? 'PlayStation' : 'Xbox');

/** One line for the in-match controls strip. */
export function padControlsSummary(bindings: PadBindings, kind: PadKind): string {
  const l = (a: PadActionId): string => padButtonLabel(bindings[a], kind);
  const chat = [PAD.A, PAD.B, PAD.X, PAD.Y].map((b) => padButtonLabel(b, kind)).join('/');
  return `Move: left stick / d-pad (flick twice: feint)    Pass: ${l('pass')}    Shoot: ${l('shoot')} (hold)    Tackle: ${l('tackle')}    Sprint: ${l('sprint')}    Shield: ${l('shield')}    Switch: ${l('switch')}    Chat: ${padButtonLabel(PAD.RB, kind)} + ${chat}    Pause: ${padButtonLabel(PAD.START, kind)}`;
}

/* ---- The manager (browser only) ----------------------------------------------------------------------------------- */

export type InputDevice = 'keyboard' | 'gamepad';

/** Marks the key events the manager sends to the menus, so the match's own keyboard reader and the device tracking ignore them. */
export const SYNTHETIC_KEY = '__padKey';

const KEY_CODES: Record<string, number> = { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Enter: 13, Escape: 27 };
const DIRECTION_KEY: Record<MenuDirection, string> = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };

const ACTION_KEYS: readonly (keyof Pick<InputFrame, 'pass' | 'shoot' | 'tackle' | 'switchPlayer' | 'sprint' | 'shield'>)[] = ['pass', 'shoot', 'tackle', 'switchPlayer', 'sprint', 'shield'];

export class GamepadManager {
  /** Which device was used last: decides the on-screen prompts. */
  device: InputDevice = 'keyboard';
  kind: PadKind = 'xbox';
  id = '';
  connected = false;
  /** In a live match the pad plays; otherwise (menus, pause, results) it presses keys for the menus. */
  private matchActive = false;
  /** What Start does in the menus: Enter, or (in the pause menu) Esc. */
  startKey: 'Enter' | 'Escape' = 'Enter';
  private captureFn: ((button: number | null) => void) | null = null;
  private snap: PadSnapshot | null = null;
  private padIndex = -1;
  private readonly flick = new FlickDetector();
  private readonly repeat = new MenuRepeat();
  private feint = false;
  private readonly latched = new Set<(typeof ACTION_KEYS)[number]>();
  private events: PadEvent[] = [];
  private suppress = false;
  private readonly disconnectListeners = new Set<(wasInUse: boolean) => void>();
  private started = false;

  constructor(private readonly config: () => PadConfig) {}

  /** Starts listening and polling (once). */
  start(): void {
    if (this.started || typeof window === 'undefined' || typeof navigator === 'undefined' || !('getGamepads' in navigator)) return;
    this.started = true;
    window.addEventListener('keydown', (e) => {
      if (!(e as unknown as Record<string, unknown>)[SYNTHETIC_KEY]) this.device = 'keyboard';
    }, true);
    window.addEventListener('pointerdown', () => {
      this.device = 'keyboard'; // a mouse click: the on-screen prompts are the keyboard's
    }, true);
    window.addEventListener('gamepaddisconnected', (e) => {
      if (e.gamepad.index === this.padIndex) this.lost();
    });
    const loop = (): void => {
      this.tick(performance.now());
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /** The pad in use went away (unplugged, or the browser stopped reporting it). */
  private lost(): void {
    const inUse = this.device === 'gamepad';
    this.padIndex = -1;
    this.connected = false;
    this.snap = null;
    this.device = 'keyboard';
    this.latched.clear();
    this.feint = false;
    for (const f of this.disconnectListeners) f(inUse);
  }

  /** A match is on the pad (true) or a menu is (false). */
  setMatchActive(on: boolean): void {
    if (on && !this.matchActive) this.suppress = true; // the A that chose "Resume" must not also pass
    this.matchActive = on;
    if (!on) this.events = [];
  }

  /** `listener(true)` when the pad that was being played with is unplugged. Returns a function that stops listening. */
  onDisconnect(listener: (wasInUse: boolean) => void): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  /** Wait for the next press of a button (for rebinding); `null` if Start was pressed instead, or capture was cancelled. */
  capture(cb: (button: number | null) => void): void {
    this.captureFn?.(null);
    this.captureFn = cb;
  }

  cancelCapture(): void {
    const fn = this.captureFn;
    this.captureFn = null;
    fn?.(null);
  }

  /** Match events (pause, chat, mute, skip replay) since the last call. */
  takeEvents(): PadEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** The pad's frame for this tick (the latest state plus any press shorter than a frame). Neutral when no pad is connected. */
  sample(seq: number): InputFrame {
    const cfg = this.config();
    const snap = this.read()?.snap ?? this.snap;
    const frame = snap ? padFrame(snap, cfg, seq, this.feint) : padFrame({ axes: [], buttons: [] }, cfg, seq, false);
    this.feint = false;
    if (this.suppress) {
      if (ACTION_KEYS.some((k) => frame[k])) for (const k of ACTION_KEYS) frame[k] = false;
      else this.suppress = false;
    } else {
      for (const k of this.latched) frame[k] = true;
    }
    this.latched.clear();
    return frame;
  }

  /** Vibrates the pad in use (if the setting is on, the pad was the last device used, and it can). `strength` 0..1. */
  rumble(strength: number, ms: number): void {
    if (!this.config().rumble || this.device !== 'gamepad' || this.padIndex < 0) return;
    try {
      const pad = navigator.getGamepads()[this.padIndex] as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, p: object) => Promise<unknown> } }) | null;
      const s = clamp(strength, 0, 1);
      void pad?.vibrationActuator?.playEffect?.('dual-rumble', { startDelay: 0, duration: ms, weakMagnitude: s * 0.7, strongMagnitude: s })?.catch?.(() => undefined);
    } catch {
      // No rumble here: nothing to do.
    }
  }

  private read(): { snap: PadSnapshot; pad: Gamepad } | null {
    let pads: (Gamepad | null)[] = [];
    try {
      pads = Array.from(navigator.getGamepads());
    } catch {
      return null;
    }
    const pad = pads.find((p) => p && p.connected && p.mapping === 'standard' && p.index === this.padIndex) ?? pads.find((p) => p && p.connected && p.mapping === 'standard');
    if (!pad) return null;
    if (pad.index !== this.padIndex || !this.connected) {
      this.padIndex = pad.index;
      this.id = pad.id;
      this.kind = padKind(pad.id);
      this.connected = true;
    }
    return { snap: { axes: pad.axes, buttons: pad.buttons.map((b) => ({ pressed: b.pressed, value: b.value })) }, pad };
  }

  private tick(now: number): void {
    const r = this.read();
    if (!r) {
      if (this.padIndex >= 0) this.lost();
      return;
    }
    const cfg = this.config();
    const snap = r.snap;
    const prev = this.snap;
    this.snap = snap;
    const anyEdge = snap.buttons.some((b, i) => b.pressed && !prev?.buttons[i]?.pressed);
    if (anyEdge || Math.hypot(snap.axes[0] ?? 0, snap.axes[1] ?? 0) > Math.max(0.5, cfg.deadZone)) this.device = 'gamepad';

    if (this.captureFn) {
      const i = snap.buttons.findIndex((b, n) => b.pressed && !prev?.buttons[n]?.pressed);
      if (i >= 0) {
        const fn = this.captureFn;
        this.captureFn = null;
        fn(i === PAD.START ? null : i);
      }
      return;
    }

    if (this.matchActive) {
      if (this.flick.update(snap.axes[0] ?? 0, snap.axes[1] ?? 0, now)) this.feint = true;
      const f = padFrame(snap, cfg, 0);
      for (const k of ACTION_KEYS) if (f[k]) this.latched.add(k);
      this.events.push(...padEvents(prev, snap));
      if (this.events.length > 16) this.events.splice(0, this.events.length - 16);
      return;
    }

    // A menu: the d-pad / stick move the focus (and repeat), A confirms, B goes back, Start confirms (resumes, in the pause menu).
    const dir = this.repeat.update(menuDirection(snap), now);
    if (dir) this.press(DIRECTION_KEY[dir]);
    const edge = (i: number): boolean => snap.buttons[i]?.pressed === true && !prev?.buttons[i]?.pressed;
    if (edge(PAD.A)) this.press('Enter');
    if (edge(PAD.B)) this.press('Escape');
    if (edge(PAD.START)) this.press(this.startKey);
    this.flick.clear();
  }

  /** The key press the keyboard would have made (to the text box if one has the focus, else the page). */
  private press(code: string): void {
    const kc = KEY_CODES[code];
    const active = document.activeElement;
    const target: EventTarget = active instanceof HTMLInputElement ? active : window;
    for (const type of ['keydown', 'keyup']) {
      const ev = new KeyboardEvent(type, { code, key: code, keyCode: kc, which: kc, bubbles: true, cancelable: true } as KeyboardEventInit);
      Object.defineProperty(ev, SYNTHETIC_KEY, { value: true });
      target.dispatchEvent(ev);
    }
  }
}

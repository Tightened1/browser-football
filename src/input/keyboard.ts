// Keyboard -> InputFrame.
import { SYNTHETIC_KEY } from './gamepad';
import { FEINT_DOUBLE_TAP_MS } from '../config';
import { DEFAULT_BINDINGS, MOVE_ACTIONS, normKey, type ActionId, type Bindings } from '../settings';
import type { InputFrame } from '../sim/types';

const anyDown = (keys: ReadonlySet<string>, codes: readonly string[]): boolean => codes.some((c) => c !== '' && keys.has(c));

/**
 * Pure mapping from the set of held key codes (KeyboardEvent.code, left/right Shift as one) to an InputFrame. `feint`:
 * a move key was double-tapped since the last frame (see DoubleTap).
 */
export function buildInputFrame(keys: ReadonlySet<string>, seq: number, bindings: Bindings = DEFAULT_BINDINGS, feint = false): InputFrame {
  const down = (a: ActionId): boolean => anyDown(keys, bindings[a]);
  let moveX = (down('right') ? 1 : 0) - (down('left') ? 1 : 0);
  let moveY = (down('down') ? 1 : 0) - (down('up') ? 1 : 0);
  const len = Math.hypot(moveX, moveY);
  if (len > 0) {
    moveX /= len;
    moveY /= len;
  }
  return {
    seq,
    moveX,
    moveY,
    pass: down('pass'),
    shoot: down('shoot'),
    tackle: down('tackle'),
    switchPlayer: down('switch'),
    sprint: down('sprint'),
    shield: down('shield'),
    feint,
  };
}

/** Spots a double tap (T17 feint): the same move action pressed twice within FEINT_DOUBLE_TAP_MS. Pure apart from the times given. */
export class DoubleTap {
  private readonly last = new Map<ActionId, number>();

  constructor(private readonly bindings: Bindings = DEFAULT_BINDINGS) {}

  /** A key went down (not an auto-repeat) at `timeMs`. Returns true if it completes a double tap. */
  press(code: string, timeMs: number): boolean {
    const action = MOVE_ACTIONS.find((a) => this.bindings[a].includes(code));
    if (!action) return false;
    const before = this.last.get(action);
    if (before !== undefined && timeMs - before <= FEINT_DOUBLE_TAP_MS) {
      this.last.delete(action); // a third tap starts a new pair
      return true;
    }
    this.last.set(action, timeMs);
    return false;
  }

  clear(): void {
    this.last.clear();
  }
}

/** Tracks held keys on the window and samples them once per simulation tick. */
export class KeyboardInput {
  private readonly held = new Set<string>();
  /** Keys pressed since the last sample, so a tap shorter than one tick is not lost. */
  private readonly latched = new Set<string>();
  private seq = 0;
  private readonly allKeys: ReadonlySet<string>;
  private readonly doubleTap: DoubleTap;
  /** A double-tapped move key since the last sample: the next frame is a feint. */
  private feint = false;

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if ((e as unknown as Record<string, unknown>)[SYNTHETIC_KEY]) return; // a menu key the gamepad sent
    const code = normKey(e.code);
    if (!this.allKeys.has(code)) return;
    e.preventDefault(); // stop arrows/space scrolling the page
    // An auto-repeat of a key we never saw go down was pressed before the match (e.g. the Space that clicked a menu
    // button): it isn't a press, so it can't start a charge whose release would kick.
    if (e.repeat && !this.held.has(code)) return;
    if (!e.repeat && this.doubleTap.press(code, e.timeStamp)) this.feint = true;
    this.held.add(code);
    this.latched.add(code);
  };
  private readonly onKeyUp = (e: KeyboardEvent): void => {
    const code = normKey(e.code);
    if (!this.allKeys.has(code)) return;
    e.preventDefault();
    this.held.delete(code);
  };
  private readonly onBlur = (): void => {
    this.held.clear();
    this.doubleTap.clear();
  };

  constructor(private readonly bindings: Bindings = DEFAULT_BINDINGS) {
    this.allKeys = new Set(Object.values(bindings).flat().filter((k) => k !== ''));
    this.doubleTap = new DoubleTap(bindings);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  sample(): InputFrame {
    const keys = new Set([...this.held, ...this.latched]);
    this.latched.clear();
    const feint = this.feint;
    this.feint = false;
    return buildInputFrame(keys, this.seq++, this.bindings, feint);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.held.clear();
    this.latched.clear();
  }
}

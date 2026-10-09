// Keyboard -> InputFrame.
import type { InputFrame } from '../sim/types';

const LEFT = ['ArrowLeft', 'KeyA'];
const RIGHT = ['ArrowRight', 'KeyD'];
const UP = ['ArrowUp', 'KeyW'];
const DOWN = ['ArrowDown', 'KeyS'];
const PASS = ['KeyX'];
const SHOOT = ['Space'];
const TACKLE = ['KeyC'];
const SWITCH = ['KeyZ', 'ShiftLeft', 'ShiftRight'];

const ALL_KEYS = new Set([...LEFT, ...RIGHT, ...UP, ...DOWN, ...PASS, ...SHOOT, ...TACKLE, ...SWITCH]);

const anyDown = (keys: ReadonlySet<string>, codes: string[]): boolean => codes.some((c) => keys.has(c));

/** Pure mapping from the set of held key codes (KeyboardEvent.code) to an InputFrame. */
export function buildInputFrame(keys: ReadonlySet<string>, seq: number): InputFrame {
  let moveX = (anyDown(keys, RIGHT) ? 1 : 0) - (anyDown(keys, LEFT) ? 1 : 0);
  let moveY = (anyDown(keys, DOWN) ? 1 : 0) - (anyDown(keys, UP) ? 1 : 0);
  const len = Math.hypot(moveX, moveY);
  if (len > 0) {
    moveX /= len;
    moveY /= len;
  }
  return {
    seq,
    moveX,
    moveY,
    pass: anyDown(keys, PASS),
    shoot: anyDown(keys, SHOOT),
    tackle: anyDown(keys, TACKLE),
    switchPlayer: anyDown(keys, SWITCH),
  };
}

/** Tracks held keys on the window and samples them once per simulation tick. */
export class KeyboardInput {
  private readonly held = new Set<string>();
  /** Keys pressed since the last sample, so a tap shorter than one tick is not lost. */
  private readonly latched = new Set<string>();
  private seq = 0;

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!ALL_KEYS.has(e.code)) return;
    e.preventDefault(); // stop arrows/space scrolling the page
    this.held.add(e.code);
    this.latched.add(e.code);
  };
  private readonly onKeyUp = (e: KeyboardEvent): void => {
    if (!ALL_KEYS.has(e.code)) return;
    e.preventDefault();
    this.held.delete(e.code);
  };
  private readonly onBlur = (): void => this.held.clear();

  constructor() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  sample(): InputFrame {
    const keys = new Set([...this.held, ...this.latched]);
    this.latched.clear();
    return buildInputFrame(keys, this.seq++);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.held.clear();
    this.latched.clear();
  }
}

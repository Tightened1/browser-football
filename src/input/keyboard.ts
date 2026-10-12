// Keyboard -> InputFrame.
import { DEFAULT_BINDINGS, normKey, type ActionId, type Bindings } from '../settings';
import type { InputFrame } from '../sim/types';

const anyDown = (keys: ReadonlySet<string>, codes: readonly string[]): boolean => codes.some((c) => c !== '' && keys.has(c));

/** Pure mapping from the set of held key codes (KeyboardEvent.code, left/right Shift as one) to an InputFrame. */
export function buildInputFrame(keys: ReadonlySet<string>, seq: number, bindings: Bindings = DEFAULT_BINDINGS): InputFrame {
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
  };
}

/** Tracks held keys on the window and samples them once per simulation tick. */
export class KeyboardInput {
  private readonly held = new Set<string>();
  /** Keys pressed since the last sample, so a tap shorter than one tick is not lost. */
  private readonly latched = new Set<string>();
  private seq = 0;
  private readonly allKeys: ReadonlySet<string>;

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    const code = normKey(e.code);
    if (!this.allKeys.has(code)) return;
    e.preventDefault(); // stop arrows/space scrolling the page
    this.held.add(code);
    this.latched.add(code);
  };
  private readonly onKeyUp = (e: KeyboardEvent): void => {
    const code = normKey(e.code);
    if (!this.allKeys.has(code)) return;
    e.preventDefault();
    this.held.delete(code);
  };
  private readonly onBlur = (): void => this.held.clear();

  constructor(private readonly bindings: Bindings = DEFAULT_BINDINGS) {
    this.allKeys = new Set(Object.values(bindings).flat().filter((k) => k !== ''));
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  sample(): InputFrame {
    const keys = new Set([...this.held, ...this.latched]);
    this.latched.clear();
    return buildInputFrame(keys, this.seq++, this.bindings);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.held.clear();
    this.latched.clear();
  }
}

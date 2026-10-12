// Small shared UI helpers for the menu and lobby scenes (simple shapes and text, no assets).
import Phaser from 'phaser';

export const UI_FONT = 'sans-serif';
export const UI_COLORS = {
  button: '#2e8b3d',
  buttonHover: '#3fae51',
  buttonDisabled: '#555555',
  secondary: '#34495e',
  secondaryHover: '#46627d',
  text: '#ffffff',
  muted: '#b8c4cc',
  good: '#7ee081',
  warn: '#ffd23f',
  bad: '#ff7a6b',
} as const;

export function label(scene: Phaser.Scene, x: number, y: number, size: number, color: string = UI_COLORS.text, bold = false): Phaser.GameObjects.Text {
  return scene.add
    .text(x, y, '', { fontFamily: UI_FONT, fontSize: `${size}px`, fontStyle: bold ? 'bold' : 'normal', color, align: 'center' })
    .setOrigin(0.5);
}

export interface Button {
  text: Phaser.GameObjects.Text;
  setEnabled(enabled: boolean): Button;
  setLabel(text: string): Button;
  setVisible(visible: boolean): Button;
  setPosition(x: number, y: number): Button;
  /** Keyboard focus: draws an outline around the button. */
  setFocused(focused: boolean): Button;
  /** Visible and enabled, so it can take focus and be activated. */
  readonly usable: boolean;
  /** Same as a mouse click (does nothing when disabled). */
  click(): void;
}

/** A clickable text button. Disabled buttons are greyed out and ignore clicks. */
export function button(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  onClick: () => void,
  opts: { size?: number; width?: number; secondary?: boolean } = {},
): Button {
  const base = opts.secondary ? UI_COLORS.secondary : UI_COLORS.button;
  const hover = opts.secondary ? UI_COLORS.secondaryHover : UI_COLORS.buttonHover;
  const t = scene.add
    .text(x, y, text, { fontFamily: UI_FONT, fontSize: `${opts.size ?? 26}px`, fontStyle: 'bold', color: UI_COLORS.text, align: 'center', fixedWidth: opts.width ?? 0 })
    .setOrigin(0.5)
    .setPadding(22, 10, 22, 10)
    .setBackgroundColor(base)
    .setInteractive({ useHandCursor: true });
  let enabled = true;
  let focused = false;
  let hovered = false;
  const ring = scene.add.graphics();
  const paint = (): void => {
    t.setBackgroundColor(!enabled ? UI_COLORS.buttonDisabled : focused || hovered ? hover : base);
    ring.clear();
    if (focused && enabled && t.visible) {
      const r = t.getBounds();
      ring.lineStyle(3, 0xffd23f, 1);
      ring.strokeRoundedRect(r.x - 5, r.y - 5, r.width + 10, r.height + 10, 8);
    }
  };
  t.on('pointerover', () => {
    hovered = true;
    paint();
  });
  t.on('pointerout', () => {
    hovered = false;
    paint();
  });
  t.on('pointerdown', () => enabled && onClick());
  const b: Button = {
    text: t,
    get usable() {
      return enabled && t.visible;
    },
    click() {
      if (enabled) onClick();
    },
    setFocused(on) {
      focused = on;
      paint();
      return b;
    },
    setPosition(x, y) {
      t.setPosition(x, y);
      paint();
      return b;
    },
    setEnabled(on) {
      if (on === enabled) return b;
      enabled = on;
      t.setAlpha(on ? 1 : 0.6);
      paint();
      if (on) t.setInteractive({ useHandCursor: true });
      else t.disableInteractive();
      return b;
    },
    setLabel(s) {
      t.setText(s);
      return b;
    },
    setVisible(v) {
      t.setVisible(v);
      paint();
      return b;
    },
  };
  t.once(Phaser.GameObjects.Events.DESTROY, () => ring.destroy());
  return b;
}

/** One stop for keyboard focus: a button, plus what left / right do when it is a "value" row (otherwise they move focus). */
export interface FocusItem {
  button: Button;
  onLeft?: () => void;
  onRight?: () => void;
}

/**
 * Keyboard navigation for a screen's buttons: arrows / W A S D move focus to the nearest button in that direction,
 * Enter or Space presses it, and hovering with the mouse moves focus too. Items with onLeft / onRight use those
 * keys to change their value instead.
 */
export class Focus {
  private index = 0;
  private suspended = false;
  private items: FocusItem[] = [];

  constructor(private readonly scene: Phaser.Scene, items: FocusItem[], start = 0) {
    this.setItems(items, start);
    const kb = scene.input.keyboard;
    const onKey = (e: KeyboardEvent): void => this.onKey(e);
    kb?.on('keydown', onKey);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => kb?.off('keydown', onKey));
  }

  setItems(items: FocusItem[], start = this.index): void {
    for (const it of this.items) it.button.setFocused(false);
    this.items = items;
    for (const it of items) it.button.text.on('pointerover', () => this.focus(it));
    this.index = Math.min(Math.max(0, start), Math.max(0, items.length - 1));
    this.refresh();
  }

  /** Stop reacting to keys (e.g. while waiting for a key to bind). */
  suspend(on: boolean): void {
    this.suspended = on;
  }

  get current(): FocusItem | undefined {
    return this.items[this.index];
  }

  focus(item: FocusItem): void {
    const i = this.items.indexOf(item);
    if (i < 0 || !item.button.usable) return;
    this.index = i;
    this.refresh();
  }

  /** Redraws the focus outline (call from update() when buttons move, appear or are enabled). */
  refresh(): void {
    if (!this.current?.button.usable) {
      const i = this.items.findIndex((it, n) => n >= this.index && it.button.usable);
      const j = i >= 0 ? i : this.items.findIndex((it) => it.button.usable);
      if (j >= 0) this.index = j;
    }
    this.items.forEach((it, i) => it.button.setFocused(i === this.index && it.button.usable));
  }

  private onKey(e: KeyboardEvent): void {
    if (this.suspended || !this.scene.scene.isActive()) return;
    const cur = this.current;
    switch (e.code) {
      case 'ArrowUp':
      case 'KeyW':
        this.move(0, -1);
        break;
      case 'ArrowDown':
      case 'KeyS':
        this.move(0, 1);
        break;
      case 'ArrowLeft':
      case 'KeyA':
        if (cur?.onLeft) cur.onLeft();
        else this.move(-1, 0);
        break;
      case 'ArrowRight':
      case 'KeyD':
        if (cur?.onRight) cur.onRight();
        else this.move(1, 0);
        break;
      case 'Enter':
      case 'NumpadEnter':
      case 'Space':
        if (cur?.button.usable) cur.button.click();
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  /** Focus the nearest usable button in the direction (dx, dy). */
  private move(dx: number, dy: number): void {
    const from = this.current?.button.text;
    if (!from) return;
    let best = -1;
    let bestScore = Infinity;
    this.items.forEach((it, i) => {
      if (i === this.index || !it.button.usable) return;
      const vx = it.button.text.x - from.x;
      const vy = it.button.text.y - from.y;
      const along = vx * dx + vy * dy;
      if (along <= 1) return;
      const across = Math.abs(vx * dy - vy * dx);
      // Sideways moves must stay in their row; up and down may drift a little sideways (a row of two buttons under a column of one).
      const score = along + across * (dx !== 0 ? 4 : 0.5);
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    });
    if (best >= 0) {
      this.index = best;
      this.refresh();
    }
  }
}

/** The title-screen backdrop: striped grass with faint pitch markings. */
export function drawBackdrop(scene: Phaser.Scene, width: number, height: number): void {
  scene.cameras.main.setBackgroundColor('#14361c');
  const g = scene.add.graphics();
  for (let i = 0; i < 12; i++) {
    g.fillStyle(i % 2 ? 0x173d20 : 0x14361c, 1);
    g.fillRect((width / 12) * i, 0, width / 12 + 1, height);
  }
  g.lineStyle(4, 0xffffff, 0.08);
  g.strokeCircle(width / 2, height / 2, 220);
  g.lineBetween(width / 2, 0, width / 2, height);
}

/** A screen heading with an optional hint line under it. */
export function heading(scene: Phaser.Scene, x: number, y: number, title: string, hint?: string): void {
  label(scene, x, y, 44, UI_COLORS.text, true).setText(title).setStroke('#000000', 6);
  if (hint) label(scene, x, y + 48, 18, UI_COLORS.muted).setText(hint);
}

/** Copies text to the clipboard; falls back to a hidden textarea where the Clipboard API isn't allowed (plain http). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

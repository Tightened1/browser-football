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
  t.on('pointerover', () => enabled && t.setBackgroundColor(hover));
  t.on('pointerout', () => t.setBackgroundColor(enabled ? base : UI_COLORS.buttonDisabled));
  t.on('pointerdown', () => enabled && onClick());
  const b: Button = {
    text: t,
    setEnabled(on) {
      if (on === enabled) return b;
      enabled = on;
      t.setBackgroundColor(on ? base : UI_COLORS.buttonDisabled).setAlpha(on ? 1 : 0.6);
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
      return b;
    },
  };
  return b;
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

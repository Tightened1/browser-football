import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { DEFAULT_PAD_BINDINGS, PAD_ACTIONS, PAD_DEAD_ZONE, PAD_TRIGGER, padTypeName, rebindPad, type PadActionId } from '../input/gamepad';
import { pad, padLabel } from '../input/pad';
import { settings, updateSettings } from '../settings';
import { button, drawBackdrop, Focus, heading, label, UI_COLORS, type Button, type FocusItem } from './ui';

const CX = GAME_WIDTH / 2;
const ROWS_Y = 250;
const ROW_STEP = 44;

const pct = (v: number): string => `${Math.round(v * 100)}%`;
/** A value stepped within its range, in whole steps (no floating point drift). */
const stepped = (v: number, dir: number, r: { min: number; max: number; step: number }): number => Math.round(Math.min(r.max, Math.max(r.min, v + dir * r.step)) * 100) / 100;

/** T20: the controller's settings: which one is connected, button rebinding, dead zone, trigger threshold and vibration. */
export class ControllerScene extends Phaser.Scene {
  private focus!: Focus;
  private status!: Phaser.GameObjects.Text;
  private message!: Phaser.GameObjects.Text;
  private readonly slots = new Map<PadActionId, Button>();
  private deadZone!: Button;
  private trigger!: Button;
  private rumble!: Button;
  private capturing: PadActionId | null = null;
  private shown = '';

  constructor() {
    super('ControllerScene');
  }

  create(): void {
    drawBackdrop(this, GAME_WIDTH, GAME_HEIGHT);
    heading(this, CX, 50, 'CONTROLLER', 'Xbox, PlayStation and other standard controllers · ↑ ↓ choose · ← → change · A / ✕ to rebind a button · B / ○ back');
    this.status = label(this, CX, 150, 24, UI_COLORS.warn, true).setWordWrapWidth(1100);
    label(this, CX, 205, 22, UI_COLORS.warn, true).setText('BUTTONS');

    const items: FocusItem[] = [];
    PAD_ACTIONS.forEach((a, i) => {
      const y = ROWS_Y + i * ROW_STEP;
      label(this, CX - 240, y, 21, UI_COLORS.text).setText(a.label).setOrigin(0, 0.5);
      const b = button(this, CX + 160, y, '', () => this.startCapture(a.id), { size: 18, width: 160, secondary: true });
      this.slots.set(a.id, b);
      items.push({ button: b });
    });
    label(this, CX - 240, ROWS_Y + PAD_ACTIONS.length * ROW_STEP - 6, 15, UI_COLORS.muted).setText('Fixed: left stick / d-pad move · RB + A B X Y / d-pad ↑ ↓: quick chat · RB + View: mute · Menu: pause').setOrigin(0, 0.5);

    const y0 = ROWS_Y + PAD_ACTIONS.length * ROW_STEP + 40;
    const value = (i: number, change: (dir: number) => void): Button => {
      const b = button(this, CX, y0 + i * 42, '', () => change(1), { size: 18, width: 560 });
      items.push({ button: b, onLeft: () => change(-1), onRight: () => change(1) });
      return b;
    };
    this.deadZone = value(0, (d) => this.set({ padDeadZone: stepped(settings.padDeadZone, d, PAD_DEAD_ZONE) }));
    this.trigger = value(1, (d) => this.set({ padTrigger: stepped(settings.padTrigger, d, PAD_TRIGGER) }));
    this.rumble = value(2, () => {
      this.set({ rumble: !settings.rumble });
      if (settings.rumble) pad.rumble(0.8, 250);
    });

    const reset = button(this, CX - 130, 744, 'Reset buttons', () => this.resetAll(), { size: 22, width: 230, secondary: true });
    const back = button(this, CX + 130, 744, 'Back', () => this.scene.start('SettingsScene'), { size: 22, width: 230 });
    items.push({ button: reset }, { button: back });
    this.message = label(this, CX, 705, 18, UI_COLORS.warn).setWordWrapWidth(1000);
    label(this, CX, GAME_HEIGHT - 20, 14, UI_COLORS.muted).setText('Dead zone: how far the stick must move before it counts · Trigger: how far a trigger must be pulled to count as held');

    this.focus = new Focus(this, items);
    this.input.keyboard?.on('keydown-ESC', () => {
      if (this.capturing) pad.cancelCapture();
      else this.scene.start('SettingsScene');
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => pad.cancelCapture());
    this.redraw();
  }

  update(): void {
    const s = pad.connected ? `Controller connected: ${padTypeName(pad.kind)} — ${pad.id.length > 70 ? `${pad.id.slice(0, 70)}…` : pad.id}` : 'No controller found — plug one in and press any button on it';
    if (s !== this.shown) {
      this.shown = s;
      this.status.setText(s).setColor(pad.connected ? UI_COLORS.good : UI_COLORS.warn);
      this.redraw();
    }
  }

  private set(patch: Partial<typeof settings>): void {
    updateSettings(patch);
    this.redraw();
  }

  private redraw(): void {
    for (const a of PAD_ACTIONS) this.slots.get(a.id)?.setLabel(this.capturing === a.id ? '…' : padLabel(settings.padBindings[a.id]));
    this.deadZone.setLabel(`Stick dead zone:   ◀  ${pct(settings.padDeadZone)}  ▶`);
    this.trigger.setLabel(`Trigger threshold:   ◀  ${pct(settings.padTrigger)}  ▶`);
    this.rumble.setLabel(`Vibration:   ◀  ${settings.rumble ? 'On' : 'Off'}  ▶`);
    this.focus?.refresh();
  }

  private startCapture(action: PadActionId): void {
    if (!pad.connected) {
      this.message.setText('Connect a controller (and press a button on it) first.');
      return;
    }
    this.capturing = action;
    this.focus.suspend(true);
    this.message.setText(`Press the new button for "${PAD_ACTIONS.find((a) => a.id === action)!.label}"   (${padLabel(9)} or Esc: cancel)`);
    this.redraw();
    pad.capture((index) => {
      this.capturing = null;
      if (index === null) this.message.setText('');
      else {
        const result = rebindPad(settings.padBindings, action, index);
        if (result.error) this.message.setText(result.error);
        else {
          updateSettings({ padBindings: result.bindings });
          this.message.setText('');
        }
      }
      this.time.delayedCall(80, () => this.focus.suspend(false));
      this.redraw();
    });
  }

  private resetAll(): void {
    updateSettings({ padBindings: { ...DEFAULT_PAD_BINDINGS }, padDeadZone: PAD_DEAD_ZONE.def, padTrigger: PAD_TRIGGER.def, rumble: true });
    this.message.setText('Controller settings reset to the defaults.');
    this.redraw();
  }
}

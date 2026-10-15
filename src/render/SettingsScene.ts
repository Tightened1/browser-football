import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import {
  ACTIONS,
  CAMERA_OPTIONS,
  DEFAULT_BINDINGS,
  DEFENDING_OPTIONS,
  DIFFICULTY_OPTIONS,
  MATCH_LENGTH_OPTIONS,
  KEEPERS_OPTIONS,
  RULES_OPTIONS,
  keyLabel,
  normKey,
  rebind,
  settings,
  unbind,
  updateSettings,
  matchRulesSetting,
  type ActionId,
  type Bindings,
} from '../settings';
import { sound } from '../audio/sound';
import { rulesLabel, rulesSummary } from '../sim/matchRules';

import { button, drawBackdrop, Focus, heading, label, UI_COLORS, type Button, type FocusItem } from './ui';

const CX = GAME_WIDTH / 2;
const VALUE_Y = 160;
const VALUE_STEP = 37;
const KEYS_Y = 482;
const KEYS_STEP = 25;
const CAMERA_LABEL = { auto: 'Auto (follow ball on small screens)', wide: 'Whole pitch', follow: 'Follow the ball' } as const;

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
/** The next value in a list (wrapping), `dir` steps away from the current one. */
function step<T>(list: readonly T[], current: T, dir: number): T {
  const i = list.indexOf(current);
  return list[(((i < 0 ? 0 : i) + dir) % list.length + list.length) % list.length];
}

const KEEPERS_LABEL = { rules: 'As the match rules say', team: 'Same as the AI', easy: 'Easy', normal: 'Normal', hard: 'Hard' } as const;
const DEFENDING_LABEL = { rules: 'As the match rules say', relaxed: 'Relaxed', normal: 'Normal', tough: 'Tough' } as const;

/** Settings: match length, AI difficulty, match rules, keepers, AI defending vs humans, volume, controls overlay and key rebinding. Saved on every change. */
export class SettingsScene extends Phaser.Scene {
  private focus!: Focus;
  private message!: Phaser.GameObjects.Text;
  private length!: Button;
  private difficulty!: Button;
  private rules!: Button;
  private keepers!: Button;
  private defending!: Button;
  private rulesInfo!: Phaser.GameObjects.Text;
  private volume!: Button;
  private overlay!: Button;
  private camera!: Button;
  private readonly slots = new Map<string, Button>();
  private capturing: { action: ActionId; slot: 0 | 1 } | null = null;

  constructor() {
    super('SettingsScene');
  }

  create(): void {
    drawBackdrop(this, GAME_WIDTH, GAME_HEIGHT);
    heading(this, CX, 50, 'SETTINGS', 'Saved automatically · ↑ ↓ choose a row · ← → change it · Enter on a key to rebind it');

    const items: FocusItem[] = [];
    const value = (y: number, change: (dir: number) => void): Button => {
      const b = button(this, CX, y, '', () => change(1), { size: 18, width: 480 });
      items.push({ button: b, onLeft: () => change(-1), onRight: () => change(1) });
      return b;
    };
    label(this, CX, 120, 22, UI_COLORS.warn, true).setText('MATCH');
    this.length = value(VALUE_Y, (d) => this.set({ halfMinutes: step(MATCH_LENGTH_OPTIONS, settings.halfMinutes, d) }));
    this.difficulty = value(VALUE_Y + VALUE_STEP, (d) => this.set({ difficulty: step(DIFFICULTY_OPTIONS, settings.difficulty, d) }));
    this.rules = value(VALUE_Y + VALUE_STEP * 2, (d) => this.set({ rules: step(RULES_OPTIONS, settings.rules, d) }));
    this.keepers = value(VALUE_Y + VALUE_STEP * 3, (d) => this.set({ keepers: step(KEEPERS_OPTIONS, settings.keepers, d) }));
    this.defending = value(VALUE_Y + VALUE_STEP * 4, (d) => this.set({ aiDefending: step(DEFENDING_OPTIONS, settings.aiDefending, d) }));
    this.rulesInfo = label(this, CX + 250, VALUE_Y + VALUE_STEP * 3, 14, UI_COLORS.muted).setOrigin(0, 0.5).setWordWrapWidth(300);
    this.volume = value(VALUE_Y + VALUE_STEP * 5, (d) => {
      this.set({ volume: Math.min(100, Math.max(0, settings.volume + d * 10)) });
      sound.applyVolume();
      sound.blip();
    });
    this.camera = value(VALUE_Y + VALUE_STEP * 6, (d) => this.set({ camera: step(CAMERA_OPTIONS, settings.camera, d) }));
    this.overlay = value(VALUE_Y + VALUE_STEP * 7, () => this.set({ showControls: !settings.showControls }));

    label(this, CX, 452, 22, UI_COLORS.warn, true).setText('KEY BINDINGS');
    ACTIONS.forEach((a, i) => {
      const y = KEYS_Y + i * KEYS_STEP;
      const text = label(this, CX - 240, y, 19, UI_COLORS.text).setText(a.label);
      text.setOrigin(0, 0.5);
      for (const slot of [0, 1] as const) {
        const b = button(this, CX + 100 + slot * 130, y, '', () => this.startCapture(a.id, slot), { size: 16, width: 100, secondary: true });
        this.slots.set(`${a.id}:${slot}`, b);
        items.push({ button: b });
      }
    });

    const reset = button(this, CX - 130, 774, 'Reset keys', () => this.resetKeys(), { size: 22, width: 210, secondary: true });
    const back = button(this, CX + 130, 774, 'Back', () => this.scene.start('MenuScene'), { size: 22, width: 210 });
    items.push({ button: reset }, { button: back });
    this.message = label(this, CX, 742, 18, UI_COLORS.warn).setWordWrapWidth(1000);
    label(this, CX, GAME_HEIGHT - 14, 14, UI_COLORS.muted).setText('Esc: back · reserved keys (Esc, Enter, Tab, F-keys, `, N) cannot be bound');

    this.focus = new Focus(this, items);
    this.input.keyboard?.on('keydown-ESC', () => {
      if (!this.capturing) this.scene.start('MenuScene');
    });
    this.redraw();
  }

  private set(patch: Partial<typeof settings>): void {
    updateSettings(patch);
    this.redraw();
  }

  private redraw(): void {
    this.length.setLabel(`Match length:   ◀  ${settings.halfMinutes} min halves  ▶`);
    this.difficulty.setLabel(`AI difficulty:   ◀  ${cap(settings.difficulty)}  ▶`);
    this.rules.setLabel(`Match rules:   ◀  ${rulesLabel(settings.rules)}  ▶`);
    this.keepers.setLabel(`Keepers:   ◀  ${KEEPERS_LABEL[settings.keepers]}  ▶`);
    this.defending.setLabel(`AI defending vs humans:   ◀  ${DEFENDING_LABEL[settings.aiDefending]}  ▶`);
    this.rulesInfo.setText(`${rulesLabel(settings.rules)}: ${rulesSummary(matchRulesSetting())}. Online, the host's rules are used.`);
    this.volume.setLabel(`Sound volume:   ◀  ${settings.volume}%  ▶`);
    this.camera.setLabel(`Camera:   ◀  ${CAMERA_LABEL[settings.camera]}  ▶`);
    this.overlay.setLabel(`Controls overlay:   ◀  ${settings.showControls ? 'On' : 'Off'}  ▶`);
    for (const a of ACTIONS) {
      for (const slot of [0, 1] as const) {
        const cap_ = this.capturing?.action === a.id && this.capturing.slot === slot;
        this.slots.get(`${a.id}:${slot}`)?.setLabel(cap_ ? '…' : keyLabel(settings.bindings[a.id][slot]));
      }
    }
    this.focus?.refresh();
  }

  private startCapture(action: ActionId, slot: 0 | 1): void {
    this.capturing = { action, slot };
    this.focus.suspend(true);
    const name = ACTIONS.find((a) => a.id === action)!.label;
    this.message.setText(`Press the new key for "${name}"   (Esc: cancel · Backspace: clear this slot)`);
    this.redraw();
    const onKey = (e: KeyboardEvent): void => {
      if (e.repeat) return; // the Enter / Space that opened this prompt, still held
      this.input.keyboard?.off('keydown', onKey);
      e.preventDefault();
      this.capturing = null;
      if (e.code === 'Escape') this.message.setText('');
      else this.apply(action, slot, e.code);
      // Let the key that ended the prompt pass before menu navigation listens again.
      this.time.delayedCall(60, () => this.focus.suspend(false));
      this.redraw();
    };
    this.input.keyboard?.on('keydown', onKey);
  }

  private apply(action: ActionId, slot: 0 | 1, code: string): void {
    const bindings = settings.bindings;
    const result = code === 'Backspace' || code === 'Delete' ? unbind(bindings, action, slot) : rebind(bindings, action, slot, normKey(code));
    if (result.error) {
      this.message.setText(result.error);
      return;
    }
    updateSettings({ bindings: result.bindings });
    this.message.setText('');
  }

  private resetKeys(): void {
    const bindings = {} as Bindings;
    for (const a of ACTIONS) bindings[a.id] = [...DEFAULT_BINDINGS[a.id]] as [string, string];
    updateSettings({ bindings });
    this.message.setText('Keys reset to the defaults.');
    this.redraw();
  }
}

// Player settings, saved in localStorage. Everything that touches storage is wrapped in try/catch (private windows,
// blocked storage and quota errors must never break the game); the validation is pure and unit-tested.
import { AI_DIFFICULTY, CAMERA_DEFAULT_MODE, DEFAULT_RULES_PRESET, type CameraMode } from './config';
import { AI_DEFENDING_LEVELS, DRAW_RULES, FOUL_LEVELS, KEEPER_LEVELS, RULES_PRESETS, rulesFor } from './sim/matchRules';
import type { AiDefending, Difficulty, DrawRule, FoulStrictness, KeeperLevel, MatchRules, RulesPreset } from './sim/types';
import { sanitizeName } from './social';
import { REPLAY_MODES, type ReplayMode } from './net/replay';
import { DEFAULT_PAD_BINDINGS, PAD_DEAD_ZONE, PAD_TRIGGER, sanitizePadBindings, sanitizePadNumber, type PadBindings } from './input/gamepad';
import { DEFAULT_LOOK, sanitizeLook, type Look } from './teams';

export type ActionId = 'up' | 'down' | 'left' | 'right' | 'pass' | 'shoot' | 'tackle' | 'sprint' | 'shield' | 'switch';
/** Two keys per action (KeyboardEvent.code); '' = nothing bound to that slot. */
export type Bindings = Record<ActionId, [string, string]>;

export const ACTIONS: readonly { id: ActionId; label: string }[] = [
  { id: 'up', label: 'Move up' },
  { id: 'down', label: 'Move down' },
  { id: 'left', label: 'Move left' },
  { id: 'right', label: 'Move right' },
  { id: 'pass', label: 'Pass' },
  { id: 'shoot', label: 'Shoot (hold)' },
  { id: 'tackle', label: 'Tackle / slide' },
  { id: 'sprint', label: 'Sprint (hold)' },
  { id: 'shield', label: 'Shield the ball (hold)' },
  { id: 'switch', label: 'Switch player' },
];

/** The move keys: double-tapping one with the ball is a feint (T17). */
export const MOVE_ACTIONS: readonly ActionId[] = ['up', 'down', 'left', 'right'];

export const DEFAULT_BINDINGS: Bindings = {
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  pass: ['KeyX', ''],
  shoot: ['Space', ''],
  tackle: ['KeyC', ''],
  sprint: ['ShiftLeft', ''],
  shield: ['KeyV', ''],
  switch: ['KeyZ', ''],
};

/** Actions added after players may have saved their keys (T17): filled in from the defaults when missing. */
const NEW_ACTIONS: readonly ActionId[] = ['sprint', 'shield'];

/** Keys that can't be bound: they belong to the menus and the debug overlays. */
export const RESERVED_KEYS: readonly string[] = ['Escape', 'Enter', 'NumpadEnter', 'Tab', 'Backquote', 'KeyN', 'KeyM', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'];

export const MATCH_LENGTH_OPTIONS = [1, 2, 3, 5] as const;
export const DIFFICULTY_OPTIONS: readonly Difficulty[] = ['easy', 'normal', 'hard'];
export const CAMERA_OPTIONS: readonly CameraMode[] = ['auto', 'wide', 'follow'];
export const RULES_OPTIONS: readonly RulesPreset[] = RULES_PRESETS;
/** Keepers: as the match rules say, or a fixed level (T15). */
export type KeepersSetting = KeeperLevel | 'rules';
export const KEEPERS_OPTIONS: readonly KeepersSetting[] = ['rules', ...KEEPER_LEVELS];
/** AI defending vs humans: as the match rules say (Arcade: Relaxed, Classic: Normal), or a fixed level (T17). */
export type DefendingSetting = AiDefending | 'rules';
export const DEFENDING_OPTIONS: readonly DefendingSetting[] = ['rules', ...AI_DEFENDING_LEVELS];
/** T19: fouls (Off / Lenient / Strict), cards (on / off) and what a draw goes to: as the match rules say, or fixed. */
export type FoulsSetting = FoulStrictness | 'rules';
export const FOULS_OPTIONS: readonly FoulsSetting[] = ['rules', ...FOUL_LEVELS];
export type CardsSetting = 'rules' | 'on' | 'off';
export const CARDS_OPTIONS: readonly CardsSetting[] = ['rules', 'on', 'off'];
export type DrawsSetting = DrawRule | 'rules';
export const DRAWS_OPTIONS: readonly DrawsSetting[] = ['rules', ...DRAW_RULES];
/** T23: replays Off / Goals only / Goals + full-time highlights. */
export const REPLAYS_OPTIONS: readonly ReplayMode[] = REPLAY_MODES;

export interface Settings {
  /** Minutes per half. */
  halfMinutes: number;
  difficulty: Difficulty;
  /** Match rules preset (T15): offline, and when hosting (the guest plays the host's). */
  rules: RulesPreset;
  /** Keepers' skill: the preset's own, or a fixed level. */
  keepers: KeepersSetting;
  /** How hard the AI tackles a human on the ball (T17): the preset's own, or a fixed level. */
  aiDefending: DefendingSetting;
  /** T19: how strict the referee is, whether reckless slides get cards, and what a draw goes to. */
  fouls: FoulsSetting;
  cards: CardsSetting;
  draws: DrawsSetting;
  /** Sound volume, 0..100. */
  volume: number;
  /** Camera: follow the ball when the pitch is drawn small (auto), never (wide) or always (follow). */
  camera: CameraMode;
  showControls: boolean;
  bindings: Bindings;
  /** The player's last team name and kit. */
  look: Look;
  /** T21: the player's name shown to a friend online ('' = not chosen: Host / Guest are used). */
  playerName: string;
  /** T21: ignore the other player's quick chat. */
  muteChat: boolean;
  /** T23: instant replays after goals, and the highlights at full time. */
  replays: ReplayMode;
  /** T20: controller buttons for the actions, the stick dead zone, how far a trigger counts as held, and vibration. */
  padBindings: PadBindings;
  padDeadZone: number;
  padTrigger: number;
  rumble: boolean;
}

export function defaultSettings(): Settings {
  const bindings = {} as Bindings;
  for (const a of ACTIONS) bindings[a.id] = [...DEFAULT_BINDINGS[a.id]] as [string, string];
  return { halfMinutes: 3, difficulty: AI_DIFFICULTY, rules: DEFAULT_RULES_PRESET, keepers: 'rules', aiDefending: 'rules', fouls: 'rules', cards: 'rules', draws: 'rules', volume: 70, camera: CAMERA_DEFAULT_MODE, showControls: true, bindings, look: { ...DEFAULT_LOOK }, playerName: '', muteChat: false, replays: 'all', padBindings: { ...DEFAULT_PAD_BINDINGS }, padDeadZone: PAD_DEAD_ZONE.def, padTrigger: PAD_TRIGGER.def, rumble: true };
}

/** Left and right Shift (Ctrl, Alt) count as one key. */
export function normKey(code: string): string {
  return code.endsWith('Right') && /^(Shift|Control|Alt|Meta)/.test(code) ? code.replace(/Right$/, 'Left') : code;
}

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length <= 30;

function sanitizeBindings(raw: unknown): Bindings {
  const out = defaultSettings().bindings;
  if (typeof raw !== 'object' || raw === null) return out;
  const given = raw as Record<string, unknown>;
  const used = new Set<string>();
  const next = {} as Bindings;
  const missing: ActionId[] = [];
  for (const a of ACTIONS) {
    const pair = given[a.id];
    if (pair === undefined && NEW_ACTIONS.includes(a.id)) {
      missing.push(a.id); // saved before this action existed: given its default key below
      continue;
    }
    if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(isStr)) return out;
    const keys = pair.map((k) => normKey(k as string)).map((k) => (RESERVED_KEYS.includes(k) || used.has(k) ? '' : k)) as [string, string];
    if (keys[0] === keys[1]) keys[1] = '';
    if (!keys[0] && !keys[1]) return out; // every action needs a key, or the stored set is damaged: use the defaults
    for (const k of keys) if (k) used.add(k);
    next[a.id] = keys;
  }
  for (const id of missing) {
    // A default key another action holds as one of two (e.g. Shift, once the second switch key) moves to the new action.
    const keys = DEFAULT_BINDINGS[id].map((k) => {
      if (!k) return '';
      const owner = used.has(k) ? actionUsing(next, k) : null;
      if (owner) {
        const pair = next[owner];
        if (!pair[0] || !pair[1]) return ''; // its only key: leave it there
        next[owner] = pair.map((x) => (x === k ? '' : x)) as [string, string];
      }
      used.add(k);
      return k;
    }) as [string, string];
    if (!keys[0] && !keys[1]) return out;
    next[id] = keys;
  }
  return next;
}

/** Anything (parsed storage) -> valid settings; missing or invalid fields fall back to the defaults. */
export function sanitizeSettings(raw: unknown): Settings {
  const d = defaultSettings();
  if (typeof raw !== 'object' || raw === null) return d;
  const r = raw as Record<string, unknown>;
  return {
    halfMinutes: (MATCH_LENGTH_OPTIONS as readonly unknown[]).includes(r.halfMinutes) ? (r.halfMinutes as number) : d.halfMinutes,
    difficulty: DIFFICULTY_OPTIONS.includes(r.difficulty as Difficulty) ? (r.difficulty as Difficulty) : d.difficulty,
    rules: RULES_OPTIONS.includes(r.rules as RulesPreset) ? (r.rules as RulesPreset) : d.rules,
    keepers: KEEPERS_OPTIONS.includes(r.keepers as KeepersSetting) ? (r.keepers as KeepersSetting) : d.keepers,
    aiDefending: DEFENDING_OPTIONS.includes(r.aiDefending as DefendingSetting) ? (r.aiDefending as DefendingSetting) : d.aiDefending,
    fouls: FOULS_OPTIONS.includes(r.fouls as FoulsSetting) ? (r.fouls as FoulsSetting) : d.fouls,
    cards: CARDS_OPTIONS.includes(r.cards as CardsSetting) ? (r.cards as CardsSetting) : d.cards,
    draws: DRAWS_OPTIONS.includes(r.draws as DrawsSetting) ? (r.draws as DrawsSetting) : d.draws,
    volume: typeof r.volume === 'number' && Number.isFinite(r.volume) ? Math.round(Math.min(100, Math.max(0, r.volume)) / 10) * 10 : d.volume,
    camera: CAMERA_OPTIONS.includes(r.camera as CameraMode) ? (r.camera as CameraMode) : d.camera,
    showControls: typeof r.showControls === 'boolean' ? r.showControls : d.showControls,
    bindings: sanitizeBindings(r.bindings),
    look: sanitizeLook(r.look),
    playerName: sanitizeName(r.playerName),
    muteChat: typeof r.muteChat === 'boolean' ? r.muteChat : d.muteChat,
    replays: REPLAYS_OPTIONS.includes(r.replays as ReplayMode) ? (r.replays as ReplayMode) : d.replays,
    padBindings: sanitizePadBindings(r.padBindings),
    padDeadZone: sanitizePadNumber(r.padDeadZone, PAD_DEAD_ZONE),
    padTrigger: sanitizePadNumber(r.padTrigger, PAD_TRIGGER),
    rumble: typeof r.rumble === 'boolean' ? r.rumble : d.rumble,
  };
}

const STORAGE_KEY = 'browser-football-settings-v1';

export function loadSettings(): Settings {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    return sanitizeSettings(text ? JSON.parse(text) : null);
  } catch {
    return defaultSettings();
  }
}

/** The settings in use. Mutate through `updateSettings`, which also saves them. */
export const settings: Settings = loadSettings();

export function updateSettings(patch: Partial<Settings>): void {
  Object.assign(settings, patch);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable or full: the settings still apply for this visit.
  }
}

/** The match rules the settings ask for (offline, and when hosting). */
export function matchRulesSetting(s: Settings = settings): MatchRules {
  return rulesFor(s.rules, s.keepers, s.aiDefending, { fouls: s.fouls, cards: s.cards === 'rules' ? 'rules' : s.cards === 'on', draws: s.draws });
}

/** Which action (other than `except`) already uses `code`. */

export function actionUsing(bindings: Bindings, code: string, except?: ActionId): ActionId | null {
  for (const a of ACTIONS) if (a.id !== except && bindings[a.id]?.includes(code)) return a.id;
  return null;
}

/** Bind `code` to a slot. Returns an error message for the player instead if it can't be used. */
export function rebind(bindings: Bindings, action: ActionId, slot: 0 | 1, code: string): { bindings: Bindings; error?: string } {
  const key = normKey(code);
  if (RESERVED_KEYS.includes(key)) return { bindings, error: `${keyLabel(key)} is reserved for menus and debug overlays.` };
  const other = actionUsing(bindings, key, action);
  if (other) return { bindings, error: `${keyLabel(key)} is already used for "${ACTIONS.find((a) => a.id === other)!.label}".` };
  const pair = [...bindings[action]] as [string, string];
  pair[slot] = key;
  if (pair[0] === pair[1]) pair[1 - slot] = '';
  return { bindings: { ...bindings, [action]: pair } };
}

/** Clear a slot, as long as the action keeps another key. */
export function unbind(bindings: Bindings, action: ActionId, slot: 0 | 1): { bindings: Bindings; error?: string } {
  if (!bindings[action][1 - slot]) return { bindings, error: 'Every action needs at least one key.' };
  const pair = [...bindings[action]] as [string, string];
  pair[slot] = '';
  return { bindings: { ...bindings, [action]: pair } };
}

/** A short name for a key code, for menus ("↑", "W", "Space", "Shift"). */
export function keyLabel(code: string): string {
  if (!code) return '—';
  const named: Record<string, string> = {
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Space: 'Space',
    ShiftLeft: 'Shift',
    ControlLeft: 'Ctrl',
    AltLeft: 'Alt',
    Backspace: 'Backspace',
    Minus: '-',
    Equal: '=',
    Comma: ',',
    Period: '.',
    Slash: '/',
    Semicolon: ';',
    Quote: "'",
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Escape: 'Esc',
  };
  if (named[code]) return named[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad/.test(code)) return `Num ${code.slice(6)}`;
  return code;
}

/** "↑ / W" for one action. */
export function keysText(bindings: Bindings, action: ActionId): string {
  return bindings[action].filter(Boolean).map(keyLabel).join(' / ');
}

/** One line for the in-match controls strip. */
export function controlsSummary(bindings: Bindings): string {
  const move = (['up', 'down', 'left', 'right'] as const).map((a) => keysText(bindings, a)).join('   ');
  return `Move: ${move} (double-tap: feint)    Pass: ${keysText(bindings, 'pass')}    Shoot: ${keysText(bindings, 'shoot')} (hold)    Tackle: ${keysText(bindings, 'tackle')}    Sprint: ${keysText(bindings, 'sprint')}    Shield: ${keysText(bindings, 'shield')}    Switch: ${keysText(bindings, 'switch')}    Pause: Esc`;
}

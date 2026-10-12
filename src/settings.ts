// Player settings, saved in localStorage. Everything that touches storage is wrapped in try/catch (private windows,
// blocked storage and quota errors must never break the game); the validation is pure and unit-tested.
import { AI_DIFFICULTY, CAMERA_DEFAULT_MODE, type CameraMode } from './config';
import type { Difficulty } from './sim/types';
import { DEFAULT_LOOK, sanitizeLook, type Look } from './teams';

export type ActionId = 'up' | 'down' | 'left' | 'right' | 'pass' | 'shoot' | 'tackle' | 'switch';
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
  { id: 'switch', label: 'Switch player' },
];

export const DEFAULT_BINDINGS: Bindings = {
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  pass: ['KeyX', ''],
  shoot: ['Space', ''],
  tackle: ['KeyC', ''],
  switch: ['KeyZ', 'ShiftLeft'],
};

/** Keys that can't be bound: they belong to the menus and the debug overlays. */
export const RESERVED_KEYS: readonly string[] = ['Escape', 'Enter', 'NumpadEnter', 'Tab', 'Backquote', 'KeyN', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'];

export const MATCH_LENGTH_OPTIONS = [1, 2, 3, 5] as const;
export const DIFFICULTY_OPTIONS: readonly Difficulty[] = ['easy', 'normal', 'hard'];
export const CAMERA_OPTIONS: readonly CameraMode[] = ['auto', 'wide', 'follow'];

export interface Settings {
  /** Minutes per half. */
  halfMinutes: number;
  difficulty: Difficulty;
  /** Sound volume, 0..100. */
  volume: number;
  /** Camera: follow the ball when the pitch is drawn small (auto), never (wide) or always (follow). */
  camera: CameraMode;
  showControls: boolean;
  bindings: Bindings;
  /** The player's last team name and kit. */
  look: Look;
}

export function defaultSettings(): Settings {
  const bindings = {} as Bindings;
  for (const a of ACTIONS) bindings[a.id] = [...DEFAULT_BINDINGS[a.id]] as [string, string];
  return { halfMinutes: 3, difficulty: AI_DIFFICULTY, volume: 70, camera: CAMERA_DEFAULT_MODE, showControls: true, bindings, look: { ...DEFAULT_LOOK } };
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
  for (const a of ACTIONS) {
    const pair = given[a.id];
    if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(isStr)) return out;
    const keys = pair.map((k) => normKey(k as string)).map((k) => (RESERVED_KEYS.includes(k) || used.has(k) ? '' : k)) as [string, string];
    if (keys[0] === keys[1]) keys[1] = '';
    if (!keys[0] && !keys[1]) return out; // every action needs a key, or the stored set is damaged: use the defaults
    for (const k of keys) if (k) used.add(k);
    next[a.id] = keys;
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
    volume: typeof r.volume === 'number' && Number.isFinite(r.volume) ? Math.round(Math.min(100, Math.max(0, r.volume)) / 10) * 10 : d.volume,
    camera: CAMERA_OPTIONS.includes(r.camera as CameraMode) ? (r.camera as CameraMode) : d.camera,
    showControls: typeof r.showControls === 'boolean' ? r.showControls : d.showControls,
    bindings: sanitizeBindings(r.bindings),
    look: sanitizeLook(r.look),
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

/** Which action (other than `except`) already uses `code`. */
export function actionUsing(bindings: Bindings, code: string, except?: ActionId): ActionId | null {
  for (const a of ACTIONS) if (a.id !== except && bindings[a.id].includes(code)) return a.id;
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
  return `Move: ${move}    Pass: ${keysText(bindings, 'pass')}    Shoot: ${keysText(bindings, 'shoot')} (hold)    Tackle: ${keysText(bindings, 'tackle')}    Switch: ${keysText(bindings, 'switch')}    Pause: Esc`;
}

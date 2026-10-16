// The one gamepad manager the game uses, configured from the player's settings (T20).
import { settings } from '../settings';
import { GamepadManager, padControlsSummary, padButtonLabel, PAD, type PadConfig } from './gamepad';

export const pad = new GamepadManager((): PadConfig => ({ deadZone: settings.padDeadZone, trigger: settings.padTrigger, bindings: settings.padBindings, rumble: settings.rumble }));

/** Is the pad the device in use (and still plugged in)? Decides which prompts are shown. */
export const padPrompts = (): boolean => pad.device === 'gamepad' && pad.connected;

/** The text for "press the confirm button" prompts: "A" / "✕", or the keyboard's. */
export const confirmPrompt = (keyboard: string): string => (padPrompts() ? padButtonLabel(PAD.A, pad.kind) : keyboard);

/** "Press any key" or "Press any button": what skips a replay. */
export const anyKeyPrompt = (): string => (padPrompts() ? `any of ${padButtonLabel(PAD.A, pad.kind)} ${padButtonLabel(PAD.B, pad.kind)} ${padButtonLabel(PAD.X, pad.kind)} ${padButtonLabel(PAD.Y, pad.kind)}` : 'any key');

/** The in-match controls strip for the device in use. */
export const controlsText = (keyboardSummary: string): string => (padPrompts() ? padControlsSummary(settings.padBindings, pad.kind) : keyboardSummary);

/** A button of an action, labelled for the pad in use. */
export const padLabel = (index: number): string => padButtonLabel(index, pad.kind);

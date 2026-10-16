// T20: the pure gamepad -> InputFrame mapping, menu navigation, rebinding, labels, and analogue movement through the
// online input path (the guest predicts with the same quantised frames the host receives).
import { describe, expect, it } from 'vitest';
import { FEINT_DOUBLE_TAP_MS, SIM_DT } from '../src/config';
import {
  DEFAULT_PAD_BINDINGS,
  DEFAULT_PAD_CONFIG,
  FlickDetector,
  MenuRepeat,
  MENU_REPEAT_DELAY_MS,
  MENU_REPEAT_MS,
  PAD,
  applyDeadZone,
  mergeFrames,
  menuDirection,
  padButtonLabel,
  padControlsSummary,
  padDown,
  padEvents,
  padFrame,
  padKind,
  padMove,
  rebindPad,
  sanitizePadBindings,
  type PadSnapshot,
} from '../src/input/gamepad';
import { decodeInputs, encodeInputs, quantizeInput } from '../src/net/snapshot';
import { defaultSettings, sanitizeSettings } from '../src/settings';
import { penaltyAim } from '../src/sim/setpiece';
import { createMatchState, NEUTRAL_INPUT, step } from '../src/sim/simulation';

function snap(opts: { axes?: number[]; down?: number[]; values?: Record<number, number> } = {}): PadSnapshot {
  const buttons = Array.from({ length: 17 }, (_, i) => {
    const value = opts.values?.[i] ?? (opts.down?.includes(i) ? 1 : 0);
    return { pressed: !!opts.down?.includes(i) || value >= 0.5, value };
  });
  return { axes: opts.axes ?? [0, 0, 0, 0], buttons };
}

describe('dead zone and normalisation', () => {
  it('ignores a stick resting inside the dead zone', () => {
    expect(applyDeadZone(0.1, -0.1, 0.2)).toEqual({ x: 0, y: 0 });
    expect(padMove(snap({ axes: [0.15, 0.05] }), 0.2)).toEqual({ x: 0, y: 0 });
  });

  it('rescales so the edge of the dead zone is 0 and full tilt is 1', () => {
    const just = applyDeadZone(0.2001, 0, 0.2);
    expect(just.x).toBeGreaterThan(0);
    expect(just.x).toBeLessThan(0.01);
    expect(applyDeadZone(1, 0, 0.2).x).toBeCloseTo(1);
    expect(applyDeadZone(0.6, 0, 0.2).x).toBeCloseTo(0.5); // (0.6 - 0.2) / 0.8
  });

  it('keeps the direction, and clips a square gate corner to length 1', () => {
    const v = applyDeadZone(0.6, 0.8, 0.2);
    expect(Math.atan2(v.y, v.x)).toBeCloseTo(Math.atan2(0.8, 0.6));
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1); // the stick is at full length (0.6, 0.8)
    const corner = applyDeadZone(1, 1, 0.2);
    expect(Math.hypot(corner.x, corner.y)).toBeCloseTo(1);
  });

  it('lets the stick scale the speed (walk to run) and uses the d-pad at full speed when the stick rests', () => {
    const walk = padFrame(snap({ axes: [0.5, 0] }), DEFAULT_PAD_CONFIG, 1);
    const run = padFrame(snap({ axes: [1, 0] }), DEFAULT_PAD_CONFIG, 2);
    expect(Math.hypot(walk.moveX, walk.moveY)).toBeLessThan(0.5);
    expect(Math.hypot(run.moveX, run.moveY)).toBeCloseTo(1);
    const dpad = padFrame(snap({ down: [PAD.RIGHT, PAD.DOWN] }), DEFAULT_PAD_CONFIG, 3);
    expect(Math.hypot(dpad.moveX, dpad.moveY)).toBeCloseTo(1);
    expect(dpad.moveX).toBeGreaterThan(0);
    expect(dpad.moveY).toBeGreaterThan(0);
    // The stick wins over the d-pad.
    expect(padFrame(snap({ axes: [-1, 0], down: [PAD.RIGHT] }), DEFAULT_PAD_CONFIG, 4).moveX).toBeLessThan(0);
  });
});

describe('buttons and triggers', () => {
  it('maps the default layout', () => {
    const f = (b: number): ReturnType<typeof padFrame> => padFrame(snap({ down: [b] }), DEFAULT_PAD_CONFIG, 0);
    expect(f(PAD.A).pass).toBe(true);
    expect(f(PAD.B).shoot).toBe(true);
    expect(f(PAD.X).tackle).toBe(true);
    expect(f(PAD.LB).switchPlayer).toBe(true);
    expect(f(PAD.Y)).toEqual({ ...NEUTRAL_INPUT, seq: 0 });
    expect(padFrame(snap(), DEFAULT_PAD_CONFIG, 7)).toEqual({ ...NEUTRAL_INPUT, seq: 7 });
  });

  it('holds sprint and shield by the analogue trigger threshold, not the pressed flag', () => {
    const cfg = { ...DEFAULT_PAD_CONFIG, trigger: 0.3 };
    expect(padDown(snap({ values: { [PAD.RT]: 0.25 } }), PAD.RT, 0.3)).toBe(false);
    expect(padDown(snap({ values: { [PAD.RT]: 0.35 } }), PAD.RT, 0.3)).toBe(true); // the pressed flag is still false here
    expect(padFrame(snap({ values: { [PAD.RT]: 0.35 } }), cfg, 0).sprint).toBe(true);
    expect(padFrame(snap({ values: { [PAD.LT]: 0.35 } }), cfg, 0).shield).toBe(true);
    expect(padFrame(snap({ values: { [PAD.RT]: 0.35 } }), { ...cfg, trigger: 0.6 }, 0).sprint).toBe(false);
  });

  it('turns the buttons into quick chat while RB is held', () => {
    const f = padFrame(snap({ down: [PAD.RB, PAD.A, PAD.RIGHT] }), DEFAULT_PAD_CONFIG, 0);
    expect(f.pass).toBe(false);
    expect(f.moveX).toBe(0);
    expect(padEvents(snap({ down: [PAD.RB] }), snap({ down: [PAD.RB, PAD.A] }))).toEqual([{ type: 'chat', id: 0 }]);
    expect(padEvents(snap({ down: [PAD.RB] }), snap({ down: [PAD.RB, PAD.Y] }))).toEqual([{ type: 'chat', id: 3 }]);
    expect(padEvents(snap({ down: [PAD.RB] }), snap({ down: [PAD.RB, PAD.DOWN] }))).toEqual([{ type: 'chat', id: 5 }]);
    expect(padEvents(snap({ down: [PAD.RB] }), snap({ down: [PAD.RB, PAD.BACK] }))).toEqual([{ type: 'mute' }]);
    // Held, not pressed: nothing.
    expect(padEvents(snap({ down: [PAD.RB, PAD.A] }), snap({ down: [PAD.RB, PAD.A] }))).toEqual([]);
  });

  it('pauses on Start and skips a replay on any face button', () => {
    expect(padEvents(snap(), snap({ down: [PAD.START] }))).toEqual([{ type: 'pause' }]);
    for (const b of [PAD.A, PAD.B, PAD.X, PAD.Y]) expect(padEvents(snap(), snap({ down: [b] }))).toEqual([{ type: 'skip' }]);
    expect(padEvents(snap(), snap({ down: [PAD.LB] }))).toEqual([]);
  });

  it('merges keyboard and pad: the longer move wins, buttons are either', () => {
    const kb = { ...NEUTRAL_INPUT, seq: 4, moveX: 1, pass: true };
    const pd = { ...NEUTRAL_INPUT, seq: 0, moveX: -0.4, shoot: true, feint: true };
    expect(mergeFrames(kb, pd)).toMatchObject({ seq: 4, moveX: 1, pass: true, shoot: true, feint: true });
    expect(mergeFrames({ ...NEUTRAL_INPUT, seq: 1 }, { ...NEUTRAL_INPUT, moveX: -0.4 }).moveX).toBe(-0.4);
  });
});

describe('feint: a double flick of the stick', () => {
  it('fires on the second flick within the double-tap time, in the same direction', () => {
    const d = new FlickDetector();
    expect(d.update(1, 0, 0)).toBe(false); // first flick
    expect(d.update(0.1, 0, 50)).toBe(false); // back to rest
    expect(d.update(1, 0, 150)).toBe(true); // second
  });

  it('needs the stick to come back first, and the flicks to be close in time', () => {
    const d = new FlickDetector();
    expect(d.update(1, 0, 0)).toBe(false);
    expect(d.update(1, 0, 100)).toBe(false); // still pushed over: one long push is not two flicks
    expect(d.update(0, 0, 150)).toBe(false);
    expect(d.update(1, 0, 100 + FEINT_DOUBLE_TAP_MS + 10)).toBe(false); // too late
  });

  it('ignores a flick the other way, and a gentle push that never reaches the flick level', () => {
    const d = new FlickDetector();
    d.update(1, 0, 0);
    d.update(0, 0, 40);
    expect(d.update(-1, 0, 100)).toBe(false);
    const e = new FlickDetector();
    e.update(0.6, 0, 0);
    e.update(0, 0, 40);
    expect(e.update(0.6, 0, 100)).toBe(false);
  });

  it('starts a new pair after a feint', () => {
    const d = new FlickDetector();
    d.update(0, 1, 0);
    d.update(0, 0, 30);
    expect(d.update(0, 1, 100)).toBe(true);
    d.update(0, 0, 130);
    expect(d.update(0, 1, 160)).toBe(false);
  });
});

describe('menu navigation', () => {
  it('reads the d-pad first, then the stick along its stronger axis', () => {
    expect(menuDirection(snap({ down: [PAD.UP] }))).toBe('up');
    expect(menuDirection(snap({ axes: [0.9, 0.3] }))).toBe('right');
    expect(menuDirection(snap({ axes: [-0.2, 0.8] }))).toBe('down');
    expect(menuDirection(snap({ axes: [0.3, 0.3] }))).toBeNull();
  });

  it('presses once, then repeats after a delay', () => {
    const r = new MenuRepeat();
    expect(r.update('down', 0)).toBe('down');
    expect(r.update('down', 100)).toBeNull();
    expect(r.update('down', MENU_REPEAT_DELAY_MS)).toBe('down');
    expect(r.update('down', MENU_REPEAT_DELAY_MS + MENU_REPEAT_MS - 1)).toBeNull();
    expect(r.update('down', MENU_REPEAT_DELAY_MS + MENU_REPEAT_MS)).toBe('down');
    expect(r.update(null, 1000)).toBeNull();
    expect(r.update('left', 1010)).toBe('left'); // a new direction is at once
  });
});

describe('rebinding', () => {
  it('moves an action to a free button', () => {
    const r = rebindPad(DEFAULT_PAD_BINDINGS, 'pass', PAD.Y);
    expect(r.error).toBeUndefined();
    expect(r.bindings.pass).toBe(PAD.Y);
    expect(DEFAULT_PAD_BINDINGS.pass).toBe(PAD.A); // not mutated
  });

  it('swaps with the action that had the button, so no action is left without one', () => {
    const r = rebindPad(DEFAULT_PAD_BINDINGS, 'pass', PAD.B); // shoot has B
    expect(r.bindings.pass).toBe(PAD.B);
    expect(r.bindings.shoot).toBe(PAD.A);
    expect(new Set(Object.values(r.bindings)).size).toBe(6);
  });

  it('refuses the buttons kept for chat, pause and the menus', () => {
    for (const b of [PAD.RB, PAD.START, PAD.BACK, PAD.UP, PAD.LEFT]) expect(rebindPad(DEFAULT_PAD_BINDINGS, 'pass', b).error).toBeDefined();
  });

  it('a rebound button drives the frame', () => {
    const b = rebindPad(DEFAULT_PAD_BINDINGS, 'tackle', PAD.Y).bindings;
    const cfg = { ...DEFAULT_PAD_CONFIG, bindings: b };
    expect(padFrame(snap({ down: [PAD.Y] }), cfg, 0).tackle).toBe(true);
    expect(padFrame(snap({ down: [PAD.X] }), cfg, 0).tackle).toBe(false);
  });

  it('stored settings: damaged or duplicate bindings fall back, valid ones and the numbers are kept', () => {
    expect(sanitizePadBindings({ ...DEFAULT_PAD_BINDINGS, pass: PAD.START })).toEqual(DEFAULT_PAD_BINDINGS);
    expect(sanitizePadBindings({ ...DEFAULT_PAD_BINDINGS, pass: PAD.B })).toEqual(DEFAULT_PAD_BINDINGS); // B is shoot's too
    expect(sanitizePadBindings('x')).toEqual(DEFAULT_PAD_BINDINGS);
    const s = sanitizeSettings({ padBindings: { ...DEFAULT_PAD_BINDINGS, pass: PAD.Y, shield: PAD.L3 }, padDeadZone: 0.3, padTrigger: 0.5, rumble: false });
    expect(s.padBindings).toMatchObject({ pass: PAD.Y, shield: PAD.L3 });
    expect(s).toMatchObject({ padDeadZone: 0.3, padTrigger: 0.5, rumble: false });
    expect(sanitizeSettings({ padDeadZone: 7, padTrigger: -1 })).toMatchObject({ padDeadZone: 0.5, padTrigger: 0.1 });
    expect(sanitizeSettings({}).padDeadZone).toBe(defaultSettings().padDeadZone);
  });
});

describe('labels', () => {
  it('tells Xbox and PlayStation pads apart, Xbox when unsure', () => {
    expect(padKind('Xbox 360 Controller (XInput STANDARD GAMEPAD)')).toBe('xbox');
    expect(padKind('Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)')).toBe('playstation');
    expect(padKind('DualSense Wireless Controller')).toBe('playstation');
    expect(padKind('Some Unknown Pad')).toBe('xbox');
  });

  it('names the buttons for each kind', () => {
    expect(padButtonLabel(PAD.A, 'xbox')).toBe('A');
    expect(padButtonLabel(PAD.A, 'playstation')).toBe('✕');
    expect(padButtonLabel(PAD.B, 'playstation')).toBe('○');
    expect(padButtonLabel(PAD.RT, 'playstation')).toBe('R2');
    expect(padControlsSummary(DEFAULT_PAD_BINDINGS, 'playstation')).toContain('Pass: ✕');
    expect(padControlsSummary(DEFAULT_PAD_BINDINGS, 'xbox')).toContain('Pass: A');
  });
});

describe('analogue movement online', () => {
  /** How far the human's player walks in `ticks` fixed steps holding `frame`. */
  const walk = (frame: ReturnType<typeof padFrame>, ticks: number): number => {
    let s = createMatchState({ humans: [true, false], seed: 3 });
    s.phase = 'playing';
    s.phaseTimer = 0;
    const id = s.controlled[0];
    s.players[id].pos = { x: 300, y: 400 };
    s.players[id].vel = { x: 0, y: 0 };
    const x0 = s.players[id].pos.x;
    for (let i = 0; i < ticks; i++) s = step(s, [{ ...frame, seq: i }, undefined], SIM_DT);
    return s.players[id].pos.x - x0;
  };

  it('half a stick moves the player slower than a full one, in the sim', () => {
    const half = padFrame(snap({ axes: [0.6, 0] }), DEFAULT_PAD_CONFIG, 0); // 0.5 after the dead zone
    const full = padFrame(snap({ axes: [1, 0] }), DEFAULT_PAD_CONFIG, 0);
    const dHalf = walk(half, 60);
    const dFull = walk(full, 60);
    expect(dHalf).toBeGreaterThan(20);
    expect(dHalf).toBeLessThan(dFull * 0.75);
  });

  it('survives the wire format: the host steps the decoded frame and the guest its quantised one, to the same place', () => {
    const f = padFrame(snap({ axes: [0.7, -0.35] }), DEFAULT_PAD_CONFIG, 9);
    const decoded = decodeInputs(encodeInputs([f]))![0];
    expect(decoded.moveX).toBeCloseTo(quantizeInput(f).moveX, 6);
    expect(decoded.moveY).toBeCloseTo(quantizeInput(f).moveY, 6);
    // The host's player (decoded input) and the guest's prediction (quantised input) walk exactly the same way.
    expect(walk(decoded, 120)).toBe(walk(quantizeInput(f), 120));
    // And within a hair of the un-quantised stick (1/127 of rounding).
    expect(Math.abs(walk(decoded, 120) - walk(f, 120))).toBeLessThan(2);
  });
});

describe('penalty aim with a stick', () => {
  const spot = { pos: { x: 1000, y: 400 } };
  it('keys still give left / centre / right, a stick anything between', () => {
    const angle = (moveY: number, moveX = 0.5): number => penaltyAim(spot, { moveX, moveY }, 0, 180);
    const centre = angle(0, 1);
    const full = angle(-1, 0);
    expect(angle(-0.707, 0.707)).toBeCloseTo(full, 6); // a diagonal is the full corner, as before
    const half = angle(-0.5, 0.866); // across = -0.5: about half way
    expect(half).toBeLessThan(centre);
    expect(half).toBeGreaterThan(full);
    expect(angle(-0.2, 0.98)).toBeCloseTo(centre, 6); // inside the dead band: the middle
    expect(angle(-0.6, 0.8)).toBeLessThan(half); // further across, further to the post
  });
});

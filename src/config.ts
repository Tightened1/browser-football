// All tunable constants live here.

/** Pitch playing area in world units (pixels at 1x). */
export const PITCH_WIDTH = 1050;
export const PITCH_HEIGHT = 680;
/** Space around the pitch for goals and touchline. */
export const PITCH_MARGIN = 70;

export const GAME_WIDTH = PITCH_WIDTH + PITCH_MARGIN * 2;
export const GAME_HEIGHT = PITCH_HEIGHT + PITCH_MARGIN * 2;

/** Pitch markings. */
export const GOAL_WIDTH = 140;
export const GOAL_DEPTH = 36;
export const CENTRE_CIRCLE_RADIUS = 80;
export const PENALTY_BOX_WIDTH = 150;
export const PENALTY_BOX_HEIGHT = 300;
export const LINE_THICKNESS = 4;

/** Match timing: 2 halves of 3 minutes. */
export const HALVES = 2;
export const HALF_LENGTH_SECONDS = 3 * 60;

/** Fixed simulation timestep (60 Hz). */
export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;

export const COLORS = {
  grass: 0x2e8b3d,
  grassStripe: 0x329a43,
  line: 0xffffff,
  background: 0x111111,
  goalNet: 0xdddddd,
} as const;
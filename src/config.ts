// All tunable constants live here.

/** Pitch playing area in world units (pixels at 1x). */
export const PITCH_WIDTH = 1050;
export const PITCH_HEIGHT = 680;
/** Space around the pitch for goals and touchline. */
export const PITCH_MARGIN = 70;

export const GAME_WIDTH = PITCH_WIDTH + PITCH_MARGIN * 2;
export const GAME_HEIGHT = PITCH_HEIGHT + PITCH_MARGIN * 2;

/** Pitch edges in world coordinates (the playing area sits inside the margin). */
export const PITCH_LEFT = PITCH_MARGIN;
export const PITCH_TOP = PITCH_MARGIN;
export const PITCH_RIGHT = PITCH_LEFT + PITCH_WIDTH;
export const PITCH_BOTTOM = PITCH_TOP + PITCH_HEIGHT;

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

/** Ball physics (units: world px, seconds). */
export const BALL_RADIUS = 9;
/** Constant rolling-friction deceleration (px/s^2). */
export const BALL_FRICTION = 90;
/** Speed-proportional drag (1/s); makes fast balls slow quicker. */
export const BALL_DRAG = 0.55;
/** Below this speed the ball stops dead (px/s). */
export const BALL_STOP_SPEED = 4;
export const BALL_MAX_SPEED = 1400;
/** Energy kept when bouncing off walls, nets and posts (0..1). */
export const WALL_RESTITUTION = 0.7;
export const NET_RESTITUTION = 0.3;
export const POST_RESTITUTION = 0.8;
/** Fraction of sliding speed kept along a wall on contact. */
export const WALL_TANGENT_KEEP = 0.95;
export const POST_RADIUS = 5;
/** Max distance the ball may move per physics substep, as a fraction of its radius (anti-tunnelling). */
export const MAX_STEP_FRACTION = 0.5;
export const MAX_SUBSTEPS = 32;

/** Debug: click the pitch to kick the ball towards the pointer (render-side only, off by default). */
export const DEBUG_CLICK_KICK = false;
export const DEBUG_KICK_SPEED = 700;

/** Player movement (px, seconds). */
export const PLAYER_RADIUS = 14;
export const PLAYER_MAX_SPEED = 230;
/** Acceleration while a direction is held (px/s^2). */
export const PLAYER_ACCEL = 1500;
/** Deceleration when no direction is held (px/s^2). */
export const PLAYER_DECEL = 1900;

/** Player-vs-ball contact. */
export const PLAYER_BALL_RESTITUTION = 0.35;
/** Gap beyond touching within which the player can kick, dribble or count as having the ball (px). */
export const KICK_REACH = 8;
export const DRIBBLE_REACH = 7;
/** Extra speed the ball gets ahead of the player on each dribble touch (px/s). */
export const DRIBBLE_BOOST = 80;
/** Seconds between dribble touches; the ball runs free in between, so it can be lost. */
export const DRIBBLE_TOUCH_INTERVAL = 0.15;
/** The ball must be within this angle (radians) of the running direction to be nudged. */
export const DRIBBLE_CONE = 1.1;

/** Kicks (ball launch speed, px/s). */
export const PASS_SPEED = 450;
/** A tap of shoot, or a minimal charge. */
export const SHOT_MIN_SPEED = 500;
export const SHOT_MAX_SPEED = 1150;
/** Charge time (s) for a full-power shot; holding longer is capped. */
export const SHOT_MAX_CHARGE_TIME = 0.8;
/** How much of the player's velocity is added to a kick (0..1). */
export const KICK_PLAYER_VEL_FACTOR = 0.3;
/** Seconds after a kick/knock before the dribble touch can act again. */
export const KICK_TOUCH_LOCKOUT = 0.25;

/** Tackle / slide. */
export const TACKLE_SPEED = 520;
export const TACKLE_DURATION = 0.32;
export const TACKLE_COOLDOWN = 0.9;
export const TACKLE_KNOCK_SPEED = 650;

export const COLORS = {
  player: 0x2a6fdb,
  playerOutline: 0x0b2a5e,
  playerFacing: 0xffffff,
  grass: 0x2e8b3d,
  grassStripe: 0x329a43,
  line: 0xffffff,
  background: 0x111111,
  goalNet: 0xdddddd,
} as const;
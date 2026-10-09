// Serialisable game state types. Plain JSON-friendly data only (no classes, Maps, functions).
export interface Vec2 {
  x: number;
  y: number;
}

/** A round thing that moves: ball or player. */
export interface CircleBody {
  pos: Vec2;
  vel: Vec2;
  radius: number;
}

/** 2D for now; a `z` height for lofted balls can be added later. */
export type BallState = CircleBody;

export type TeamId = 0 | 1;

export interface PlayerState extends CircleBody {
  id: number;
  team: TeamId;
  /** Facing angle in radians. */
  facing: number;
  /** Seconds the shoot button has been held (0 when not charging). Capped at SHOT_MAX_CHARGE_TIME. */
  charge: number;
  /** Seconds left in the current tackle slide (0 = not sliding). */
  tackleTimer: number;
  /** Seconds until another tackle may start. */
  tackleCooldown: number;
  /** Seconds until the dribble touch may nudge the ball again. */
  touchTimer: number;
  /** Previous-tick button states, for press/release edge detection. */
  prevPass: boolean;
  prevShoot: boolean;
  prevTackle: boolean;
}

/** One tick of input for one controller. Until T03, inputs[i] drives players[i]. */
export interface InputFrame {
  /** Increasing sequence number (used by netcode later). */
  seq: number;
  /** Move direction, each component -1..1. */
  moveX: number;
  moveY: number;
  pass: boolean;
  shoot: boolean;
  tackle: boolean;
  switchPlayer: boolean;
}

export interface GameState {
  /** Number of fixed steps simulated so far. */
  tick: number;
  ball: BallState;
  players: PlayerState[];
}

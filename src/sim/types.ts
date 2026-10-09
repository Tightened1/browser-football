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
}

/** One tick of input for one controller. */
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
  /** TEMPORARY (T01 debug): world point to kick the ball towards, or null. */
  kickTarget: Vec2 | null;
}

export interface GameState {
  /** Number of fixed steps simulated so far. */
  tick: number;
  ball: BallState;
  players: PlayerState[];
}

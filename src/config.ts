// All tunable constants live here.
import type { Difficulty } from './sim/types';

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

/** Teams: 5-a-side (1 keeper + 4 outfield). Team 0 defends the left goal, team 1 the right. */
export const PLAYERS_PER_TEAM = 5;
/** Soft player-vs-player pushing. */
export const PLAYER_PLAYER_RESTITUTION = 0.1;
export const COLLISION_ITERATIONS = 2;

/**
 * Starting formation (2-2) for the four outfield slots, as fractions of the pitch:
 * fx = distance from own goal line along the pitch (0..1), fy = across the pitch (0 = top).
 */
export const FORMATION: readonly { fx: number; fy: number }[] = [
  { fx: 0.22, fy: 0.3 },
  { fx: 0.22, fy: 0.7 },
  { fx: 0.4, fy: 0.3 },
  { fx: 0.4, fy: 0.7 },
];
/** Basic positioning: how far (0..1) an idle player is pulled from its formation spot towards the ball. */
export const BALL_PULL_X = 0.35;
export const BALL_PULL_Y = 0.25;
/** Keep idle players this far inside the pitch edges (px). */
export const AI_EDGE_MARGIN = 30;
/** Within this distance of the target an AI player slows down proportionally (px). */
export const AI_ARRIVE_RADIUS = 40;
/** Closer than this to the target, an AI player stops (px). */
export const AI_DEADZONE = 3;
/** Fraction of full speed idle outfield players move at. */
export const AI_MOVE_FACTOR = 0.8;

/** Switching: teammates between the ball and their own goal count as this many px closer. */
export const SWITCH_GOALSIDE_BIAS = 70;

/** Goalkeepers. */
export const KEEPER_RADIUS = 18;
/** Distance of the keeper's centre in front of its goal line (px). */
export const KEEPER_LINE_OFFSET = 24;
/** The keeper tracks the ball's y within +/- this of the goal centre (px). */
export const KEEPER_RANGE = 52;
export const KEEPER_ARRIVE_RADIUS = 30;
export const KEEPER_BALL_RESTITUTION = 0.15;
/** Inverse mass of the keeper vs the ball (small = a hard shot barely moves the keeper). */
export const KEEPER_INV_MASS = 0.1;
/** After touching a keeper the ball always leaves at least this fast, away from the goal (px/s). */
export const KEEPER_CLEAR_SPEED = 140;

export const TEAMS = [
  { name: 'Home', kit: 0x2a6fdb, keeper: 0xf2c94c, outline: 0x0b2a5e },
  { name: 'Away', kit: 0xd9372b, keeper: 0x2fbf71, outline: 0x5e1410 },
] as const;
export const CONTROL_RING_COLOR = 0xffffff;

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
/* ---------------------------------------------------------------------------------------------
 * AI (T04). The AI only ever produces InputFrames, so it can never move faster than a human.
 * ------------------------------------------------------------------------------------------- */

export type { Difficulty } from './sim/types';

export interface AiProfile {
  /** Seconds between decisions (also how long a player takes to react to a new situation). */
  reactionTime: number;
  /** Max random error added to pass and shot directions (radians). */
  aimError: number;
  /** Max movement input magnitude (0..1); 1 = a human's top speed. */
  speed: number;
  /** Seconds the keeper takes to react to a shot before moving/diving. */
  keeperReaction: number;
  /** Max distance (px) the keeper misjudges a shot's line by. */
  keeperError: number;
  /** Keeper's max movement input (0..1) when reacting to a shot (keepers dive rather than sprint across). */
  keeperSpeed: number;
  /** Chance (0..1) that a presser in range commits to a tackle on each decision. */
  tackleChance: number;
  /** Random noise added to on-ball decision scores (bigger = more erratic choices). */
  decisionNoise: number;
  /** How many players press the ball carrier (1 or 2). */
  pressers: number;
}

export const AI_PROFILES: Record<Difficulty, AiProfile> = {
  easy: { reactionTime: 0.38, aimError: 0.14, speed: 0.82, keeperReaction: 0.22, keeperError: 30, keeperSpeed: 0.55, tackleChance: 0.25, decisionNoise: 0.35, pressers: 1 },
  normal: { reactionTime: 0.24, aimError: 0.08, speed: 0.92, keeperReaction: 0.15, keeperError: 20, keeperSpeed: 0.65, tackleChance: 0.4, decisionNoise: 0.2, pressers: 1 },
  hard: { reactionTime: 0.14, aimError: 0.04, speed: 1, keeperReaction: 0.1, keeperError: 12, keeperSpeed: 0.75, tackleChance: 0.55, decisionNoise: 0.1, pressers: 2 },
};
/** Difficulty of a team with no human (the opponents, or both teams in AI vs AI). */
export const AI_DIFFICULTY: Difficulty = 'normal';
/** Difficulty of the AI teammates of a human player. */
export const AI_TEAMMATE_DIFFICULTY: Difficulty = 'normal';
/** Both teams AI-controlled (spectate). Can also be turned on with ?aivsai in the URL. */
export const AI_VS_AI = false;
/** Seed for the AI's random number generator (stored in the game state, so the AI is deterministic). */
export const AI_SEED = 20261012;

/** Team modes: seconds a team stays "transitioning" after possession changes hands. */
export const AI_TRANSITION_TIME = 0.8;
/** The last toucher still "has" the ball within this gap beyond touching (covers dribble touches, px). */
export const AI_POSSESSION_SLACK = 26;
/** Ball prediction for interceptions: horizon (s) and sample step (s). */
export const AI_PREDICT_HORIZON = 1.6;
export const AI_PREDICT_STEP = 0.1;

/** Off-ball shape. Defenders stay at least this far behind the ball when attacking (px). */
export const AI_DEF_BEHIND_BALL = 230;
/** ...and never further upfield than this fraction of the pitch from their own goal. */
export const AI_DEF_MAX_ADVANCE = 0.55;
/** Attackers try to stay this far ahead of the ball when attacking (px). */
export const AI_ATT_AHEAD_OF_BALL = 130;
/** Space-finding: radius of candidate spots around an attacker's base position (px). */
export const AI_SPACE_SEARCH_RADIUS = 90;
/** Chance per decision that an attacker with space ahead starts a forward run, and its length (s). */
export const AI_RUN_CHANCE = 0.25;
export const AI_RUN_TIME = 1.6;
/** Teammates' targets closer than this push apart, so players don't bunch (px). */
export const AI_SEPARATION = 90;
/** Marking: gap kept goal-side of the marked opponent, for defenders and for attackers helping (px). */
export const AI_MARK_DISTANCE_DEF = 32;
export const AI_MARK_DISTANCE_ATT = 70;
/** Fraction of the profile speed used for calm positional moves (pressing/chasing use full speed). */
export const AI_SHAPE_SPEED = 0.85;

/** Pressing: the presser aims for a spot this far goal-side of the carrier (px). */
export const AI_PRESS_OFFSET = 34;
/** A second presser joins when the carrier is within this distance of our goal (px), even if pressers = 1. */
export const AI_DANGER_ZONE = 330;
/** Start a slide tackle when the ball is within this distance (px) and roughly in front. */
export const AI_TACKLE_RANGE = 62;

/** On the ball. Max shooting distance from the goal centre (px). */
export const AI_SHOOT_RANGE = 400;
/** Minimum angle (radians) the goal mouth must cover from the shooter's spot. */
export const AI_MIN_SHOT_ANGLE = 0.12;
/** An opponent within this distance counts as pressure on the carrier (px). */
export const AI_PRESSURE_RADIUS = 75;
/** A pass/shot lane is blocked by an opponent within this distance of it, plus a growth per px of lane. */
export const AI_LANE_WIDTH = 26;
export const AI_LANE_GROWTH = 0.17;
/** Pass lengths outside this range are penalised (px). */
export const AI_PASS_MIN = 70;
export const AI_PASS_MAX = 620;
/** Speed (px/s) a pass should still have when it reaches the receiver. */
export const AI_PASS_ARRIVE_SPEED = 240;
/** Give up on a pass/shot that hasn't been struck after this long (s). */
export const AI_KICK_TIMEOUT = 1.2;
/** Extra score for passing to the human on the AI teammates' side. */
export const AI_PASS_TO_HUMAN_BONUS = 0.15;

/** Keeper. Max distance it comes off its line when positioning on the angle (px). */
export const AI_KEEPER_MAX_OUT = 62;
/** It rushes out for a loose ball (or a carrier) within this distance of its goal line (px). */
export const AI_KEEPER_RUSH_RANGE = 170;
/** A ball moving at least this fast towards goal counts as a shot (px/s). */
export const AI_SHOT_DETECT_SPEED = 260;
/** Only react to shots arriving within this time (s). */
export const AI_SHOT_DETECT_TIME = 0.9;

/** Temporary (until T05 adds proper rules): seconds a ball stays in the net before a kickoff reset. */
export const GOAL_RESET_DELAY = 1.2;

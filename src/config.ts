// All tunable constants live here.
import type { Difficulty } from './sim/types';
import { turnServersFromEnv } from './net/ice';

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
/** Mown stripes across the pitch. */
export const PITCH_STRIPES = 14;

/** Match timing: 2 halves of 3 minutes. */
export const HALVES = 2;
export const HALF_LENGTH_SECONDS = 3 * 60;
/** Shots (match stats): a shoot-button kick within this distance of the goal line it attacks, aimed this far forward (cosine of the angle). */
export const STAT_SHOT_RANGE = 450;
export const STAT_SHOT_MIN_FORWARD = 0.3;

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

/**
 * Dribbling style (T13). 'sticky': a player who controls the ball carries it a short, fixed distance in front of them
 * (GameState.possession) until it is kicked, tackled away or lost. 'classic': the old T02 dribble, where each touch
 * nudges the ball ahead and it runs free in between (DRIBBLE_BOOST, DRIBBLE_TOUCH_INTERVAL, DRIBBLE_CONE).
 */
export type DribbleMode = 'sticky' | 'classic';
export const DRIBBLE_MODE: DribbleMode = 'sticky';
/** Sticky: gap between the carrier's body and the held ball (px), plus a small in-and-out roll so it doesn't look glued. Gap + roll must stay within KICK_REACH. */
export const DRIBBLE_HOLD_GAP = 1.5;
export const DRIBBLE_ROLL_AMPLITUDE = 5;
/** Distance run (px) per roll of the ball out and back in. */
export const DRIBBLE_ROLL_PERIOD = 46;
/** How fast the ball swings round the carrier to follow their facing (rad/s): turning carries it round, never teleports it. */
export const DRIBBLE_TURN_RATE = 9;
/** How quickly the held ball closes on its spot (1/s): each tick it covers 1 - e^(-k*dt) of the gap (100 = 81%). */
export const DRIBBLE_HOLD_STIFFNESS = 100;
/** Running with the ball is a little slower than without it (fraction of PLAYER_MAX_SPEED). */
export const DRIBBLE_SPEED_FACTOR = 0.9;
/** Taking control of a loose ball: it must be within this gap of the body (px) and moving at most this fast relative to the player (px/s). */
export const DRIBBLE_CONTROL_REACH = 4;
export const DRIBBLE_CONTROL_SPEED = 280;
/** A teammate's pass is controlled up to this relative speed (px/s); harder balls (shots) bounce off. */
export const DRIBBLE_PASS_CONTROL_SPEED = 900;
/** Body check: an opponent within this gap of the held ball (px), in front of the carrier (within this angle of where the ball sits, rad), knocks it loose. */
export const DRIBBLE_CHECK_REACH = 5;
export const DRIBBLE_CHECK_CONE = 1.6;
/** Speed (px/s) a body check knocks the ball loose at, away from the opponent. */
export const DRIBBLE_CHECK_KNOCK_SPEED = 160;
/** Very sharp turns at full speed lose the ball (it runs on). Optional. */
export const DRIBBLE_SHARP_TURN_LOSS = true;
/** ...a turn of at least this angle (rad) between the move keys and the running direction, at this fraction of the carrying speed or more. */
export const DRIBBLE_SHARP_TURN_ANGLE = 2.5;
export const DRIBBLE_SHARP_TURN_SPEED = 0.95;
/** After losing the ball (tackle, body check, sharp turn) the old carrier can't take it straight back for this long (s). */
export const DRIBBLE_REGAIN_LOCKOUT = 0.4;

/**
 * Kick buffer (T13): a pass press or shot release while the ball is out of reach is kept for this long (s) and fires
 * as soon as the player gets the ball, so no kick is ever silently dropped.
 */
export const KICK_BUFFER_TIME = 0.25;
/** "Kick fired" flash (s). For this long after a kick the ball also passes through the kicker's own body (a kick behind you). */
export const KICK_FLASH_TIME = 0.15;

/** A ball that is merely within reach of a player only counts as touched by them if it moves slower than this relative to them (px/s). */
export const TOUCH_MAX_RELATIVE_SPEED = 90;

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
/** Cooldown after starting an outfield slide. A slide that misses is punished: it can't be spammed. */
export const TACKLE_COOLDOWN = 1.3;
/** A slide that connects with the ball is forgiven: the cooldown drops to at most this (s, counted from the slide's start). */
export const TACKLE_HIT_COOLDOWN = 0.5;
/** A keeper's dive uses its own, shorter cooldown. */
export const KEEPER_DIVE_COOLDOWN = 0.9;
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
export const KEEPER_CLEAR_SPEED = 240;
/**
 * Sticky dribbling: a keeper inside its own penalty box catches (holds) a ball arriving at up to this relative speed
 * (px/s); harder shots are parried as before. A keeper holding the ball can't be tackled or body-checked.
 */
export const KEEPER_CATCH_SPEED = 850;

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
  grassStripe: 0x35a346,
  grassSurround: 0x23702f,
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
  easy: { reactionTime: 0.38, aimError: 0.14, speed: 0.82, keeperReaction: 0.22, keeperError: 30, keeperSpeed: 0.6, tackleChance: 0.55, decisionNoise: 0.35, pressers: 2 },
  normal: { reactionTime: 0.24, aimError: 0.08, speed: 0.92, keeperReaction: 0.1, keeperError: 28, keeperSpeed: 0.75, tackleChance: 0.7, decisionNoise: 0.2, pressers: 2 },
  hard: { reactionTime: 0.14, aimError: 0.04, speed: 1, keeperReaction: 0.07, keeperError: 12, keeperSpeed: 0.85, tackleChance: 0.8, decisionNoise: 0.1, pressers: 2 },
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

/** A loose ball this close to our own goal (fraction of the pitch length) is approached from the goal side, so it is never nudged into our net. */
export const AI_OWN_GOAL_DANGER = 0.3;

/** The "goal mouth" the keeper owns: this far from our own goal line (px) and this far beyond the posts sideways (px). */
export const AI_GOAL_MOUTH_DEPTH = 110;
export const AI_GOAL_MOUTH_MARGIN = 30;

/** Pressing: the presser aims for a spot this far goal-side of the carrier (px). */
export const AI_PRESS_OFFSET = 34;
/** Sticky dribbling: a goal-side presser this close to the carrier (px) steps in to the ball to win it. */
export const AI_PRESS_ENGAGE = 60;
/** A carrier under pressure strikes after at most this much charge (s) instead of waiting for the full charge. */
export const AI_QUICK_SHOT_CHARGE = 0.1;
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

/* ---------------------------------------------------------------------------------------------
 * Match rules (T05)
 * ------------------------------------------------------------------------------------------- */

/** Seconds players stand in formation before a kickoff (also at the start of the match). */
export const KICKOFF_DELAY = 1;
/** Seconds of "GOAL!" before the next kickoff. */
export const GOAL_PAUSE = 2;
/** Seconds of half-time before the second half. */
export const HALF_TIME_PAUSE = 4;
/** A restart (kickoff, throw-in, goal kick, corner) is released after this long if nobody has played the ball. */
export const RESTART_AUTO_DELAY = 1;
/** The team not taking a restart is kept this far from the ball until it is released (px). */
export const RESTART_CLEAR_RADIUS = 90;
/**
 * Throw-ins and corners: the ball is placed this far inside the pitch lines (px) and the taker stands on the line side of
 * it, facing into the pitch (so a touch sends the ball into play, never back out). Room for the taker's whole body.
 */
export const RESTART_INSET = 2 * PLAYER_RADIUS + BALL_RADIUS + 3;
/** Throw-ins are taken at least this far from the end lines (px). */
export const THROW_IN_MIN_END_DISTANCE = 60;
/** Goal-kick spot: distance from the goal line (px). */
export const GOAL_KICK_DISTANCE = 70;
/** Gap between the taker and the ball when placed (px). */
export const RESTART_TAKER_GAP = 2;
/** The ball moving this far from its spot means the restart has been played (px). */
export const RESTART_PLAYED_DISTANCE = 3;
/** A ball moving slower than this (px/s) with its centre beyond a line is out of play, even if not wholly over it. */
export const OUT_REST_SPEED = 30;
/** How many recent events the state keeps. */
export const MAX_EVENTS = 40;

/* ---------------------------------------------------------------------------------------------
 * Networking (T06). PeerJS: the broker only introduces the two browsers (signalling); game data
 * then flows directly between them over a WebRTC data channel.
 * ------------------------------------------------------------------------------------------- */

/** Signalling broker: the free public PeerJS cloud server. */
export const PEER_SERVER = { host: '0.peerjs.com', port: 443, path: '/', secure: true } as const;
/** PeerJS log level in the browser console: 0 none, 1 errors, 2 warnings, 3 everything. */
export const PEER_DEBUG_LEVEL = 1;
/** The broker is shared with every other PeerJS app, so our peer IDs get a unique prefix. */
export const PEER_ID_PREFIX = 'browser-football-';

/** STUN: lets each browser discover its public address, so a direct connection can be made. */
export const STUN_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

/* ===== TURN SERVERS (T08) ======================================================================
 * TURN relays the game data when a direct connection is impossible (strict corporate, school or
 * mobile networks). Set-up steps: docs/NETWORK_TESTING.md. Two ways, both read at BUILD time from
 * env variables (.env.local on your machine, GitHub repository secrets for the live site), so no
 * keys are committed to git. Note they still end up in the published JavaScript.
 *   A) A URL that returns ICE servers as JSON (recommended):
 *        VITE_TURN_CREDENTIALS_URL=https://<app>.metered.live/api/v1/turn/credentials?apiKey=<key>
 *      or the address of your own Cloudflare Worker that mints short-lived Cloudflare TURN credentials.
 *   B) Fixed credentials:
 *        VITE_TURN_URLS=turn:host:80,turn:host:443?transport=tcp,turns:host:443?transport=tcp
 *        VITE_TURN_USERNAME=...   VITE_TURN_CREDENTIAL=...
 * Nothing set = no relay: players on strict networks can't connect (the diagnostics screen says so).
 * ============================================================================================= */
const env = import.meta.env ?? {};
export const TURN_SERVERS: RTCIceServer[] = turnServersFromEnv(env.VITE_TURN_URLS, env.VITE_TURN_USERNAME, env.VITE_TURN_CREDENTIAL);
export const TURN_CREDENTIALS_URL: string = env.VITE_TURN_CREDENTIALS_URL ?? '';
/** Give up fetching TURN credentials after this long and carry on without the relay (ms). */
export const TURN_FETCH_TIMEOUT_MS = 4_000;
/** Reuse fetched TURN credentials for this long before fetching fresh ones (ms). Keep below their lifetime. */
export const TURN_CACHE_MS = 30 * 60_000;

/** STUN plus any fixed TURN servers. Fetched TURN servers are added at connect time (net/peer.ts loadIceServers). */
export const ICE_SERVERS: RTCIceServer[] = [...STUN_SERVERS, ...TURN_SERVERS];

/**
 * Relay fallback. WebRTC tries the direct routes and the relay at the same time and prefers direct; if that whole
 * attempt still fails, the guest tries once more with relay only. With a relay available, the first attempt
 * gets this long before the relay-only retry (which then gets NET_CONNECT_TIMEOUT_MS).
 */
export const NET_RELAY_RETRY = true;
export const NET_DIRECT_ATTEMPT_TIMEOUT_MS = 10_000;
/** How often an open connection re-checks whether it is direct or relayed (ms). */
export const NET_ROUTE_CHECK_MS = 3_000;
/** Connection diagnostics: time allowed for collecting candidates, and for the relay round trip (ms). */
export const DIAG_GATHER_TIMEOUT_MS = 10_000;
export const DIAG_RELAY_TIMEOUT_MS = 12_000;

/** Room codes look like PASS-4827: a word from this list plus digits (no 0/1, and no I/L/O in the words). */
export const ROOM_CODE_WORDS = [
  'PASS', 'SAVE', 'TEAM', 'NETS', 'KEEP', 'HEAD', 'MARK', 'RUSH',
  'TURF', 'FANS', 'DASH', 'JUMP', 'BEND', 'PUNT', 'CAPS', 'STAR',
] as const;
export const ROOM_CODE_DIGITS = '23456789';
export const ROOM_CODE_DIGIT_COUNT = 4;
/** If a generated room code is already in use, try this many new ones before giving up. */
export const ROOM_CODE_ATTEMPTS = 4;

/** Give up if the broker hasn't registered us within this time (ms). */
export const NET_BROKER_TIMEOUT_MS = 10_000;
/** Give up if the peer-to-peer connection hasn't opened within this time (ms). */
export const NET_CONNECT_TIMEOUT_MS = 15_000;
/** After the connection opens, the hello/welcome exchange must finish within this time (ms). */
export const NET_HANDSHAKE_TIMEOUT_MS = 6_000;
/** How often each side pings the other (ms). */
export const NET_PING_INTERVAL_MS = 1_000;
/** The connection counts as lost if nothing at all arrives for this long (ms). */
export const NET_LINK_TIMEOUT_MS = 8_000;
/** Weight of the newest sample in the smoothed ping (0..1). */
export const NET_PING_SMOOTHING = 0.3;
/** Delay before closing a connection after a final message (reject/bye), so it gets delivered (ms). */
export const NET_CLOSE_FLUSH_MS = 400;

/* ---------------------------------------------------------------------------------------------
 * Netcode (T07). The host runs the only simulation; the guest sends inputs and draws snapshots.
 * ------------------------------------------------------------------------------------------- */

/** The host sends a snapshot every this many sim ticks (2 at 60 Hz = 30 snapshots a second). */
export const NET_SNAPSHOT_INTERVAL_TICKS = 2;
/** The guest draws the match this far behind the newest snapshot, so it always has two to interpolate between (ms). */
export const NET_INTERP_DELAY_MS = 100;
/** Snapshots kept by the guest (older ones are dropped). */
export const NET_SNAPSHOT_BUFFER_SIZE = 32;
/** When snapshots stop arriving, keep moving things along their velocity for at most this long, then freeze (ms). */
export const NET_MAX_EXTRAPOLATION_MS = 100;
/** Between two snapshots, anything that moved further than this teleported (kickoff reset, set piece): snap, don't slide (px). */
export const NET_TELEPORT_DISTANCE = 40;
/** The render clock jumps instead of drifting when it is this far off its target (ticks). */
export const NET_CLOCK_RESET_TICKS = 30;
/** How fast the render clock adapts to snapshots arriving earlier / later than expected (0..1 per snapshot). */
export const NET_CLOCK_ADAPT_EARLY = 0.2;
export const NET_CLOCK_ADAPT_LATE = 0.02;

/**
 * Guest kicks from its own (predicted) dribble leave the foot straight away on the guest's screen: the ball is drawn
 * ahead of the host's (older) ball by the prediction lead, and that lead is wound down at this rate (seconds of lead per
 * second), so the ball always moves forwards. Unconfirmed after NET_KICK_CONFIRM_MS beyond the lead: the host's ball wins.
 */
export const NET_KICK_LEAD_DECAY = 0.5;
export const NET_KICK_CONFIRM_MS = 250;

/** Every input packet repeats the guest's last few input frames, so a lost packet loses no key press. */
export const NET_INPUT_REDUNDANCY = 4;
/** The host buffers at most this many unplayed guest inputs; beyond that, the oldest are merged (keeps input lag low). */
export const NET_INPUT_BUFFER_MAX = 3;

/** Client-side prediction of the guest's own controlled player (movement only). Can be turned off with ?predict=0. */
export const NET_PREDICTION = true;
/**
 * Near the ball the predicted player would run ahead of the (older) ball, so the drawn position blends back to the
 * host's: fully predicted beyond FAR px between player and ball edges, fully authoritative within NEAR px.
 */
export const NET_PREDICT_BLEND_NEAR = 25;
export const NET_PREDICT_BLEND_FAR = 110;
/** The blend eases towards its new value at this rate (1/s), e.g. when the ball is won or lost (T13). */
export const NET_PREDICT_BLEND_RATE = 4;
/** Prediction corrections are smoothed out with this half-life (s) instead of snapping. */
export const NET_CORRECTION_HALF_LIFE = 0.08;
/** A correction bigger than this snaps straight away (px). */
export const NET_CORRECTION_SNAP = 60;
/** The same for the drawn ball when it switches between predicted and the host's: it runs further ahead (px). */
export const NET_BALL_CORRECTION_SNAP = 150;

/** Pause the match when nothing has arrived from the other player for this long (ms). */
export const NET_STALL_MS = 1_500;
/** After a dropped connection, the guest may reconnect to the same room within this time (ms), else the match ends. */
export const NET_RECONNECT_WINDOW_MS = 30_000;
/** The guest retries the connection this often while reconnecting (ms). */
export const NET_RECONNECT_RETRY_MS = 3_000;
/** Countdown before play resumes after a pause (ms). */
export const NET_RESUME_COUNTDOWN_MS = 2_000;
/** RTCDataChannel id of the unreliable channel (negotiated on both sides; PeerJS's own channel uses a low id). */
export const NET_FAST_CHANNEL_ID = 100;

/**
 * Simulated network conditions, for testing two windows on one machine. Applied by each side to what it sends:
 * latencyMs is added one way (so ping goes up by about twice that), jitterMs is a random extra 0..jitterMs, and
 * loss (0..1) drops packets on the unreliable channel only. Override from the URL: ?lag=50&jitter=20&loss=0.05.
 */
export const NET_SIMULATION = { latencyMs: 0, jitterMs: 0, loss: 0 };

/* ---------------------------------------------------------------------------------------------
 * Juice & audio (T10). Everything here is render/audio side: it reacts to the drawn state and its
 * events and never touches the simulation, so the online guest gets exactly the same effects.
 * ------------------------------------------------------------------------------------------- */

/** Ball cues are found by watching the drawn ball: a velocity change this big (px/s) within CUE_WINDOW seconds is a kick or bounce. */
export const CUE_MIN_DELTA_V = 240;
export const CUE_WINDOW = 0.05;
/** Minimum gap between two ball sounds (s). */
export const CUE_COOLDOWN = 0.12;
/** Ball speeds (px/s) mapped to kick "power" 0 (soft) .. 1 (hard). */
export const CUE_POWER_MIN_SPEED = 250;
export const CUE_POWER_MAX_SPEED = 1150;
/** The ball is "at a post" within this gap beyond touching (px). */
export const CUE_POST_REACH = 10;

/** Audio levels (0..1, before the volume setting). */
export const AUDIO_MASTER_GAIN = 0.9;
export const AUDIO_CROWD_BASE = 0.05;
export const AUDIO_CROWD_EXCITED = 0.14;

/** Camera: 'auto' follows the ball only when the pitch is drawn small, 'wide' never, 'follow' always. */
export type CameraMode = 'auto' | 'wide' | 'follow';
export const CAMERA_DEFAULT_MODE: CameraMode = 'auto';
/** 'auto' follows when the canvas is drawn at less than this fraction of the pitch's own size. */
export const CAMERA_AUTO_MIN_SCALE = 0.8;
export const CAMERA_FOLLOW_ZOOM = 1.5;
/** Look-ahead: the camera aims at the ball plus its velocity times this (s), at most CAMERA_MAX_LOOKAHEAD px away. */
export const CAMERA_LOOKAHEAD = 0.3;
export const CAMERA_MAX_LOOKAHEAD = 150;
/** How quickly the camera catches up (1/s, higher = snappier) and changes zoom. */
export const CAMERA_SMOOTH = 4;
export const CAMERA_ZOOM_SMOOTH = 3;

/** Visuals. */
export const FX_MAX_PARTICLES = 300;
export const FX_DUST_COLOR = 0xd9d2a8;
/** Ball "height" fake: speeds (px/s) over which a fast ball grows and its shadow detaches. */
export const FX_LIFT_MIN_SPEED = 450;
export const FX_LIFT_MAX_SPEED = 1100;
export const FX_LIFT_SCALE = 0.35;
/** Goal celebration: a light screen shake (ms, camera shake intensity), a zoom punch and confetti. */
export const FX_SHAKE_MS = 260;
export const FX_SHAKE_INTENSITY = 0.006;
export const FX_ZOOM_PUNCH = 0.05;
export const FX_CONFETTI_COUNT = 90;
/** Net ripple: seconds it lasts, and how far (px) the net bulges at most. */
export const FX_RIPPLE_SECONDS = 1.1;
export const FX_RIPPLE_AMPLITUDE = 14;
/** Net mesh spacing (px). */
export const NET_CELL = 7;

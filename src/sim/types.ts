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

export type PlayerRole = 'keeper' | 'outfield';

export interface PlayerState extends CircleBody {
  /** Index in GameState.players. */
  id: number;
  team: TeamId;
  role: PlayerRole;
  /** Formation slot within the team: 0 = keeper, 1..4 = outfield. */
  slot: number;
  /** Shirt number shown above the controlled player. */
  number: number;
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
  /** Kick buffer: seconds left on a queued kick (0 = none), its ball speed, aim (radians) and whether it is a shot. */
  kickQueue: number;
  queuedSpeed: number;
  queuedAim: number;
  queuedShot: boolean;
  /** Seconds left of the "kick fired" window (0 = none): the cue shows and the ball passes through the kicker. */
  kickFlash: number;
  /** Previous-tick button states, for press/release edge detection. */
  prevPass: boolean;
  prevShoot: boolean;
  prevTackle: boolean;
}

/** One tick of input for one human controller; inputs[team] drives that team's controlled player. */
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

export type Difficulty = 'easy' | 'normal' | 'hard';

/** What a whole team is doing: has the ball, hasn't, or it just changed hands / is loose. */
export type TeamMode = 'attacking' | 'defending' | 'transitioning';

/** AI role, from the formation slot: keeper, defenders (slots 1-2), attackers (slots 3-4). */
export type AiRole = 'keeper' | 'defender' | 'attacker';

/** What an AI player is currently trying to do (shown in the debug overlay). */
export type AiIntent =
  // off the ball
  | 'support' // attacking shape, finding space
  | 'run' // forward run into space
  | 'receive' // a pass is coming to me
  | 'chase' // loose ball, I'm the closest
  | 'press' // closing down the carrier
  | 'cover' // second presser, cutting off the carrier's path
  | 'mark' // goal-side of an opponent
  | 'recover' // sprinting back into shape after losing the ball
  // on the ball
  | 'dribble'
  | 'pass'
  | 'shoot'
  | 'clear'
  // keeper
  | 'position'
  | 'rush'
  | 'save'
  | 'distribute'
  // controlled by a human
  | 'human';

export interface AiPlayerMemory {
  intent: AiIntent;
  /** Where the player is heading (for the debug overlay). */
  target: Vec2;
  /** Seconds until the next decision. */
  thinkTimer: number;
  /** Pass/shot: point aimed at, error angle added (radians), wanted ball speed, receiver id (-1 = none). */
  kickTarget: Vec2;
  kickError: number;
  kickSpeed: number;
  receiver: number;
  /** Seconds spent trying to execute the current pass/shot. */
  kickTimer: number;
  /** A kick input went out last tick; confirmed (and counted) on the next. */
  kickPending: boolean;
  /** Seconds after a kick during which the player doesn't treat the ball as theirs. */
  cooldown: number;
  /** Opponent being marked or pressed (-1 = none). */
  markId: number;
  /** Support: space-finding offset from the shape position. Run: the run's destination. */
  offset: Vec2;
  /** Seconds left of a forward run. */
  runTimer: number;
  /** Presser: decided to slide in once in range. */
  tackleArmed: boolean;
  /** Keeper: seconds left before reacting to a shot (-1 = no shot seen). */
  shotReact: number;
  /** Keeper: how far off (px) it has misjudged the current shot's line. */
  saveError: number;
}

export interface AiTeamMemory {
  mode: TeamMode;
  /** Seconds left in the transitioning mode. */
  modeTimer: number;
  /** Team that had the ball last tick (-1 = loose), to detect possession changes. */
  lastPossession: number;
  /** Pass in flight: intended receiver (-1 = none) and seconds it counts as ours. */
  passReceiver: number;
  passTimer: number;
  /** This team's last shot is still travelling (a keeper touch now counts as a save). */
  shotLive: boolean;
  /** Counters (for the debug overlay and tuning). */
  passes: number;
  shots: number;
  tackles: number;
  saves: number;
}

export interface AiState {
  /** Seeded PRNG state (mulberry32). Never use Math.random in the sim. */
  rng: number;
  difficulty: [Difficulty, Difficulty];
  teams: [AiTeamMemory, AiTeamMemory];
  /** One entry per player, same index as GameState.players. */
  players: AiPlayerMemory[];
  /** Last toucher seen by the AI (-1 = none), to spot saves. */
  lastToucher: number;
}

/** One goal, for the results screen. */
export interface GoalRecord {
  /** Scoring team (for an own goal, the team that benefits). */
  team: TeamId;
  /** Player who touched the ball last (-1 = unknown). */
  player: number;
  ownGoal: boolean;
  half: number;
  /** Seconds played in that half. */
  clock: number;
}

/** Simple match statistics, kept by the sim (so the host can send them to the guest at full time). */
export interface MatchStats {
  /** Shots per team: shoot-button kicks from the attacking part of the pitch, heading for goal. */
  shots: [number, number];
  /** Seconds each team had possession (the last team to touch the ball, while the ball is in play). */
  possession: [number, number];
  goals: GoalRecord[];
}

export interface GameState {
  /** Number of fixed steps simulated so far. */
  tick: number;
  ball: BallState;
  players: PlayerState[];
  /** Id of the player each team's human controls, or -1 if the team has no human. */
  controlled: [number, number];
  /** Direction (+1 right / -1 left along x) each team attacks. */
  attackDir: [number, number];
  /** Sticky dribbling: who is carrying the ball (null = loose, and always null in 'classic' DRIBBLE_MODE). */
  possession: Possession | null;
  /** Last team/player to touch the ball (null before the first touch). */
  lastTouch: { team: TeamId; player: number } | null;
  /** Previous-tick switch button per team, for press edge detection. */
  prevSwitch: [boolean, boolean];
  /** AI memory and its random number generator. */
  ai: AiState;
  /** Match flow (rules.ts). */
  phase: MatchPhase;
  /** Seconds spent in the current phase (counts down for the timed phases: see rules.ts). */
  phaseTimer: number;
  /** Seconds in each half (match length / 2). */
  halfLength: number;
  /** 1 or 2. */
  half: number;
  /** Seconds played in the current half. */
  clock: number;
  /** Goals per team. */
  score: [number, number];
  /** Team taking (or that took) the current kickoff, and the team that kicked off the match. */
  kickoffTeam: TeamId;
  firstKickoffTeam: TeamId;
  /** A set piece waiting to be taken (kickoff, throw-in, goal kick, corner), or null in open play. */
  restart: Restart | null;
  /** The most recent events (capped), oldest first. Consumers remember the last `id` they handled. */
  events: MatchEvent[];
  nextEventId: number;
  stats: MatchStats;
}

/** A player carrying the ball (sticky dribbling). */
export interface Possession {
  /** Carrier's player id. */
  player: number;
  /** Where the ball sits around the carrier (radians); swings towards their facing at DRIBBLE_TURN_RATE. */
  angle: number;
  /** Distance run with the ball (px, wraps at DRIBBLE_ROLL_PERIOD): drives the ball's little roll out and back. */
  roll: number;
}

export type MatchPhase ='pre-kickoff' | 'playing' | 'goal-scored' | 'half-time' | 'full-time';

export type RestartType = 'kickoff' | 'throw-in' | 'goal-kick' | 'corner';

export interface Restart {
  type: RestartType;
  team: TeamId;
  /** Where the ball is placed. */
  pos: Vec2;
  /** Player id placed next to the ball to take it. */
  taker: number;
  /** Seconds until the restart is released automatically (the opposition keeps clear until then). */
  timer: number;
}

export type MatchEventType = 'kickoff' | 'goal' | 'throw-in' | 'goal-kick' | 'corner' | 'half-time' | 'second-half' | 'full-time';

export interface MatchEvent {
  /** Increasing; never reused within a match. */
  id: number;
  tick: number;
  type: MatchEventType;
  /** goal: scoring team. Restarts and kickoff: the team taking it. */
  team?: TeamId;
  /** goal: player who touched the ball last (-1 if unknown). */
  player?: number;
  ownGoal?: boolean;
  half: number;
  /** Seconds played in the half when it happened. */
  clock: number;
  score: [number, number];
}

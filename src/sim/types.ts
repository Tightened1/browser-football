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

/** 2D (no height: see docs/PLAYTEST_NOTES.md, T15, for how a chip could be added). */
export interface BallState extends CircleBody {
  /** Curl (T15 finesse shot): how fast the ball's direction of travel turns (rad/s, + = clockwise on screen). 0/absent = straight. */
  spin?: number;
}

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
  /** Seconds the shoot button has been held (0 when not charging). Capped at the rules' shotChargeTime. */
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
  /** The queued kick is a finesse shot (T15). */
  queuedFinesse: boolean;
  /** Shoot is still held after a finesse shot fired: its release kicks nothing. */
  shootSpent: boolean;
  /** Seconds left of the "kick fired" window (0 = none): the cue shows and the ball passes through the kicker. */
  kickFlash: number;
  /** Previous-tick button states, for press/release edge detection. */
  prevPass: boolean;
  prevShoot: boolean;
  prevTackle: boolean;
  prevFeint: boolean;
  /** Seconds left of a slide's wind-up (T17, AI slides only): the slide starts when it reaches 0. */
  windup: number;
  /** Seconds until this player may try another standing tackle after a failed one (T17). */
  standCooldown: number;
  /** Sprint stamina, 0..1 (T17); `sprintLock` = emptied, waiting for SPRINT_RESUME. */
  stamina: number;
  sprintLock: boolean;
  /** Sprinting / shielding the ball this tick (T17). */
  sprinting: boolean;
  shielding: boolean;
  /** Seconds left of a feint (T17), and until the next one is allowed. */
  feintTimer: number;
  feintCooldown: number;
  /**
   * T19, the referee: the current slide has touched the ball; has been judged (one call per slide); the opponent it
   * reached before the ball (-1 = none yet), on which tick and where -- a foul unless it gets the ball straight after.
   */
  slideBall: boolean;
  slideJudged: boolean;
  slideVictim: number;
  slideContactTick: number;
  slideSpotX: number;
  slideSpotY: number;
  /** T19: seconds since this player last kicked the ball (capped), for late tackles. */
  kickAge: number;
  /** T19: yellow cards this half, and sent off (two yellows) for the rest of the half: parked off the pitch, out of play. */
  yellow: number;
  sentOff: boolean;
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
  /** T17: run faster while held (uses stamina). */
  sprint?: boolean;
  /** T17: with the ball, held: shield it (slow, ball kept away from the nearest opponent). */
  shield?: boolean;
  /** T17: a double-tapped move key (one frame): with the ball, drag it across that way (feint). */
  feint?: boolean;
}

export type Difficulty = 'easy' | 'normal' | 'hard';

/** How hard the AI defends against a human on the ball (T17): AI_DEFENDING_VS_HUMAN in config.ts. */
export type AiDefending = 'relaxed' | 'normal' | 'tough';

/** Match-rules presets (T15): 'arcade' makes scoring easier, 'classic' is the game as it was before T15. */
export type RulesPreset = 'arcade' | 'classic';
/** How strict the referee is (T19): 'off' = no fouls (the game before T19). */
export type FoulStrictness = 'off' | 'lenient' | 'strict';
/** What happens to a drawn match (T19): it stays a draw, a penalty shoot-out, or golden-goal extra time (then a shoot-out). */
export type DrawRule = 'off' | 'shootout' | 'golden-goal';

/** Keeper skill: a fixed difficulty, or 'team' = the same as the rest of its team's AI. */
export type KeeperLevel = Difficulty | 'team';

/**
 * The match rules in force (T15). Fixed for a match and part of the state, so the host's choice travels to the guest
 * (in the lobby and the `start` message) and both run the same rules. Presets: MATCH_RULES in config.ts.
 */
export interface MatchRules {
  preset: RulesPreset;
  /** Goal mouth width (px): GOAL_WIDTH (normal) or GOAL_WIDTH_BIG. */
  goalWidth: number;
  /** Keepers' skill, independent of the outfield AI difficulty. */
  keeperDifficulty: KeeperLevel;
  /** A keeper catches (holds) balls up to this relative speed (px/s); faster ones are parried. */
  keeperCatchSpeed: number;
  /** Keepers are human about it: slower to react (more so on easy/normal and to far-corner shots), can't quite reach the post, and smother from closer in. */
  keeperFlaws: boolean;
  /** Charge time (s) for a full-power shot. */
  shotChargeTime: number;
  /** A shot aimed roughly at goal from shooting range bends a little towards the nearer open corner. */
  aimAssist: boolean;
  /** Hold shoot and tap pass: a slower, curled shot placed near a post. */
  finesse: boolean;
  /** Draw an aim line while charging a shot inside shooting range (render only). */
  aimLine: boolean;
  /** Against a human on the ball the AI presses with one player, and doesn't slide in from behind in its box. */
  easedDefending: boolean;
  /** "AI defending vs humans" (T17): the AI's tackle profile against a human carrier. AI vs AI is unaffected. */
  aiDefending: AiDefending;
  /** T19: fouls (slides into the player before the ball or from behind, clearly late challenges) and how strictly they are called. */
  fouls: FoulStrictness;
  /** T19: a reckless slide is a yellow card; two in a half and the player is sent off for the rest of it. */
  cards: boolean;
  /** T19: a draw at full time goes to a penalty shoot-out, or golden-goal extra time first. */
  draws: DrawRule;
}

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
  // set pieces (T19)
  | 'wall'
  | 'penalty'
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
  /** T17: seconds left of shielding the ball; the tackler whose wind-up we already decided about (-1 = none). */
  shieldTimer: number;
  evadedFrom: number;
  /** T17: seconds left of being wrong-footed by a feint. */
  fooled: number;
  /** T19 penalties: the side chosen (-1 / 0 / +1 across the goal, 9 = not decided yet), and a placed (vs power) kick. */
  penaltySide: number;
  penaltyPlaced: boolean;
  /** T19, taking a penalty: it faces its aim while it waits (a tell). */
  penaltyTell: boolean;
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
  /**
   * Tackle duels (T17, for tuning: `npm run simulate`): this team's AI players' challenges on an opposing carrier
   * (slides started at them, standing tackles) and how many won the ball, against an AI carrier and a human one.
   */
  duelTries: number;
  duelWins: number;
  duelTriesHuman: number;
  duelWinsHuman: number;
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
  /** T19: fouls committed per team, cards shown, penalties taken in the match, and the shoot-out (null if none). */
  fouls: [number, number];
  cards: CardRecord[];
  penalties: PenaltyRecord[];
  shootout: ShootoutRecord | null;
  /** T21: what each player did (indexed by player id), and what each team's human did (indexed by team; see sim/playerStats.ts). */
  players: PlayerTally[];
  humans: [PlayerTally, PlayerTally];
}

/** T21: one player's match: goals (not own goals), assists, saves by a keeper, tackles won off the ball carrier, shots. */
export interface PlayerTally {
  goals: number;
  assists: number;
  saves: number;
  tackles: number;
  shots: number;
}

/** T21: the sim's memory for the per-player stats (who touched the ball last, the shot still in flight). Never sent. */
export interface TouchTrack {
  /** The last two different players to touch the ball, oldest first, and the tick of each touch. */
  touches: { team: TeamId; player: number; tick: number }[];
  /** A shot struck and not yet saved, blocked or scored. */
  liveShot: { team: TeamId; player: number } | null;
}

/** A card (T19): to `team`'s player `player`. A second yellow is recorded as a red. */
export interface CardRecord {
  team: TeamId;
  player: number;
  card: 'yellow' | 'red';
  half: number;
  clock: number;
}

/** A penalty taken during the match (T19; shoot-out kicks are in ShootoutRecord). */
export interface PenaltyRecord {
  team: TeamId;
  player: number;
  scored: boolean;
  half: number;
  clock: number;
}

/** A penalty shoot-out (T19): kicks alternate, `first` takes kick 0; true = scored. */
export interface ShootoutRecord {
  first: TeamId;
  kicks: boolean[];
  /** -1 while it is undecided. */
  winner: TeamId | -1;
}

/** The shoot-out under way: its record, plus seconds of pause before the next kick. */
export interface Shootout extends ShootoutRecord {
  pause: number;
}

/** A penalty kick (match or shoot-out) that has been struck and is still being decided: goal, save or miss. */
export interface LivePenalty {
  /** Team taking it, the taker and the keeper facing it. */
  team: TeamId;
  taker: number;
  keeper: number;
  /** Seconds since it was struck. */
  timer: number;
  keeperTouched: boolean;
  shootout: boolean;
}

export interface GameState {
  /** Number of fixed steps simulated so far. */
  tick: number;
  /** The match rules (T15): fixed for the match. */
  rules: MatchRules;
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
  /** Just after a restart is taken: if the ball goes straight back out, the same team retakes it (T14). */
  grace: RestartGrace | null;
  /** The most recent events (capped), oldest first. Consumers remember the last `id` they handled. */
  events: MatchEvent[];
  nextEventId: number;
  stats: MatchStats;
  /** T21: memory for the per-player stats (host only; the guest gets the finished stats instead). */
  track: TouchTrack;
  /** T19: a penalty struck and still being decided (else null). */
  penalty: LivePenalty | null;
  /** T19: the penalty shoot-out, once it has started (kept after it ends, for the HUD and results). */
  shootout: Shootout | null;
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

export type MatchPhase = 'pre-kickoff' | 'playing' | 'goal-scored' | 'half-time' | 'full-time' | 'shootout';

export type RestartType = 'kickoff' | 'throw-in' | 'goal-kick' | 'corner' | 'free-kick' | 'penalty';

export interface Restart {
  type: RestartType;
  team: TeamId;
  /** Where the ball is placed. */
  pos: Vec2;
  /** Player id placed next to the ball to take it. */
  taker: number;
  /** Seconds until the restart is released automatically (the opposition keeps clear until then). */
  timer: number;
  /** A free kick near goal (T19): the defenders standing in the wall. */
  wall?: number[];
}

/** The restart just taken, kept for RESTART_GRACE_TIME so it can be retaken if the ball goes straight back out. */
export interface RestartGrace {
  type: RestartType;
  team: TeamId;
  pos: Vec2;
  /** The taker: a touch by anyone else ends the grace period. */
  taker: number;
  /** Seconds left. */
  timer: number;
}

export type MatchEventType =
  | 'kickoff' | 'goal' | 'throw-in' | 'goal-kick' | 'corner' | 'half-time' | 'second-half' | 'full-time'
  // T19
  | 'foul' | 'yellow-card' | 'red-card' | 'free-kick' | 'penalty' | 'penalty-result' | 'extra-time' | 'shootout';

export interface MatchEvent {
  /** Increasing; never reused within a match. */
  id: number;
  tick: number;
  type: MatchEventType;
  /** goal: scoring team. Restarts and kickoff: the team taking it. foul and cards: the offender's team. penalty-result: the taking team. */
  team?: TeamId;
  /** goal: player who touched the ball last (-1 if unknown). foul / cards: the offender. penalty-result: the taker. */
  player?: number;
  ownGoal?: boolean;
  /** penalty-result: scored, or (if not) saved by the keeper rather than missed. */
  scored?: boolean;
  saved?: boolean;
  half: number;
  /** Seconds played in the half when it happened. */
  clock: number;
  score: [number, number];
}

// Guest side of an online game: joins a room by code and follows the host's lobby (GuestLobby), then sends its
// inputs, buffers and interpolates the host's snapshots and receives events (GuestMatch). It never runs the sim
// itself, apart from predicting its own controlled player (and the ball, while that player carries or has just kicked it).
import type Peer from 'peerjs';
import type { DataConnection } from 'peerjs';
import {
  MAX_EVENTS,
  NET_BROKER_TIMEOUT_MS,
  NET_CLOSE_FLUSH_MS,
  NET_CONNECT_TIMEOUT_MS,
  NET_CORRECTION_HALF_LIFE,
  NET_DIRECT_ATTEMPT_TIMEOUT_MS,
  NET_CORRECTION_SNAP,
  NET_BALL_CORRECTION_SNAP,
  NET_HANDSHAKE_TIMEOUT_MS,
  NET_INPUT_REDUNDANCY,
  NET_INTERP_DELAY_MS,
  NET_PREDICT_BLEND_FAR,
  NET_PREDICT_BLEND_RATE,
  NET_PREDICT_BLEND_NEAR,
  NET_PREDICTION,
  NET_RECONNECT_RETRY_MS,
  NET_RECONNECT_WINDOW_MS,
  NET_RELAY_RETRY,
  NET_SNAPSHOT_INTERVAL_TICKS,
  NET_STALL_MS,
  SIM_DT,
  SIM_HZ,
  FEINT_COOLDOWN,
  FEINT_TIME,
  KICK_BUFFER_TIME,
  KICK_FLASH_TIME,
  KICK_PLAYER_VEL_FACTOR,
  NET_KICK_CONFIRM_MS,
  NET_KICK_LEAD_DECAY,
  PASS_SPEED,
  FINESSE_SPEED,
} from '../config';
import { ballBoundary, createMatchState, playerBoundary, shotSpeed, updatePlayer } from '../sim/simulation';
import { CLASSIC_RULES, copyRules } from '../sim/matchRules';
import { assistAim, finesseShot } from '../sim/shooting';

import { advanceHold, heldBallSpot, holdOffLines, rollFreeBall, sharpTurnLosesBall, shieldHoldAngle, startFeint } from '../sim/dribble';
import { DEFAULT_LOOK, resolveClash, type Look } from '../teams';
import type { BallState, GameState, InputFrame, MatchEvent, MatchRules, MatchStats, PlayerState, Possession, TeamId } from '../sim/types';
import { kindForPeerError, netError, type NetErrorKind } from './errors';
import { PlaybackClock, SnapshotBuffer } from './interpolation';
import { seconds, type MatchDriver, type NetOverlay } from './match';
import { describeRoute } from './ice';
import { describeConditions } from './netsim';
import { CONNECT_OPTIONS, createPeer, Link, loadIceServers, peerErrorType, peerIdForRoom, type IceSetup, type Lobby, type LobbyView, type StartInfo } from './peer';
import { createLobbyState, GUEST_NAME, hello, HOST_NAME, looksByTeam, teamOf, versionMismatch, type LobbyState, type Message } from './protocol';
import { nameOr } from '../social';
import { QuickChat } from './chat';
import { clearSession, saveSession, setRoomInUrl } from './session';
import { applySnapshot, decodeSnapshot, encodeInputs, PACKET_SNAPSHOT, packetType, quantizeInput, type Snapshot } from './snapshot';
import { LossMeter, RateMeter } from './stats';
import { Replays, type ReplayMode, type ReplayView } from './replay';

/** `lastEvent` of a rejoin after a page refresh: "I have seen everything", so the host resends no old events. */
const ALL_EVENTS_SEEN = 1e9;

/** A lobby from the other side with its names cleaned up (we never trust what arrives over the wire to be display-safe). */
function cleanLobby(l: LobbyState): LobbyState {
  return { ...l, names: [nameOr(l.names[0], HOST_NAME), nameOr(l.names[1], GUEST_NAME)] };
}

export class GuestLobby implements Lobby {
  readonly view: LobbyView;
  onStart: (info: StartInfo) => void = () => {};
  onRestart: (seed: number) => void = () => {};
  onBackToLobby: () => void = () => {};
  /** Match messages from the host (events, final stats). */
  onMatchMessage: (msg: Message) => void = () => {};
  /** The newest event id the match has received (sent when rejoining, so the host resends only what's missing). */
  lastEventId: () => number = () => 0;

  private peer: Peer | null = null;
  private link: Link | null = null;
  private inMatch = false;
  private token = '';
  private readonly chat = new QuickChat('guest');
  private timer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private pendingConn: DataConnection | null = null;
  private readonly pingTimer: ReturnType<typeof setInterval>;
  private ice: IceSetup | null = null;
  /** After a failed first attempt, every connection (including mid-match reconnects) goes through the relay. */
  private relayOnly = false;

  /**
   * Closing or refreshing the tab. In the lobby: say bye, so the host hears straight away. In a match: say nothing, so
   * the host holds the match for the page to come back (T21: a refresh rejoins by the room code in the URL); the
   * price is that closing the tab for good is noticed after a few seconds' silence rather than at once.
   */
  private readonly onPageHide = (): void => {
    if (this.inMatch || !this.isActive()) return;
    this.shutdown();
    this.view.status = 'closed';
  };

  /**
   * `look`: this player's team name and kit; `name`: the player's name (already cleaned up). `resumeToken`: set when the
   * page was refreshed during a match (it came from sessionStorage), so the host takes us back into it.
   */
  constructor(code: string, private look: Look, private readonly name: string = GUEST_NAME, private readonly resumeToken = '') {
    this.token = resumeToken;
    this.view = {
      role: 'guest',
      code,
      status: 'opening',
      lobby: createLobbyState(HOST_NAME, GUEST_NAME, resolveClash(DEFAULT_LOOK, look), look),
      pingMs: null,
      route: null,
      notice: null,
      error: null,
      reconnectUntil: null,
      rematch: { mine: false, theirs: false },
      chat: this.chat.feed,
      chatMuted: false,
    };
    window.addEventListener('pagehide', this.onPageHide);
    // The broker timeout also covers fetching TURN credentials (which gives up well before it).
    this.timer = setTimeout(() => this.fail('broker-unreachable'), NET_BROKER_TIMEOUT_MS);
    void loadIceServers().then((ice) => {
      this.ice = ice;
      if (this.isActive()) this.newPeer();
    });
    this.pingTimer = setInterval(() => {
      this.view.pingMs = this.link?.pingMs ?? null;
      this.view.route = this.link?.route ?? null;
    }, 250);
  }

  /** The relay-only retry is possible: a relay is set up and this isn't already the retry. */
  private get canRetryViaRelay(): boolean {
    return NET_RELAY_RETRY && !this.relayOnly && !!this.ice?.turn;
  }

  get matchLink(): Link | null {
    return this.inMatch && this.view.status === 'connected' ? this.link : null;
  }

  /** The guest gets a broker-assigned ID; only the host's ID is derived from the room code. */
  private newPeer(): void {
    const peer = createPeer(this.ice?.servers ?? [], { relayOnly: this.relayOnly });
    this.peer = peer;
    peer.on('open', () => {
      if (peer !== this.peer) return;
      if (this.view.status === 'opening' || this.view.status === 'connecting') this.connect(peer);
      else if (this.view.status === 'reconnecting') this.reconnectAttempt();
    });
    peer.on('error', (err) => {
      // Once connected to the host, losing the broker doesn't matter; while reconnecting, the next retry handles it.
      if (peer !== this.peer || this.view.status === 'connected' || this.view.status === 'reconnecting') return;
      this.fail(kindForPeerError(peerErrorType(err)));
    });
  }

  private connect(peer: Peer): void {
    if (!this.isActive()) return;
    clearTimeout(this.timer);
    this.view.status = 'connecting';
    const conn = peer.connect(peerIdForRoom(this.view.code), CONNECT_OPTIONS);
    // If the host's ID isn't registered, the broker answers and PeerJS emits 'peer-unavailable' (-> room not found).
    const failed = (kind: NetErrorKind): void => {
      if (peer !== this.peer || this.view.status !== 'connecting') return;
      if (this.canRetryViaRelay) this.retryViaRelay();
      else if (this.relayOnly) this.fail(kind, "Couldn't connect to the host, not even through the relay server.");
      else this.fail(kind);
    };
    this.timer = setTimeout(() => failed('timeout'), this.canRetryViaRelay ? NET_DIRECT_ATTEMPT_TIMEOUT_MS : NET_CONNECT_TIMEOUT_MS);
    conn.on('error', () => failed('connection-failed'));
    conn.on('iceStateChanged', (s) => s === 'failed' && failed('connection-failed'));
    conn.on('open', () => {
      if (!this.isActive() || peer !== this.peer) return;
      clearTimeout(this.timer);
      this.attach(new Link(conn));
      this.link?.send(hello(this.name));
      // After a refresh in a match, say who we were (the host answers with welcome + start, or turns us away).
      if (this.resumeToken) this.link?.send({ t: 'rejoin', token: this.resumeToken, lastEvent: ALL_EVENTS_SEEN });
      this.timer = setTimeout(() => this.fail('timeout'), NET_HANDSHAKE_TIMEOUT_MS);
    });
  }

  /**
   * The first attempt (direct routes and relay together) failed: start again with a new peer that may only use the
   * relay. The host treats the new connection as replacing the failed one.
   */
  private retryViaRelay(): void {
    clearTimeout(this.timer);
    this.relayOnly = true;
    this.view.notice = 'No direct route to the host — retrying through the relay server…';
    const old = this.peer;
    this.peer = null;
    old?.destroy();
    this.timer = setTimeout(() => this.fail('broker-unreachable'), NET_BROKER_TIMEOUT_MS);
    this.newPeer(); // its 'open' connects again
  }

  private attach(link: Link): void {
    this.link = link;
    link.onMessage = (msg) => this.onHostMessage(msg);
    link.onClose = (reason) => {
      if (link !== this.link) return;
      if (this.inMatch) {
        this.link = null;
        if (reason === 'bye') this.fail('host-left');
        else if (this.view.status === 'connected') this.startReconnect();
        // While reconnecting, a failed attempt is retried by the retry timer.
        return;
      }
      if (this.view.status === 'connected') this.fail(reason === 'timeout' ? 'timeout' : 'host-left');
      else this.fail('connection-failed');
    };
  }

  /* ---- Reconnecting mid-match ---------------------------------------------------------------------- */

  private startReconnect(): void {
    if (!this.isActive()) return;
    this.view.status = 'reconnecting';
    this.view.pingMs = null;
    this.view.reconnectUntil = performance.now() + NET_RECONNECT_WINDOW_MS;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.fail('host-lost'), NET_RECONNECT_WINDOW_MS);
    this.reconnectAttempt();
  }

  /** One try at reaching the host again; schedules the next. Needs the broker, so re-registers first if needed. */
  private reconnectAttempt(): void {
    if (this.view.status !== 'reconnecting') return;
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.reconnectAttempt(), NET_RECONNECT_RETRY_MS);
    this.pendingConn?.close();
    this.pendingConn = null;
    if (this.link) {
      // An unanswered attempt: drop it quietly (no bye, which the host would take as leaving for good).
      this.link.onClose = () => {};
      this.link.conn.close();
      this.link = null;
    }
    const peer = this.peer;
    if (!peer || peer.destroyed) {
      this.newPeer(); // its 'open' calls back here
      return;
    }
    if (peer.disconnected) {
      peer.reconnect();
      return;
    }
    if (!peer.open) return;
    const conn = peer.connect(peerIdForRoom(this.view.code), CONNECT_OPTIONS);
    this.pendingConn = conn;
    conn.on('open', () => {
      if (conn !== this.pendingConn || this.view.status !== 'reconnecting') {
        conn.close();
        return;
      }
      this.pendingConn = null;
      this.attach(new Link(conn));
      this.link?.send(hello(this.name));
      this.link?.send({ t: 'rejoin', token: this.token, lastEvent: this.lastEventId() });
      // The host answers with welcome + start; the retry timer covers it not answering.
    });
  }

  private onHostMessage(msg: Message): void {
    switch (msg.t) {
      case 'welcome': {
        clearTimeout(this.timer);
        const mismatch = versionMismatch(msg, 'host');
        if (mismatch) {
          this.fail('version-mismatch', mismatch);
          return;
        }
        this.view.lobby = cleanLobby(msg.lobby);
        this.view.notice = null;
        setRoomInUrl(this.view.code);
        saveSession(this.view.code, this.token);
        // Tell the host which team we'd like to be (it answers with the lobby, with any clash resolved).
        // (Not after a refresh in a match: the host already has our look.)
        if (!this.inMatch && !this.resumeToken) this.link?.send({ t: 'look', look: this.look });
        if (this.inMatch) {
          // Back in: keep the give-up timer running until `start` confirms it.
          this.timer = setTimeout(() => this.fail('host-lost'), Math.max(0, (this.view.reconnectUntil ?? 0) - performance.now()));
        } else this.view.status = 'connected';
        break;
      }
      case 'reject':
        if (msg.reason === 'version') this.fail('version-mismatch', versionMismatch(msg, 'host') ?? undefined);
        else this.fail(this.inMatch ? 'host-lost' : 'room-full');
        break;
      case 'lobby':
        this.view.lobby = cleanLobby(msg.lobby);
        // Remember what the host settled on, so a reconnect or a later change starts from it.
        this.look = msg.lobby.looks[1];
        break;
      case 'start':
        this.token = msg.token;
        saveSession(this.view.code, msg.token);
        if (this.inMatch) {
          clearTimeout(this.timer);
          clearTimeout(this.retryTimer);
          this.view.status = 'connected';
          this.view.reconnectUntil = null;
          break;
        }
        this.inMatch = true;
        this.view.lobby = { ...this.view.lobby, hostTeam: msg.hostTeam };
        this.view.lobby = { ...this.view.lobby, rules: msg.rules };
        this.onStart({ localTeam: teamOf(this.view.lobby, 'guest'), seed: msg.seed, halfLength: msg.half, looks: looksByTeam(this.view.lobby), rules: copyRules(msg.rules) });
        break;
      case 'event':
      case 'stats':
      case 'replay':
        this.onMatchMessage(msg);
        break;
      case 'rematch':
        this.view.rematch = { ...this.view.rematch, theirs: msg.want };
        break;
      case 'emote':
        this.chat.receive(msg.id);
        break;
      case 'lobby-back':
        if (!this.inMatch) break;
        this.inMatch = false;
        this.token = '';
        saveSession(this.view.code, '');
        this.view.rematch = { mine: false, theirs: false };
        this.onBackToLobby();
        break;
      case 'restart':
        this.view.rematch = { mine: false, theirs: false };
        this.onRestart(msg.seed);
        break;
      default:
        break;
    }
  }

  private isActive(): boolean {
    return this.view.status !== 'failed' && this.view.status !== 'closed';
  }

  private fail(kind: NetErrorKind, message?: string): void {
    if (!this.isActive()) return;
    clearSession();
    setRoomInUrl(null);
    this.shutdown();
    this.view.status = 'failed';
    this.view.error = netError(kind, message);
  }

  setReady(ready: boolean): void {
    this.link?.send({ t: 'ready', ready });
  }

  setLook(look: Look): void {
    this.look = look;
    this.link?.send({ t: 'look', look });
  }

  swapTeams(): void {
    this.link?.send({ t: 'swap' });
  }

  requestRematch(want: boolean): void {
    if (!this.inMatch || this.view.status !== 'connected') return;
    this.view.rematch = { ...this.view.rematch, mine: want };
    this.link?.send({ t: 'rematch', want });
  }

  sendEmote(id: number): boolean {
    return this.chat.send(id, this.view.status === 'connected' ? this.link : null);
  }

  setChatMuted(muted: boolean): void {
    this.chat.muted = muted;
    this.view.chatMuted = muted;
  }

  resetSeries(): void {
    this.link?.send({ t: 'series-reset' });
  }

  backToLobby(): void {
    // The host does it and tells us (a `lobby-back` message back), so both of us move together.
    if (this.inMatch && this.view.status === 'connected') this.link?.send({ t: 'lobby-back' });
  }

  start(): void {
    // Only the host starts the match.
  }

  leave(): void {
    if (this.view.status === 'closed') return;
    clearSession();
    setRoomInUrl(null);
    this.shutdown();
    this.view.status = 'closed';
  }

  private shutdown(): void {
    window.removeEventListener('pagehide', this.onPageHide);
    clearTimeout(this.timer);
    clearTimeout(this.retryTimer);
    clearInterval(this.pingTimer);
    this.view.pingMs = null;
    this.view.route = null;
    this.view.reconnectUntil = null;
    this.pendingConn?.close();
    this.pendingConn = null;
    this.link?.close();
    this.link = null;
    const peer = this.peer;
    this.peer = null;
    if (peer) setTimeout(() => peer.destroy(), NET_CLOSE_FLUSH_MS * 2);
  }
}

/* ---- The match ------------------------------------------------------------------------------------ */

/** ?predict=0 / ?predict=1 overrides NET_PREDICTION (handy for comparing the feel). */
function predictionEnabled(): boolean {
  const v = new URLSearchParams(window.location.search).get('predict');
  return v === null ? NET_PREDICTION : v !== '0';
}

/** Did this frame strike the ball (a pass press or a shot release), given the frame before? */
const kickEdge = (prev: InputFrame | undefined, f: InputFrame): boolean => (f.pass && !prev?.pass) || (!f.shoot && !!prev?.shoot);

/** The guest's own kick from its predicted dribble: drawn ahead of the host's ball until the host's version catches up. */
interface LocalKick {
  /** Seq of the input frame that struck it. */
  seq: number;
  /** The locally rolled ball (before the handover). */
  ball: BallState;
  /** Seconds since the kick. */
  age: number;
  /** The host's kick has reached the drawn match: the host's ball is drawn `lead` seconds ahead, winding down to 0. */
  handover: boolean;
  lead: number;
}

type BallMode = 'host' | 'carry' | 'kick' | 'handover';

const smoothstep = (lo: number, hi: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

/**
 * The guest's view of the match. Every 60 Hz tick it sends its input (with the previous few repeated, in case
 * packets are lost). Snapshots go into a buffer and are drawn NET_INTERP_DELAY_MS behind, interpolated, so
 * everything moves smoothly. Its own controlled player is predicted from its inputs and reconciled against each
 * snapshot (replaying the inputs the host hadn't applied yet), but blends back to the host's position near the
 * ball, where being ahead of the (older) ball would look wrong. Events are released when the drawn match reaches them.
 */
export class GuestMatch implements MatchDriver {
  readonly online = true;
  state: GameState;
  private readonly buffer = new SnapshotBuffer();
  private readonly clock = new PlaybackClock((NET_INTERP_DELAY_MS * SIM_HZ) / 1000);
  private link: Link | null = null;
  private acc = 0;
  /** Recent inputs (as the host will decode them), oldest first, for redundancy and prediction replay. */
  private readonly history: InputFrame[] = [];
  private newest: Snapshot | null = null;
  private lastSnapAt = -Infinity;
  private lastEventId = 0;
  private readonly pending: MatchEvent[] = [];
  private finalStats: MatchStats | null = null;
  /** After a rematch starts: ignore snapshots from the old match still in flight (their ticks are not below this). */
  private staleFrom = Infinity;
  private renderTick = -1;
  // Stats.
  private readonly snapRate = new RateMeter();
  private readonly snapLoss = new LossMeter(NET_SNAPSHOT_INTERVAL_TICKS);
  private snapBytes = 0;
  private extrapolating = false;
  // Prediction.
  private readonly predict = predictionEnabled();
  private predicted: PlayerState | null = null;
  /** The ball held by the predicted player (sticky dribbling), predicted with it. */
  private predictedPoss: Possession | null = null;
  /** Seqs of our own feints (T17), so a replay knows the feint timers at the host's acked input. */
  private feintSeqs: number[] = [];
  private kick: LocalKick | null = null;
  /** Shoot still held after our finesse shot (its release kicks nothing), as on the host (T15). */
  private shootSpent = false;
  /** Hides jumps when the drawn ball switches between the host's and a predicted one (fades like `offset`). */
  private ballOffset = { x: 0, y: 0 };
  private ballMode: BallMode = 'host';
  private lastBall = { x: 0, y: 0 };
  /** performance.now() of our last predicted kick / queued kick, so the host's later copy of the cue isn't repeated. */
  private localKickAt = -Infinity;
  private localQueueAt = -Infinity;
  /** The drawn (interpolated) snapshot, for its ack. */
  private renderSnap: Snapshot | null = null;
  private offset = { x: 0, y: 0 };
  private predictedShown = false;
  private lastCorrection = 0;
  private blend = 0;
  /** T23: the replay buffer (fed with the snapshots received) and clips; the goal tick of the host's replay running, or null. */
  private readonly replays = new Replays();
  private hostReplay: number | null = null;

  constructor(
    private readonly lobby: GuestLobby,
    readonly localTeam: TeamId,
    private readonly halfLength: number,
    seed?: number,
    /** The host's match rules (T15), from the lobby / `start` message. */
    private readonly rules: MatchRules = CLASSIC_RULES,
    /** T23: this player's replays setting ('off' skips the host's instant replays, which ends them for both). */
    private readonly replayMode: ReplayMode = 'off',
  ) {
    // Static player data (teams, roles, radii, numbers) comes from our own copy; snapshots fill in the rest.
    this.state = createMatchState({ humans: [true, true], seed, halfLength, rules });
    lobby.onMatchMessage = (msg) => this.onMessage(msg);
    lobby.lastEventId = () => this.lastEventId;
    lobby.onRestart = (restartSeed) => this.reset(restartSeed);
  }

  restart(): void {
    // Only the host can start a new match (a rematch both players asked for arrives as a restart message).
  }

  stats(): MatchStats | null {
    return this.finalStats;
  }

  rematch(): { mine: boolean; theirs: boolean } | null {
    return this.lobby.view.rematch;
  }

  setRematch(want: boolean): void {
    this.lobby.requestRematch(want);
  }

  replay(): ReplayView | null {
    return this.replays.view();
  }

  /** Skipping the instant replay ends it for both players (the host holds the kickoff until it ends); highlights are ours. */
  skipReplay(): void {
    if (this.hostReplay !== null) this.link?.send({ t: 'replay-skip', moment: this.hostReplay });
    this.replays.stop();
  }

  startHighlights(): boolean {
    return this.state.phase === 'full-time' && this.replays.startHighlights(this.state);
  }

  /** The host's instant replay starts (we play the same goal from our own buffer) or ends. */
  private onReplay(on: boolean, moment: number): void {
    if (!on) {
      this.hostReplay = null;
      if (this.replays.playingMode === 'replay') this.replays.stop();
      return;
    }
    this.hostReplay = moment;
    if (this.replayMode === 'off') this.link?.send({ t: 'replay-skip', moment });
    else if (this.replays.playingMode !== 'replay') this.replays.startReplay(moment, this.state);
  }

  /** The host started a rematch: forget the old match completely. */
  private reset(seed: number): void {
    this.staleFrom = this.newest ? this.newest.tick : Infinity;
    this.state = createMatchState({ humans: [true, true], seed, halfLength: this.halfLength, rules: this.rules });
    this.buffer.clear();
    this.clock.reset();
    this.newest = null;
    this.lastSnapAt = -Infinity;
    this.lastEventId = 0;
    this.pending.length = 0;
    this.finalStats = null;
    this.renderTick = -1;
    this.history.length = 0;
    this.predicted = null;
    this.predictedPoss = null;
    this.feintSeqs.length = 0;
    this.kick = null;
    this.ballMode = 'host';
    this.ballOffset = { x: 0, y: 0 };
    this.renderSnap = null;
    this.predictedShown = false;
    this.offset = { x: 0, y: 0 };
    this.replays.clear();
    this.hostReplay = null;
  }

  advance(dt: number, sample: () => InputFrame, nowMs: number): void {
    this.bindLink();
    this.acc += Math.min(dt, 0.25);
    while (this.acc >= SIM_DT) {
      this.acc -= SIM_DT;
      const frame = quantizeInput(sample());
      const prev = this.history[this.history.length - 1];
      this.history.push(frame);
      if (this.history.length > SIM_HZ * 2) this.history.shift();
      this.link?.sendFast(encodeInputs(this.history.slice(-NET_INPUT_REDUNDANCY)));
      if (this.predicted) this.predictFrame(this.predicted, prev, frame, nowMs);
      if (this.kick && !this.kick.handover) {
        rollFreeBall(this.kick.ball, 1, SIM_DT, ballBoundary(this.state.rules));
        this.kick.age += SIM_DT;
      }
    }
    this.replays.update(Math.min(dt, 0.25));
    this.render(dt, nowMs);
  }

  private bindLink(): void {
    const link = this.lobby.matchLink;
    if (link === this.link) return;
    this.link = link;
    if (link) link.onFast = (bytes) => this.onFast(bytes);
  }

  private onMessage(msg: Message): void {
    if (msg.t === 'stats') {
      this.finalStats = msg.stats;
      return;
    }
    if (msg.t === 'replay') {
      this.onReplay(msg.on, msg.moment);
      return;
    }
    if (msg.t !== 'event') return;
    // Reliable and ordered, but after a reconnect the host may resend some: each id is used once only.
    if (msg.event.id <= this.lastEventId) return;
    this.lastEventId = msg.event.id;
    this.pending.push(msg.event);
    this.replays.note([msg.event]);
  }

  private onFast(bytes: Uint8Array): void {
    if (packetType(bytes) !== PACKET_SNAPSHOT) return;
    const snap = decodeSnapshot(bytes);
    if (!snap || snap.players.length !== this.state.players.length) return;
    if (snap.tick >= this.staleFrom) return; // the old match's last snapshots, still arriving
    this.staleFrom = Infinity;
    const now = performance.now();
    this.snapBytes = bytes.length;
    this.snapRate.record(now);
    this.snapLoss.record(snap.tick);
    this.lastSnapAt = now;
    const isNewest = !this.newest || snap.tick >= this.newest.tick;
    if (isNewest) this.newest = snap; // also picks up pause flags from repeats of the same (frozen) tick
    if (!this.buffer.push(snap)) return;
    this.replays.record(snap.tick, bytes);
    this.clock.onSnapshot(snap.tick, now);
    if (isNewest) this.reconcile(snap);
  }

  private stalled(nowMs: number): boolean {
    return this.newest !== null && nowMs - this.lastSnapAt > NET_STALL_MS;
  }

  private paused(nowMs: number): boolean {
    return !!this.newest?.paused || this.stalled(nowMs) || this.lobby.view.status !== 'connected';
  }

  /* ---- Prediction ---------------------------------------------------------------------------------- */

  /**
   * Prediction only runs in open play: not while sliding, at set pieces (teleports) or while paused -- nor for our
   * keeper (T19: we control it facing a penalty; the host's keeper is drawn, kept simple).
   */
  private predictable(s: Snapshot): boolean {
    const id = s.controlled[this.localTeam];
    return this.predict && id >= 0 && s.phase === 'playing' && !s.restart && !s.paused && !s.players[id].tackling && this.state.players[id]?.role !== 'keeper';
  }

  /** New authoritative state: start from the host's player and replay the inputs it hadn't applied yet. */
  private reconcile(snap: Snapshot): void {
    if (!this.predictable(snap)) {
      this.predicted = null;
      this.predictedPoss = null;
      return;
    }
    const id = snap.controlled[this.localTeam];
    const ps = snap.players[id];
    const base = this.state.players[id];
    // Sprint stamina is the host's (T17); a feint's timers follow from our own last feint the host had applied.
    const lastFeint = this.feintSeqs.filter((q) => q <= snap.ack).pop() ?? -Infinity;
    const p: PlayerState = {
      ...base,
      pos: { x: ps.x, y: ps.y },
      vel: { x: ps.vx, y: ps.vy },
      facing: ps.facing,
      tackleTimer: 0,
      windup: 0,
      stamina: ps.stamina,
      sprintLock: ps.sprintLock,
      sprinting: ps.sprinting,
      shielding: ps.shielding,
      feintTimer: Math.max(0, FEINT_TIME - (snap.ack - lastFeint) * SIM_DT),
      feintCooldown: Math.max(0, FEINT_COOLDOWN - (snap.ack - lastFeint) * SIM_DT),
    };
    this.feintSeqs = this.feintSeqs.filter((q) => q > snap.ack - SIM_HZ * 2);
    let poss: Possession | null = snap.possession?.player === id ? { ...snap.possession } : null;
    // The host applied our kick but still says we carry the ball: the kick didn't happen there. The host wins.
    if (this.kick && !this.kick.handover && snap.ack >= this.kick.seq && poss) this.kick = null;
    let prev = this.history.find((f) => f.seq === snap.ack);
    for (const f of this.history) {
      if (f.seq <= snap.ack) continue;
      poss = this.replayFrame(p, poss, prev, f);
      prev = f;
    }
    this.predictedPoss = poss;
    const old = this.predicted;
    if (old && old.id === id) {
      const dx = old.pos.x - p.pos.x;
      const dy = old.pos.y - p.pos.y;
      this.lastCorrection = Math.hypot(dx, dy);
      // Hide the correction: draw where we were and let the offset fade (unless it's big, then just snap).
      if (this.lastCorrection > NET_CORRECTION_SNAP) this.offset = { x: 0, y: 0 };
      else this.offset = { x: this.offset.x + dx, y: this.offset.y + dy };
    }
    this.predicted = p;
  }

  /**
   * One frame of our own player, carrying the ball if it has it: feint, sprint, shield and the dribble, by the same rules
   * as the host's sim (sim/dribble.ts, updatePlayer).
   */
  private replayFrame(p: PlayerState, poss: Possession | null, prev: InputFrame | undefined, f: InputFrame): Possession | null {
    const kicked = kickEdge(prev, f);
    if (poss && f.feint && !prev?.feint && startFeint(poss, p, f) && !this.feintSeqs.includes(f.seq)) this.feintSeqs.push(f.seq);
    if (poss && !kicked && sharpTurnLosesBall(p, f)) poss = null;
    updatePlayer(p, f, SIM_DT, !!poss, playerBoundary(this.state.rules));
    if (poss) {
      // (Shielding keeps the ball away from the nearest opponent, as drawn here: close enough, the host wins anyway.)
      advanceHold(poss, p, SIM_DT, p.shielding ? shieldHoldAngle(this.state.players, p) : p.facing);
      holdOffLines(poss, p, this.state.ball.radius, this.state.rules.goalWidth); // the touchline holds the ball, as on the host
    }
    // A kick from the dribble always fires (there is no kick buffer delay with the ball at your feet), ending it.
    return poss && kicked ? null : poss;
  }

  /** A new local frame: predict our player and, if it strikes the ball it carries, the kick. */
  private predictFrame(p: PlayerState, prev: InputFrame | undefined, f: InputFrame, nowMs: number): void {
    const poss = this.predictedPoss;
    const rules = this.state.rules;
    // The same kick edges as the host (sim/simulation.ts): a finesse shot is pass tapped while shoot is held, after
    // which the shoot release kicks nothing.
    const passPressed = f.pass && !prev?.pass;
    const finesse = rules.finesse && passPressed && f.shoot && !this.shootSpent;
    const kicked = passPressed || (!f.shoot && !!prev?.shoot && !this.shootSpent);
    if (finesse) this.shootSpent = true;
    if (!f.shoot) this.shootSpent = false;
    this.predictedPoss = this.replayFrame(p, poss, prev, f);
    if (!kicked) return;
    if (!poss) {
      this.localQueueAt = nowMs; // not on the ball, as far as we can tell: the host queues the kick
      return;
    }
    // Kick from our dribble: launch the ball here and now, as the host will (aimed by the move keys, else the facing).
    let charge = 0;
    if (!passPressed) {
      for (let i = this.history.length - 2; i >= 0 && this.history[i].shoot; i--) charge += SIM_DT;
      charge = Math.min(rules.shotChargeTime, charge);
    }
    const keys = Math.hypot(f.moveX, f.moveY) > 1e-6 ? Math.atan2(f.moveY, f.moveX) : p.facing;
    const spot = heldBallSpot(poss, p, this.state.ball.radius, rules.goalWidth);
    let speed = PASS_SPEED;
    let aim = keys;
    let spin = 0;
    if (finesse) {
      const shot = finesseShot(this.state, this.localTeam, spot, keys);
      speed = FINESSE_SPEED;
      aim = shot.aim;
      spin = shot.spin;
    } else if (!passPressed) {
      speed = shotSpeed(charge, rules.shotChargeTime);
      aim = assistAim(this.state, this.localTeam, spot, keys);
    }
    this.kick = {
      seq: f.seq,
      ball: {
        pos: spot,
        vel: { x: Math.cos(aim) * speed + p.vel.x * KICK_PLAYER_VEL_FACTOR, y: Math.sin(aim) * speed + p.vel.y * KICK_PLAYER_VEL_FACTOR },
        radius: this.state.ball.radius,
        spin,
      },
      age: 0,
      handover: false,
      lead: 0,
    };
    p.facing = aim;
    this.localKickAt = nowMs;
  }

  /** Seconds our prediction runs ahead of the drawn (interpolated) match: the inputs the drawn state doesn't include yet. */
  private lead(): number {
    const newest = this.history[this.history.length - 1];
    return this.renderSnap && newest ? Math.max(0, (newest.seq - this.renderSnap.ack) * SIM_DT) : 0;
  }

  /**
   * Where to draw the ball: held by our predicted player, our own kick rolled locally, the host's ball drawn ahead
   * while our kick hands over to it, or simply the host's. A switch hides its jump behind a fading offset.
   */
  private applyBallPrediction(dt: number, carrying: boolean): void {
    const s = this.state;
    const ball = s.ball;
    const id = s.controlled[this.localTeam];
    const kick = this.kick;
    const drawn = this.renderSnap;
    if (kick && !kick.handover && drawn) {
      if (drawn.ack >= kick.seq) {
        // The drawn match has reached our kick: hand over to the host's ball, unless the host says it never happened.
        if (drawn.possession?.player === id) this.kick = null;
        else {
          kick.handover = true;
          kick.lead = this.lead();
        }
      } else if (kick.age > this.lead() + NET_KICK_CONFIRM_MS / 1000) this.kick = null; // never confirmed: the host wins
    }
    let mode: BallMode = 'host';
    let pos = { ...ball.pos };
    let vel = { ...ball.vel };
    if (carrying && this.predictedPoss) {
      mode = 'carry';
      const p = s.players[id];
      pos = heldBallSpot(this.predictedPoss, p, ball.radius, s.rules.goalWidth);
      vel = { ...p.vel };
      s.possession = { ...this.predictedPoss, player: id };
    } else if (this.kick && !this.kick.handover) {
      mode = 'kick';
      pos = { ...this.kick.ball.pos };
      vel = { ...this.kick.ball.vel };
      s.possession = null;
    } else if (this.kick) {
      // The host's ball, rolled on by a lead that winds down slower than time passes, so the ball never goes backwards.
      mode = 'handover';
      const k = this.kick;
      k.lead = Math.max(0, k.lead - dt * NET_KICK_LEAD_DECAY);
      // (A curled kick keeps curling: the snapshots don't carry the spin, so use our own kick's.)
      const ahead: BallState = { pos: { ...ball.pos }, vel: { ...ball.vel }, radius: ball.radius, spin: k.ball.spin };
      const whole = Math.floor(k.lead / SIM_DT);
      const bounds = ballBoundary(s.rules);
      rollFreeBall(ahead, whole, SIM_DT, bounds);
      rollFreeBall(ahead, 1, k.lead - whole * SIM_DT, bounds); // and the part tick, so the ball glides rather than steps
      pos = ahead.pos;
      vel = ahead.vel;
      if (k.lead === 0) this.kick = null;
    }
    if (mode !== this.ballMode) {
      // (Our kick starts from the ball at our feet, so it needs no smoothing: that would only hold it back.)
      this.ballOffset = mode === 'kick' ? { x: 0, y: 0 } : { x: this.lastBall.x - pos.x, y: this.lastBall.y - pos.y };
      if (Math.hypot(this.ballOffset.x, this.ballOffset.y) > NET_BALL_CORRECTION_SNAP) this.ballOffset = { x: 0, y: 0 };
      this.ballMode = mode;
    }
    const fade = Math.pow(0.5, dt / NET_CORRECTION_HALF_LIFE);
    this.ballOffset.x *= fade;
    this.ballOffset.y *= fade;
    ball.pos = { x: pos.x + this.ballOffset.x, y: pos.y + this.ballOffset.y };
    ball.vel = vel;
    this.lastBall = { ...ball.pos };
  }

  /** Kick cues for our own player: ours show the moment we kick; the host's copy, arriving later, isn't shown again. */
  private applyKickCues(nowMs: number): void {
    const id = this.state.controlled[this.localTeam];
    const p = id >= 0 ? this.state.players[id] : undefined;
    if (!p) return;
    const sinceKick = (nowMs - this.localKickAt) / 1000;
    const sinceQueue = (nowMs - this.localQueueAt) / 1000;
    if (sinceKick < KICK_FLASH_TIME) p.kickFlash = KICK_FLASH_TIME - sinceKick;
    else if (sinceKick < 0.6) p.kickFlash = 0;
    if (sinceKick < 0.6) p.kickQueue = 0;
    else if (sinceQueue < KICK_BUFFER_TIME) p.kickQueue = Math.max(p.kickQueue, KICK_BUFFER_TIME - sinceQueue);
    else if (sinceQueue < 0.6) p.kickQueue = 0;
  }

  /** Draws the predicted own player, blended with the host's (interpolated) one by distance from the ball. */
  private applyPrediction(dt: number): void {
    const k = Math.pow(0.5, dt / NET_CORRECTION_HALF_LIFE);
    this.offset.x *= k;
    this.offset.y *= k;
    const s = this.state;
    const id = s.controlled[this.localTeam];
    const pred = this.predicted;
    const shown = !!pred && pred.id === id && !!this.newest && this.predictable(this.newest) && s.phase === 'playing' && !s.restart;
    if (!shown || !pred) {
      this.predictedShown = false;
      this.blend = 0;
      this.predictedPoss = null;
      this.applyBallPrediction(dt, false);
      return;
    }
    const p = s.players[id];
    if (!this.predictedShown) {
      // Prediction just switched on (new player, end of a set piece): start from where the player is drawn.
      this.offset = { x: p.pos.x - pred.pos.x, y: p.pos.y - pred.pos.y };
      this.predictedShown = true;
    }
    const px = pred.pos.x + this.offset.x;
    const py = pred.pos.y + this.offset.y;
    const ball = s.ball;
    const gap = (x: number, y: number): number => Math.hypot(x - ball.pos.x, y - ball.pos.y) - p.radius - ball.radius;
    // Carrying the ball, or having just kicked it, the ball is predicted with us: draw our player fully predicted.
    // Otherwise, near the (older) host ball, blend back towards the host's position. Changes of blend are eased.
    const ballPredicted = !!this.predictedPoss || !!this.kick;
    const target = ballPredicted ? 1 : smoothstep(NET_PREDICT_BLEND_NEAR, NET_PREDICT_BLEND_FAR, Math.min(gap(p.pos.x, p.pos.y), gap(px, py)));
    const w = this.predictedShown && this.blend > 0 ? this.blend + (target - this.blend) * Math.min(1, dt * NET_PREDICT_BLEND_RATE) : target;
    this.blend = w;
    p.pos = { x: p.pos.x + (px - p.pos.x) * w, y: p.pos.y + (py - p.pos.y) * w };
    p.vel = { x: p.vel.x + (pred.vel.x - p.vel.x) * w, y: p.vel.y + (pred.vel.y - p.vel.y) * w };
    if (w > 0.5) p.facing = pred.facing;
    // Our own stamina bar, sprint and shield show at once.
    p.stamina = pred.stamina;
    p.sprinting = pred.sprinting;
    p.shielding = pred.shielding;
    p.feintTimer = pred.feintTimer;
    this.applyBallPrediction(dt, !!this.predictedPoss);
  }

  /* ---- Drawing --------------------------------------------------------------------------------------- */

  private render(dt: number, nowMs: number): void {
    let tick = this.clock.update(nowMs);
    if (tick < 0 || !this.newest) return; // nothing yet: the kickoff formation from our own copy is drawn
    // While paused (or held for the host's replay), hold on the newest snapshot rather than extrapolating past it.
    if (this.paused(nowMs) || this.hostReplay !== null) tick = Math.min(tick, this.newest.tick);
    const sample = this.buffer.sample(tick);
    if (!sample) return;
    this.renderTick = tick;
    this.extrapolating = sample.extrapolating;
    applySnapshot(this.state, sample.snap);
    this.state.tick = Math.floor(sample.snap.tick);
    this.renderSnap = sample.snap;
    this.applyPrediction(dt);
    this.applyKickCues(nowMs);
    this.releaseEvents(tick);
  }

  /** Events become visible (banners, and sounds later) when the drawn match reaches the tick they happened on. */
  private releaseEvents(tick: number): void {
    const events = this.state.events;
    while (this.pending.length && this.pending[0].tick <= tick) {
      events.push(this.pending.shift()!);
      if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
    }
  }

  overlay(nowMs: number): NetOverlay | null {
    const v = this.lobby.view;
    if (v.status === 'failed' || v.status === 'closed') {
      const e = v.error;
      return { title: e?.title ?? 'Match over', body: e?.message ?? 'The match has ended.', ended: true };
    }
    if (v.status === 'reconnecting') {
      const left = seconds((v.reconnectUntil ?? nowMs) - nowMs);
      return { title: 'Connection lost', body: `Reconnecting to the host… (${left} s)`, ended: false };
    }
    if (!this.newest) return { title: 'Connecting…', body: 'Waiting for the match to arrive from the host.', ended: false };
    if (this.stalled(nowMs)) return { title: 'Connection problem', body: 'Nothing is arriving from the host. Waiting…', ended: false };
    if (this.newest.paused) {
      if (this.newest.resumeIn > 0) return { title: `Resuming in ${Math.ceil(this.newest.resumeIn)}`, body: 'Connection restored.', ended: false };
      return { title: 'Connection problem', body: "The host can't hear your game right now. The match is paused until it can.", ended: false };
    }
    return null;
  }

  debugLines(nowMs: number): string[] {
    const ping = this.lobby.view.pingMs;
    const newest = this.newest;
    const ahead = this.buffer.aheadOf(this.renderTick);
    const aheadMs = newest && this.renderTick >= 0 ? ((newest.tick - this.renderTick) * 1000) / SIM_HZ : 0;
    const link = this.link;
    return [
      'NET (F3) · GUEST',
      `ping          ${ping == null ? '…' : `${Math.round(ping)} ms`}`,
      `snapshots in  ${this.snapRate.rate(nowMs).toFixed(0)}/s · ${this.snapBytes} bytes · loss ${(this.snapLoss.loss() * 100).toFixed(1)}%`,
      `buffer        ${ahead} ahead · ${aheadMs.toFixed(0)} ms (delay ${NET_INTERP_DELAY_MS} ms)${this.extrapolating ? ' · EXTRAPOLATING' : ''}`,
      `prediction    ${this.predict ? `on · blend ${this.blend.toFixed(2)} · last fix ${this.lastCorrection.toFixed(1)} px · ball ${this.ballMode}` : 'off'}`,
      `events        ${this.lastEventId} received · ${this.pending.length} waiting`,
      `channel       ${link ? (link.hasFastChannel ? 'unreliable' : 'reliable fallback') : 'none'}`,
      `route         ${link?.route ? describeRoute(link.route) : '…'}`,
      `simulated     ${link ? describeConditions(link.conditioner.conditions) : '-'}`,
    ];
  }
}

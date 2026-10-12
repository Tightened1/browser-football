// Guest side of an online game: joins a room by code and follows the host's lobby (GuestLobby), then sends its
// inputs, buffers and interpolates the host's snapshots and receives events (GuestMatch). It never runs the sim
// itself, apart from predicting its own controlled player's movement.
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
  NET_HANDSHAKE_TIMEOUT_MS,
  NET_INPUT_REDUNDANCY,
  NET_INTERP_DELAY_MS,
  NET_PREDICT_BLEND_FAR,
  NET_PREDICT_BLEND_NEAR,
  NET_PREDICTION,
  NET_RECONNECT_RETRY_MS,
  NET_RECONNECT_WINDOW_MS,
  NET_RELAY_RETRY,
  NET_SNAPSHOT_INTERVAL_TICKS,
  NET_STALL_MS,
  SIM_DT,
  SIM_HZ,
} from '../config';
import { createMatchState, updatePlayer } from '../sim/simulation';
import { DEFAULT_LOOK, resolveClash, type Look } from '../teams';
import type { GameState, InputFrame, MatchEvent, MatchStats, PlayerState, TeamId } from '../sim/types';
import { kindForPeerError, netError, type NetErrorKind } from './errors';
import { PlaybackClock, SnapshotBuffer } from './interpolation';
import { seconds, type MatchDriver, type NetOverlay } from './match';
import { describeRoute } from './ice';
import { describeConditions } from './netsim';
import { CONNECT_OPTIONS, createPeer, Link, loadIceServers, peerErrorType, peerIdForRoom, type IceSetup, type Lobby, type LobbyView, type StartInfo } from './peer';
import { createLobbyState, GUEST_NAME, hello, HOST_NAME, looksByTeam, teamOf, versionMismatch, type Message } from './protocol';
import { applySnapshot, decodeSnapshot, encodeInputs, PACKET_SNAPSHOT, packetType, quantizeInput, type Snapshot } from './snapshot';
import { LossMeter, RateMeter } from './stats';

export class GuestLobby implements Lobby {
  readonly view: LobbyView;
  onStart: (info: StartInfo) => void = () => {};
  onRestart: (seed: number) => void = () => {};
  /** Match messages from the host (events, final stats). */
  onMatchMessage: (msg: Message) => void = () => {};
  /** The newest event id the match has received (sent when rejoining, so the host resends only what's missing). */
  lastEventId: () => number = () => 0;

  private peer: Peer | null = null;
  private link: Link | null = null;
  private inMatch = false;
  private token = '';
  private timer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private pendingConn: DataConnection | null = null;
  private readonly pingTimer: ReturnType<typeof setInterval>;
  private ice: IceSetup | null = null;
  /** After a failed first attempt, every connection (including mid-match reconnects) goes through the relay. */
  private relayOnly = false;

  /** Closing the tab: say bye, so the other player hears straight away instead of after a timeout. */
  private readonly onPageHide = (): void => this.leave();

  /** `look`: this player's team name and kit. */
  constructor(code: string, private look: Look) {
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
      this.link?.send(hello(GUEST_NAME));
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
      this.link?.send(hello(GUEST_NAME));
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
        this.view.lobby = msg.lobby;
        this.view.notice = null;
        // Tell the host which team we'd like to be (it answers with the lobby, with any clash resolved).
        if (!this.inMatch) this.link?.send({ t: 'look', look: this.look });
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
        this.view.lobby = msg.lobby;
        // Remember what the host settled on, so a reconnect or a later change starts from it.
        this.look = msg.lobby.looks[1];
        break;
      case 'start':
        this.token = msg.token;
        if (this.inMatch) {
          clearTimeout(this.timer);
          clearTimeout(this.retryTimer);
          this.view.status = 'connected';
          this.view.reconnectUntil = null;
          break;
        }
        this.inMatch = true;
        this.view.lobby = { ...this.view.lobby, hostTeam: msg.hostTeam };
        this.onStart({ localTeam: teamOf(this.view.lobby, 'guest'), seed: msg.seed, halfLength: msg.half, looks: looksByTeam(this.view.lobby) });
        break;
      case 'event':
      case 'stats':
        this.onMatchMessage(msg);
        break;
      case 'rematch':
        this.view.rematch = { ...this.view.rematch, theirs: msg.want };
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

  start(): void {
    // Only the host starts the match.
  }

  leave(): void {
    if (this.view.status === 'closed') return;
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
  private offset = { x: 0, y: 0 };
  private predictedShown = false;
  private lastCorrection = 0;
  private blend = 0;

  constructor(
    private readonly lobby: GuestLobby,
    readonly localTeam: TeamId,
    private readonly halfLength: number,
    seed?: number,
  ) {
    // Static player data (teams, roles, radii, numbers) comes from our own copy; snapshots fill in the rest.
    this.state = createMatchState({ humans: [true, true], seed, halfLength });
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

  /** The host started a rematch: forget the old match completely. */
  private reset(seed: number): void {
    this.staleFrom = this.newest ? this.newest.tick : Infinity;
    this.state = createMatchState({ humans: [true, true], seed, halfLength: this.halfLength });
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
    this.predictedShown = false;
    this.offset = { x: 0, y: 0 };
  }

  advance(dt: number, sample: () => InputFrame, nowMs: number): void {
    this.bindLink();
    this.acc += Math.min(dt, 0.25);
    while (this.acc >= SIM_DT) {
      this.acc -= SIM_DT;
      const frame = quantizeInput(sample());
      this.history.push(frame);
      if (this.history.length > SIM_HZ * 2) this.history.shift();
      this.link?.sendFast(encodeInputs(this.history.slice(-NET_INPUT_REDUNDANCY)));
      if (this.predicted) updatePlayer(this.predicted, frame, SIM_DT);
    }
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
    if (msg.t !== 'event') return;
    // Reliable and ordered, but after a reconnect the host may resend some: each id is used once only.
    if (msg.event.id <= this.lastEventId) return;
    this.lastEventId = msg.event.id;
    this.pending.push(msg.event);
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

  /** Prediction only runs in open play: not while sliding, at set pieces (teleports) or while paused. */
  private predictable(s: Snapshot): boolean {
    const id = s.controlled[this.localTeam];
    return this.predict && id >= 0 && s.phase === 'playing' && !s.restart && !s.paused && !s.players[id].tackling;
  }

  /** New authoritative state: start from the host's player and replay the inputs it hadn't applied yet. */
  private reconcile(snap: Snapshot): void {
    if (!this.predictable(snap)) {
      this.predicted = null;
      return;
    }
    const id = snap.controlled[this.localTeam];
    const ps = snap.players[id];
    const base = this.state.players[id];
    const p: PlayerState = { ...base, pos: { x: ps.x, y: ps.y }, vel: { x: ps.vx, y: ps.vy }, facing: ps.facing, tackleTimer: 0 };
    for (const f of this.history) if (f.seq > snap.ack) updatePlayer(p, f, SIM_DT);
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
    const w = smoothstep(NET_PREDICT_BLEND_NEAR, NET_PREDICT_BLEND_FAR, Math.min(gap(p.pos.x, p.pos.y), gap(px, py)));
    this.blend = w;
    p.pos = { x: p.pos.x + (px - p.pos.x) * w, y: p.pos.y + (py - p.pos.y) * w };
    p.vel = { x: p.vel.x + (pred.vel.x - p.vel.x) * w, y: p.vel.y + (pred.vel.y - p.vel.y) * w };
    if (w > 0.5) p.facing = pred.facing;
  }

  /* ---- Drawing --------------------------------------------------------------------------------------- */

  private render(dt: number, nowMs: number): void {
    let tick = this.clock.update(nowMs);
    if (tick < 0 || !this.newest) return; // nothing yet: the kickoff formation from our own copy is drawn
    // While paused, hold on the newest snapshot rather than extrapolating past it.
    if (this.paused(nowMs)) tick = Math.min(tick, this.newest.tick);
    const sample = this.buffer.sample(tick);
    if (!sample) return;
    this.renderTick = tick;
    this.extrapolating = sample.extrapolating;
    applySnapshot(this.state, sample.snap);
    this.state.tick = Math.floor(sample.snap.tick);
    this.applyPrediction(dt);
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
      `prediction    ${this.predict ? `on · blend ${this.blend.toFixed(2)} · last fix ${this.lastCorrection.toFixed(1)} px` : 'off'}`,
      `events        ${this.lastEventId} received · ${this.pending.length} waiting`,
      `channel       ${link ? (link.hasFastChannel ? 'unreliable' : 'reliable fallback') : 'none'}`,
      `route         ${link?.route ? describeRoute(link.route) : '…'}`,
      `simulated     ${link ? describeConditions(link.conditioner.conditions) : '-'}`,
    ];
  }
}

// Host side of an online game: opens a room, accepts one guest, runs the lobby (HostLobby), then runs the only
// simulation and broadcasts snapshots and events (HostMatch). Offline play is a HostMatch with no lobby.
import type Peer from 'peerjs';
import type { DataConnection } from 'peerjs';
import {
  NET_BROKER_TIMEOUT_MS,
  NET_CLOSE_FLUSH_MS,
  NET_CONNECT_TIMEOUT_MS,
  NET_HANDSHAKE_TIMEOUT_MS,
  NET_INPUT_BUFFER_MAX,
  NET_RECONNECT_WINDOW_MS,
  NET_RESUME_COUNTDOWN_MS,
  NET_SNAPSHOT_INTERVAL_TICKS,
  NET_STALL_MS,
  ROOM_CODE_ATTEMPTS,
  SIM_DT,
} from '../config';
import { createMatchState, NEUTRAL_INPUT, step } from '../sim/simulation';
import { emptySeries, nameOr, seriesAfter, uniqueName } from '../social';
import { QuickChat } from './chat';
import { DEFAULT_LOOK, resolveClash, type Look } from '../teams';
import type { Difficulty, GameState, InputFrame, MatchRules, MatchStats, TeamId } from '../sim/types';
import { kindForPeerError, netError, NETWORK_HINT } from './errors';
import { seconds, type MatchDriver, type NetOverlay } from './match';
import { describeRoute } from './ice';
import { describeConditions } from './netsim';
import {
  CONNECT_OPTIONS,
  createPeer,
  generateRoomCode,
  Link,
  loadIceServers,
  peerErrorType,
  peerIdForRoom,
  type CloseReason,
  type IceSetup,
  type Lobby,
  type LobbyView,
  type StartInfo,
} from './peer';
import { decodeInputs, encodeSnapshot, mergeInputs, PACKET_INPUTS, packetType, takeSnapshot } from './snapshot';
import { Replays, type ReplayMode, type ReplayView } from './replay';
import { LossMeter, RateMeter } from './stats';
import {
  canStart,
  createLobbyState,
  setLobbyRules,

  GAME_VERSION,
  GUEST_NAME,
  HOST_NAME,
  looksByTeam,
  PROTOCOL_VERSION,
  swapTeams,
  teamOf,
  versionMismatch,
  type LobbyState,
  type Message,
} from './protocol';

export interface HostLobbyOptions {
  /** The host's player name (T21; already cleaned up). */
  name: string;
  /** The host's team name and kit. */
  look: Look;
  /** Seconds per half for the match (the host's setting; the guest follows it). */
  halfLength: number;
  /** The match rules (T15; the host's setting, shown to the guest in the lobby). */
  rules: MatchRules;
}

export class HostLobby implements Lobby {
  readonly view: LobbyView;
  onStart: (info: StartInfo) => void = () => {};
  onRestart: (seed: number) => void = () => {};
  /** Mid-match, the guest came back: `lastEvent` is the newest event id it had received. */
  onRejoin: (lastEvent: number) => void = () => {};
  onBackToLobby: () => void = () => {};
  /** Match messages from the guest (T23: skipping a replay). */
  onMatchMessage: (msg: Message) => void = () => {};
  private readonly chat = new QuickChat('host');

  private peer: Peer | null = null;
  /** The guest's link once its connection is open (accepted or still handshaking). */
  private guest: Link | null = null;
  private accepted = false;
  /** Once the match starts the lobby only re-admits the same guest (who proves it with `token`). */
  private inMatch = false;
  private token = '';
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private attempts = 0;
  private brokerTimer: ReturnType<typeof setTimeout> | undefined;
  private guestTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setInterval>;
  private ice: IceSetup | null = null;
  /** Abandons the incoming connection that is still being set up (not open yet), if any. */
  private cancelPending: (() => void) | null = null;

  /** Closing the tab: say bye, so the other player hears straight away instead of after a timeout. */
  private readonly onPageHide = (): void => this.leave();

  constructor(private readonly opts: HostLobbyOptions) {
    this.view = {
      role: 'host',
      code: '',
      status: 'opening',
      lobby: createLobbyState(opts.name || HOST_NAME, GUEST_NAME, opts.look, resolveClash(DEFAULT_LOOK, opts.look), opts.rules),
      pingMs: null,
      route: null,
      notice: null,
      error: null,
      reconnectUntil: null,
      rematch: { mine: false, theirs: false },
      chat: this.chat.feed,
      chatMuted: false,
    };
    // The broker timeout also covers fetching TURN credentials (which gives up well before it).
    this.brokerTimer = setTimeout(() => this.fail('broker-unreachable'), NET_BROKER_TIMEOUT_MS);
    void loadIceServers().then((ice) => {
      this.ice = ice;
      if (this.isActive()) this.openRoom();
    });
    window.addEventListener('pagehide', this.onPageHide);
    this.pingTimer = setInterval(() => {
      this.view.pingMs = this.accepted ? (this.guest?.pingMs ?? null) : null;
      this.view.route = this.accepted ? (this.guest?.route ?? null) : null;
    }, 250);
  }

  private get lobby(): LobbyState {
    return this.view.lobby;
  }

  get matchLink(): Link | null {
    return this.inMatch && this.accepted ? this.guest : null;
  }

  /** Register a new room code with the broker; retried with a fresh code if the code is taken. */
  private openRoom(): void {
    this.attempts++;
    const code = generateRoomCode();
    const peer = createPeer(this.ice?.servers ?? [], { id: peerIdForRoom(code) });
    this.peer = peer;
    this.view.code = code;
    this.view.status = 'opening';
    clearTimeout(this.brokerTimer);
    this.brokerTimer = setTimeout(() => this.fail('broker-unreachable'), NET_BROKER_TIMEOUT_MS);

    peer.on('open', () => {
      if (peer !== this.peer) return;
      clearTimeout(this.brokerTimer);
      if (this.view.status === 'opening') this.view.status = 'waiting';
    });
    peer.on('connection', (conn) => this.onIncoming(conn));
    peer.on('disconnected', () => {
      // Lost the broker. An existing guest connection is unaffected, but nobody new could join, so re-register.
      if (peer === this.peer && !peer.destroyed && this.isActive()) peer.reconnect();
    });
    peer.on('error', (err) => {
      if (peer !== this.peer || this.inMatch) return; // mid-match, a dropped guest shows up on its link instead
      const type = peerErrorType(err);
      if (type === 'unavailable-id' && this.view.status === 'opening') {
        peer.destroy();
        if (this.attempts < ROOM_CODE_ATTEMPTS) this.openRoom();
        else this.fail('room-codes-exhausted');
        return;
      }
      // Once the room is open, broker trouble doesn't affect a connected guest; 'disconnected' handles re-registering.
      if (this.view.status !== 'opening' && kindForPeerError(type) === 'broker-unreachable') return;
      this.fail(kindForPeerError(type));
    });
  }

  private onIncoming(conn: DataConnection): void {
    if (this.inMatch) {
      this.onIncomingRejoin(conn);
      return;
    }
    // A new attempt while the last one is still being set up is the same guest retrying (through the relay, after
    // the direct attempt failed on their side), so it replaces the old one.
    this.cancelPending?.();
    if (this.guest || !this.isActive()) {
      // One guest per room: tell anyone else the room is full.
      conn.on('open', () => new Link(conn).close({ t: 'reject', reason: 'room-full', protocol: PROTOCOL_VERSION, game: GAME_VERSION }));
      return;
    }
    if (conn.serialization !== CONNECT_OPTIONS.serialization) {
      conn.close();
      return;
    }
    this.view.status = 'connecting';
    this.view.notice = null;
    let settled = false;
    const settle = (): boolean => {
      if (settled) return false;
      settled = true;
      clearTimeout(this.guestTimer);
      if (this.cancelPending === cancel) this.cancelPending = null;
      return true;
    };
    const cancel = (): void => {
      if (settle()) conn.close();
    };
    this.cancelPending = cancel;
    const failed = (): void => {
      if (settle()) this.backToWaiting(`A player tried to join, but the connection couldn't be made. ${NETWORK_HINT}`);
    };
    this.guestTimer = setTimeout(() => {
      failed();
      conn.close();
    }, NET_CONNECT_TIMEOUT_MS);
    conn.on('error', failed);
    conn.on('iceStateChanged', (s) => s === 'failed' && failed());
    conn.on('open', () => {
      if (!settle()) return;
      const link = new Link(conn);
      this.guest = link;
      this.accepted = false;
      link.onMessage = (msg) => this.onGuestMessage(link, msg);
      link.onClose = (reason) => this.onGuestGone(link, reason);
      this.guestTimer = setTimeout(() => {
        if (this.guest === link && !this.accepted) {
          link.close();
          this.backToWaiting('A player connected but never said hello, so they were disconnected.');
        }
      }, NET_HANDSHAKE_TIMEOUT_MS);
    });
  }

  private onGuestMessage(link: Link, msg: Message): void {
    if (link !== this.guest) return;
    if (!this.accepted) {
      if (msg.t !== 'hello') return;
      clearTimeout(this.guestTimer);
      const mismatch = versionMismatch(msg, 'guest');
      if (mismatch) {
        link.close({ t: 'reject', reason: 'version', protocol: PROTOCOL_VERSION, game: GAME_VERSION });
        this.backToWaiting(`A player tried to join with a different game version (${msg.game}; you have ${GAME_VERSION}). Both of you should reload the page.`);
        return;
      }
      this.accepted = true;
      this.view.lobby = { ...this.lobby, ready: [false, false], names: [this.lobby.names[0], uniqueName(nameOr(msg.name, GUEST_NAME), this.lobby.names[0])], looks: [this.lobby.looks[0], resolveClash(DEFAULT_LOOK, this.lobby.looks[0])] };
      this.view.status = 'connected';
      link.send({ t: 'welcome', protocol: PROTOCOL_VERSION, game: GAME_VERSION, name: this.lobby.names[0], lobby: this.lobby });
      return;
    }
    switch (msg.t) {
      case 'ready':
        this.update({ ...this.lobby, ready: [this.lobby.ready[0], msg.ready] });
        break;
      case 'look':
        // The host's look wins a clash: the guest is given the next free kit (or name).
        this.update({ ...this.lobby, looks: [this.lobby.looks[0], resolveClash(msg.look, this.lobby.looks[0])] });
        break;
      case 'swap':
        this.update(swapTeams(this.lobby));
        break;
      case 'rematch':
        this.view.rematch = { ...this.view.rematch, theirs: msg.want };
        this.maybeRematch();
        break;
      case 'emote':
        this.chat.receive(msg.id);
        break;
      case 'series-reset':
        this.resetSeries();
        break;
      case 'lobby-back':
        this.backToLobby();
        break;
      case 'replay-skip':
        this.onMatchMessage(msg);
        break;
      default:
        break; // inputs and snapshots arrive on the fast channel, see HostMatch
    }
  }

  /** Mid-match: a connection that must say hello and then rejoin with the match token, else it is turned away. */
  private onIncomingRejoin(conn: DataConnection): void {
    if (conn.serialization !== CONNECT_OPTIONS.serialization || !this.isActive()) {
      conn.close();
      return;
    }
    const openTimer = setTimeout(() => conn.close(), NET_CONNECT_TIMEOUT_MS);
    conn.on('open', () => {
      clearTimeout(openTimer);
      if (!this.isActive()) {
        conn.close();
        return;
      }
      const link = new Link(conn);
      const full = { t: 'reject', reason: 'room-full', protocol: PROTOCOL_VERSION, game: GAME_VERSION } as const;
      const timer = setTimeout(() => link.close(full), NET_HANDSHAKE_TIMEOUT_MS);
      let saidHello = false;
      link.onClose = () => clearTimeout(timer);
      link.onMessage = (msg) => {
        if (msg.t === 'hello') {
          if (versionMismatch(msg, 'guest')) {
            clearTimeout(timer);
            link.close({ t: 'reject', reason: 'version', protocol: PROTOCOL_VERSION, game: GAME_VERSION });
          }
          saidHello = true;
        } else if (msg.t === 'rejoin' && saidHello) {
          clearTimeout(timer);
          if (msg.token === this.token && this.isActive()) this.adoptGuest(link, msg.lastEvent);
          else link.close(full);
        }
      };
    });
  }

  /** The guest is back: it replaces any old (dead) link, and gets the match details again. */
  private adoptGuest(link: Link, lastEvent: number): void {
    const old = this.guest;
    if (old && old !== link) {
      old.onClose = () => {};
      old.close();
    }
    clearTimeout(this.reconnectTimer);
    this.guest = link;
    this.accepted = true;
    link.onMessage = (msg) => this.onGuestMessage(link, msg);
    link.onClose = (reason) => this.onGuestGone(link, reason);
    this.view.status = 'connected';
    this.view.reconnectUntil = null;
    this.view.notice = null;
    link.send({ t: 'welcome', protocol: PROTOCOL_VERSION, game: GAME_VERSION, name: this.lobby.names[0], lobby: this.lobby });
    link.send({ t: 'start', hostTeam: this.lobby.hostTeam, seed: 0, token: this.token, half: this.opts.halfLength, rules: this.lobby.rules });
    // It lost whatever rematch messages were in flight: start that conversation again.
    link.send({ t: 'rematch', want: this.view.rematch.mine });
    this.onRejoin(lastEvent);
  }

  private onGuestGone(link: Link, reason: CloseReason): void {
    if (link !== this.guest) return;
    if (this.inMatch) {
      this.guest = null;
      this.accepted = false;
      this.view.pingMs = null;
      if (reason === 'bye') {
        this.fail('guest-left');
        return;
      }
      if (!this.isActive()) return;
      // Dropped without saying bye: hold the match open for a while in case they come back.
      this.view.status = 'reconnecting';
      this.view.reconnectUntil = performance.now() + NET_RECONNECT_WINDOW_MS;
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(() => this.fail('guest-lost'), NET_RECONNECT_WINDOW_MS);
      return;
    }
    const wasAccepted = this.accepted;
    this.backToWaiting(wasAccepted ? 'Your friend left the lobby. Waiting for someone to join…' : null);
  }

  private backToWaiting(notice: string | null): void {
    clearTimeout(this.guestTimer);
    this.guest = null;
    this.accepted = false;
    this.view.lobby = { ...this.lobby, ready: [false, false], names: [this.lobby.names[0], GUEST_NAME], looks: [this.lobby.looks[0], resolveClash(DEFAULT_LOOK, this.lobby.looks[0])] };
    this.view.pingMs = null;
    this.view.route = null;
    if (this.isActive()) {
      this.view.status = 'waiting';
      if (notice !== null) this.view.notice = notice;
    }
  }

  /** Change the lobby and send it to the guest. */
  private update(lobby: LobbyState): void {
    this.view.lobby = lobby;
    if (this.accepted) this.guest?.send({ t: 'lobby', lobby });
  }

  private isActive(): boolean {
    return this.view.status !== 'failed' && this.view.status !== 'closed';
  }

  private fail(kind: Parameters<typeof netError>[0]): void {
    if (!this.isActive()) return;
    this.shutdown();
    this.view.status = 'failed';
    this.view.error = netError(kind);
  }

  setReady(ready: boolean): void {
    this.update({ ...this.lobby, ready: [ready, this.lobby.ready[1]] });
  }

  setLook(look: Look): void {
    // A guest's look is already settled, so the host's choice is the one that has to give way.
    const mine = this.accepted ? resolveClash(look, this.lobby.looks[1]) : look;
    this.update({ ...this.lobby, looks: [mine, this.lobby.looks[1]] });
  }

  swapTeams(): void {
    this.update(swapTeams(this.lobby));
  }

  /** Host only, in the lobby: change the match rules (both players must confirm ready again). */
  setRules(rules: MatchRules): void {
    if (this.inMatch) return;
    this.update(setLobbyRules(this.lobby, rules));
  }

  requestRematch(want: boolean): void {
    if (!this.inMatch || !this.accepted) return;
    this.view.rematch = { ...this.view.rematch, mine: want };
    this.guest?.send({ t: 'rematch', want });
    this.maybeRematch();
  }

  sendEmote(id: number): boolean {
    return this.chat.send(id, this.accepted ? this.guest : null);
  }

  setChatMuted(muted: boolean): void {
    this.chat.muted = muted;
    this.view.chatMuted = muted;
  }

  /** The series score goes back to 0-0 (either player can ask). */
  resetSeries(): void {
    this.update({ ...this.lobby, series: emptySeries() });
  }

  /** Full time over: add the result to the series (once per match; HostMatch calls it). */
  recordResult(score: readonly [number, number], shootoutWinner: number | null | undefined): void {
    this.update({ ...this.lobby, series: seriesAfter(this.lobby.series, this.lobby.hostTeam, score, shootoutWinner) });
  }

  /** After a match: both players go back to the lobby (names, kits, teams and the series are kept; ready is cleared). */
  backToLobby(): void {
    if (!this.inMatch || !this.accepted) return;
    this.inMatch = false;
    this.token = '';
    this.view.rematch = { mine: false, theirs: false };
    this.update({ ...this.lobby, ready: [false, false] });
    this.guest?.send({ t: 'lobby-back' });
    this.onBackToLobby();
  }

  /** Both players want one: the host starts it. */
  private maybeRematch(): void {
    const r = this.view.rematch;
    if (!this.inMatch || !this.accepted || !r.mine || !r.theirs) return;
    const seed = Math.floor(Math.random() * 0x7fffffff);
    this.view.rematch = { mine: false, theirs: false };
    this.guest?.send({ t: 'restart', seed });
    this.onRestart(seed);
  }

  start(): void {
    if (!canStart(this.lobby, this.accepted)) return;
    const seed = Math.floor(Math.random() * 0x7fffffff);
    this.inMatch = true;
    this.token = Math.random().toString(36).slice(2, 12);
    this.guest?.send({ t: 'start', hostTeam: this.lobby.hostTeam, seed, token: this.token, half: this.opts.halfLength, rules: this.lobby.rules });
    this.onStart({ localTeam: teamOf(this.lobby, 'host'), seed, halfLength: this.opts.halfLength, looks: looksByTeam(this.lobby), rules: this.lobby.rules });
  }

  leave(): void {
    if (this.view.status === 'closed') return;
    this.shutdown();
    this.view.status = 'closed';
  }

  private shutdown(): void {
    window.removeEventListener('pagehide', this.onPageHide);
    clearTimeout(this.brokerTimer);
    clearTimeout(this.guestTimer);
    clearTimeout(this.reconnectTimer);
    clearInterval(this.pingTimer);
    this.cancelPending?.();
    this.view.reconnectUntil = null;
    this.guest?.close();
    this.guest = null;
    this.accepted = false;
    const peer = this.peer;
    this.peer = null;
    // Give the bye a moment to go out before tearing down the peer (which closes all its connections).
    if (peer) setTimeout(() => peer.destroy(), NET_CLOSE_FLUSH_MS * 2);
  }
}

/* ---- The match ------------------------------------------------------------------------------------ */

export interface HostMatchOptions {
  /** The team the local keyboard controls; null = nobody (AI vs AI). */
  localTeam: TeamId | null;
  seed?: number;
  difficulty?: Difficulty;
  /** Seconds per half (default HALF_LENGTH_SECONDS). */
  halfLength?: number;
  /** Online: the lobby whose guest controls the other team. Offline when absent. */
  lobby?: HostLobby;
  /** Match rules (T15; default classic). */
  rules?: MatchRules;
  /** T23: instant replays after goals (and the full-time highlights); default off. Online, the host's setting decides. */
  replays?: ReplayMode;
}

/**
 * The authoritative match. Each 60 Hz tick it steps the sim with the local input, the guest's next queued input
 * (for the other team's controlled player) and the AI for everyone else; every NET_SNAPSHOT_INTERVAL_TICKS it
 * sends the guest a snapshot, and every new match event goes out once on the reliable channel. Online, it pauses
 * while the guest is silent or disconnected, and resumes after a short countdown.
 */
export class HostMatch implements MatchDriver {
  state: GameState;
  readonly online: boolean;
  private acc = 0;
  private frames = 0;
  private readonly remoteTeam: TeamId;
  /** Guest inputs received but not yet played, oldest first. */
  private queue: InputFrame[] = [];
  private lastRemote: InputFrame | null = null;
  private lastReceivedSeq = -1;
  private lastAppliedSeq = -1;
  private lastEventSent = 0;
  private statsSent = false;
  private paused = false;
  private resumeAt: number | null = null;
  private link: Link | null = null;
  private readonly inputRate = new RateMeter();
  private readonly inputLoss = new LossMeter(1);
  private readonly snapRate = new RateMeter();
  private snapBytes = 0;
  /** T23: the replay buffer and clips; `replayed` is the tick of the last goal looked at for a replay. */
  private readonly replays = new Replays();
  private replayed = -1;

  constructor(private readonly opts: HostMatchOptions) {
    this.online = !!opts.lobby;
    this.remoteTeam = opts.localTeam === 1 ? 0 : 1;
    this.state = this.newState(opts.seed);
    if (opts.lobby) {
      opts.lobby.onRejoin = (lastEvent) => this.onRejoin(lastEvent);
      opts.lobby.onRestart = (seed) => this.restart(seed);
      opts.lobby.onMatchMessage = (msg) => {
        if (msg.t === 'replay-skip' && msg.moment === this.replayed) this.endReplay();
      };
    }
  }

  private newState(seed: number | undefined): GameState {
    const { localTeam, difficulty, halfLength, rules } = this.opts;
    const humans: [boolean, boolean] = this.online ? [true, true] : [localTeam === 0, localTeam === 1];
    return createMatchState({ aiVsAi: !this.online && localTeam === null, humans, seed, halfLength, difficulty: difficulty && [difficulty, difficulty], rules });
  }

  /** A brand-new match (offline "play again", or an agreed online rematch). */
  restart(seed?: number): void {
    this.state = this.newState(seed ?? Math.floor(Math.random() * 0x7fffffff));
    this.acc = 0;
    this.lastEventSent = 0;
    this.statsSent = false;
    this.queue = [];
    this.lastRemote = null;
    this.replays.clear();
    this.replayed = -1;
  }

  stats(): MatchStats | null {
    return this.state.stats;
  }

  replay(): ReplayView | null {
    return this.replays.view();
  }

  skipReplay(): void {
    if (this.replays.playingMode === 'replay') this.endReplay();
    else this.replays.stop();
  }

  startHighlights(): boolean {
    return this.state.phase === 'full-time' && this.replays.startHighlights(this.state);
  }

  /** Is the match held for an instant replay? */
  get replaying(): boolean {
    return this.replays.playingMode === 'replay';
  }

  /**
   * Is it time for an instant replay? Just before the goal pause would end (so the kickoff waits for it), once per goal,
   * if replays are on and the goal's clip was recorded. Returns the goal's tick.
   */
  private replayDue(): number | null {
    const s = this.state;
    if ((this.opts.replays ?? 'off') === 'off' || s.phase !== 'goal-scored' || s.phaseTimer > SIM_DT + 1e-6) return null;
    const goal = [...s.events].reverse().find((e) => e.type === 'goal');
    if (!goal || goal.tick === this.replayed) return null;
    this.replayed = goal.tick; // looked at once, whether or not there is a clip
    return this.replays.clipFor(goal.tick) ? goal.tick : null;
  }

  private startReplay(moment: number): void {
    if (this.replays.startReplay(moment, this.state)) this.link?.send({ t: 'replay', on: true, moment });
  }

  /** Ends the instant replay (skipped by either player). */
  private endReplay(): void {
    if (!this.replaying) return;
    this.replays.stop();
    this.replayEnded();
  }

  /** The instant replay is over: play resumes with the kickoff. */
  private replayEnded(): void {
    this.link?.send({ t: 'replay', on: false, moment: this.replayed });
    // Whatever the guest pressed during the replay isn't played afterwards.
    this.queue = [];
    this.lastRemote = null;
  }

  rematch(): { mine: boolean; theirs: boolean } | null {
    return this.opts.lobby ? this.opts.lobby.view.rematch : null;
  }

  setRematch(want: boolean): void {
    this.opts.lobby?.requestRematch(want);
  }

  private get ended(): boolean {
    const s = this.opts.lobby?.view.status;
    return s === 'failed' || s === 'closed';
  }

  advance(dt: number, sample: () => InputFrame, nowMs: number): void {
    this.bindLink();
    this.updatePause(nowMs);
    // T23: a replay plays in real time while the match is held (the clock doesn't run, the kickoff waits).
    const wasReplaying = this.replaying;
    this.replays.update(Math.min(dt, 0.25));
    if (wasReplaying && !this.replaying) this.replayEnded();
    // Fixed 60 Hz timestep; clamp so a stalled tab doesn't cause a spiral of catch-up steps.
    this.acc += Math.min(dt, 0.25);
    while (this.acc >= SIM_DT) {
      this.acc -= SIM_DT;
      this.frames++;
      const local = sample();
      if (!this.paused && !this.ended && !this.replaying) {
        const moment = this.replayDue();
        if (moment !== null) this.startReplay(moment);
      }
      const running = !this.paused && !this.ended && !this.replaying;
      if (running) {
        const inputs: (InputFrame | undefined)[] = [undefined, undefined];
        if (this.opts.localTeam !== null) inputs[this.opts.localTeam] = local;
        if (this.online) inputs[this.remoteTeam] = this.nextRemote();
        this.state = step(this.state, inputs, SIM_DT);
        this.sendEvents();
        this.replays.note(this.state.events);
      }
      // Snapshots on even ticks while playing; while paused (or held for a replay), at the same rate with the frozen tick.
      const due = running ? this.state.tick % NET_SNAPSHOT_INTERVAL_TICKS === 0 : this.frames % NET_SNAPSHOT_INTERVAL_TICKS === 0;
      if (due) this.sendSnapshot(nowMs, running);
    }
  }

  /** Follows the lobby's current link to the guest (it changes when they reconnect). */
  private bindLink(): void {
    const link = this.opts.lobby?.matchLink ?? null;
    if (link === this.link) return;
    this.link = link;
    if (link) link.onFast = (bytes) => this.onFast(bytes);
  }

  private updatePause(nowMs: number): void {
    if (!this.online) return;
    const live = !!this.link && this.link.silentMs < NET_STALL_MS;
    if (!live) {
      this.paused = true;
      this.resumeAt = null;
      return;
    }
    if (!this.paused) return;
    if (this.resumeAt === null) this.resumeAt = nowMs + NET_RESUME_COUNTDOWN_MS;
    else if (nowMs >= this.resumeAt) {
      this.paused = false;
      this.resumeAt = null;
      // Don't replay whatever the guest pressed during the pause.
      this.queue = [];
      this.lastRemote = null;
    }
  }

  private onFast(bytes: Uint8Array): void {
    if (packetType(bytes) !== PACKET_INPUTS) return;
    const frames = decodeInputs(bytes);
    if (!frames || frames.length === 0) return;
    this.inputRate.record(performance.now());
    this.inputLoss.record(frames[frames.length - 1].seq);
    for (const f of frames) {
      if (f.seq <= this.lastReceivedSeq) continue; // a redundant copy of one we already have
      this.lastReceivedSeq = f.seq;
      if (!this.paused) this.queue.push(f);
    }
  }

  /** The guest's input for this tick: one queued frame (merging a backlog), or the last one again if none came. */
  private nextRemote(): InputFrame {
    while (this.queue.length > NET_INPUT_BUFFER_MAX) {
      const older = this.queue.shift()!;
      this.queue[0] = mergeInputs(older, this.queue[0]);
    }
    const f = this.queue.shift();
    if (f) {
      this.lastRemote = f;
      this.lastAppliedSeq = f.seq;
    }
    return this.lastRemote ?? NEUTRAL_INPUT;
  }

  /** Encodes a snapshot: kept in the replay buffer if it is a new tick (`live`; also offline), and sent to the guest. */
  private sendSnapshot(nowMs: number, live: boolean): void {
    const link = this.link;
    if (!link && !live) return;
    const resumeIn = this.paused && this.resumeAt !== null ? Math.max(0, (this.resumeAt - nowMs) / 1000) : 0;
    const bytes = encodeSnapshot(takeSnapshot(this.state, { ack: this.lastAppliedSeq, paused: this.paused, resumeIn }));
    if (live) this.replays.record(this.state.tick, bytes);
    if (!link) return;
    this.snapBytes = bytes.length;
    this.snapRate.record(nowMs);
    link.sendFast(bytes);
  }

  private sendEvents(): void {
    for (const event of this.state.events) {
      if (event.id <= this.lastEventSent) continue;
      this.lastEventSent = event.id;
      this.link?.send({ t: 'event', event });
    }
    // The final statistics, once, for the guest's results screen.
    if (this.state.phase === 'full-time' && !this.statsSent) {
      this.statsSent = true;
      this.link?.send({ t: 'stats', stats: this.state.stats });
      this.opts.lobby?.recordResult(this.state.score, this.state.stats.shootout?.winner);
    }
  }

  /** The guest reconnected: resend the events it missed, and start its inputs afresh. */
  private onRejoin(lastEvent: number): void {
    this.bindLink();
    this.queue = [];
    this.lastRemote = null;
    this.lastReceivedSeq = -1;
    this.inputLoss.reset();
    for (const event of this.state.events) if (event.id > lastEvent) this.link?.send({ t: 'event', event });
    if (this.state.phase === 'full-time') this.link?.send({ t: 'stats', stats: this.state.stats });
    if (this.replaying) this.link?.send({ t: 'replay', on: true, moment: this.replayed });
  }

  overlay(nowMs: number): NetOverlay | null {
    const lobby = this.opts.lobby;
    if (!lobby) return null;
    const v = lobby.view;
    if (v.status === 'failed' || v.status === 'closed') {
      const e = v.error;
      return { title: e?.title ?? 'Match over', body: e?.message ?? 'The match has ended.', ended: true };
    }
    if (v.status === 'reconnecting') {
      const left = seconds((v.reconnectUntil ?? nowMs) - nowMs);
      return { title: 'Connection lost', body: `Your friend's connection dropped. Waiting for them to reconnect… (${left} s)`, ended: false };
    }
    if (!this.paused) return null;
    if (this.resumeAt !== null) return { title: `Resuming in ${seconds(this.resumeAt - nowMs)}`, body: 'Connection restored.', ended: false };
    return { title: 'Connection problem', body: 'Nothing is arriving from your friend. The match is paused until it does.', ended: false };
  }

  debugLines(nowMs: number): string[] {
    if (!this.online) return ['NET (F3) · offline, no network'];
    const link = this.link;
    const ping = this.opts.lobby?.view.pingMs;
    return [
      'NET (F3) · HOST',
      `ping          ${ping == null ? '…' : `${Math.round(ping)} ms`}`,
      `snapshots out ${this.snapRate.rate(nowMs).toFixed(0)}/s · ${this.snapBytes} bytes`,
      `inputs in     ${this.inputRate.rate(nowMs).toFixed(0)}/s · loss ${(this.inputLoss.loss() * 100).toFixed(1)}%`,
      `input queue   ${this.queue.length} (max ${NET_INPUT_BUFFER_MAX})`,
      `channel       ${link ? (link.hasFastChannel ? 'unreliable' : 'reliable fallback') : 'none'}`,
      `route         ${link?.route ? describeRoute(link.route) : '…'}`,
      `simulated     ${link ? describeConditions(link.conditioner.conditions) : '-'}`,
      `state         ${this.paused ? 'paused' : this.replaying ? 'replay' : 'running'} · tick ${this.state.tick}`,
    ];
  }
}

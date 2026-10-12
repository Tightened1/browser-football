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
import type { Difficulty, GameState, InputFrame, TeamId } from '../sim/types';
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
import { LossMeter, RateMeter } from './stats';
import {
  canStart,
  createLobbyState,
  GAME_VERSION,
  GUEST_NAME,
  HOST_NAME,
  PROTOCOL_VERSION,
  swapTeams,
  teamOf,
  versionMismatch,
  type LobbyState,
  type Message,
} from './protocol';

export class HostLobby implements Lobby {
  readonly view: LobbyView = {
    role: 'host',
    code: '',
    status: 'opening',
    lobby: createLobbyState(HOST_NAME, GUEST_NAME),
    pingMs: null,
    route: null,
    notice: null,
    error: null,
    reconnectUntil: null,
  };
  onStart: (info: StartInfo) => void = () => {};
  /** Mid-match, the guest came back: `lastEvent` is the newest event id it had received. */
  onRejoin: (lastEvent: number) => void = () => {};

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

  constructor() {
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
      this.view.lobby = { ...this.lobby, ready: [false, false], names: [HOST_NAME, msg.name || GUEST_NAME] };
      this.view.status = 'connected';
      link.send({ t: 'welcome', protocol: PROTOCOL_VERSION, game: GAME_VERSION, name: HOST_NAME, lobby: this.lobby });
      return;
    }
    switch (msg.t) {
      case 'ready':
        this.update({ ...this.lobby, ready: [this.lobby.ready[0], msg.ready] });
        break;
      case 'swap':
        this.update(swapTeams(this.lobby));
        break;
      default:
        break; // input/snapshot/event: T07
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
    link.send({ t: 'welcome', protocol: PROTOCOL_VERSION, game: GAME_VERSION, name: HOST_NAME, lobby: this.lobby });
    link.send({ t: 'start', hostTeam: this.lobby.hostTeam, seed: 0, token: this.token });
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
    this.view.lobby = { ...this.lobby, ready: [false, false], names: [HOST_NAME, GUEST_NAME] };
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

  swapTeams(): void {
    this.update(swapTeams(this.lobby));
  }

  start(): void {
    if (!canStart(this.lobby, this.accepted)) return;
    const seed = Math.floor(Math.random() * 0x7fffffff);
    this.inMatch = true;
    this.token = Math.random().toString(36).slice(2, 12);
    this.guest?.send({ t: 'start', hostTeam: this.lobby.hostTeam, seed, token: this.token });
    this.onStart({ localTeam: teamOf(this.lobby, 'host'), seed });
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
  /** Online: the lobby whose guest controls the other team. Offline when absent. */
  lobby?: HostLobby;
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
  private paused = false;
  private resumeAt: number | null = null;
  private link: Link | null = null;
  private readonly inputRate = new RateMeter();
  private readonly inputLoss = new LossMeter(1);
  private readonly snapRate = new RateMeter();
  private snapBytes = 0;

  constructor(private readonly opts: HostMatchOptions) {
    this.online = !!opts.lobby;
    this.remoteTeam = opts.localTeam === 1 ? 0 : 1;
    this.state = this.newState();
    if (opts.lobby) opts.lobby.onRejoin = (lastEvent) => this.onRejoin(lastEvent);
  }

  private newState(): GameState {
    const { localTeam, seed, difficulty } = this.opts;
    const humans: [boolean, boolean] = this.online ? [true, true] : [localTeam === 0, localTeam === 1];
    return createMatchState({ aiVsAi: !this.online && localTeam === null, humans, seed, difficulty: difficulty && [difficulty, difficulty] });
  }

  restart(): void {
    if (this.online) return;
    this.state = this.newState();
    this.acc = 0;
  }

  private get ended(): boolean {
    const s = this.opts.lobby?.view.status;
    return s === 'failed' || s === 'closed';
  }

  advance(dt: number, sample: () => InputFrame, nowMs: number): void {
    this.bindLink();
    this.updatePause(nowMs);
    // Fixed 60 Hz timestep; clamp so a stalled tab doesn't cause a spiral of catch-up steps.
    this.acc += Math.min(dt, 0.25);
    while (this.acc >= SIM_DT) {
      this.acc -= SIM_DT;
      this.frames++;
      const local = sample();
      const running = !this.paused && !this.ended;
      if (running) {
        const inputs: (InputFrame | undefined)[] = [undefined, undefined];
        if (this.opts.localTeam !== null) inputs[this.opts.localTeam] = local;
        if (this.online) inputs[this.remoteTeam] = this.nextRemote();
        this.state = step(this.state, inputs, SIM_DT);
        this.sendEvents();
      }
      // Snapshots on even ticks while playing; while paused, at the same rate with the frozen tick.
      const due = running ? this.state.tick % NET_SNAPSHOT_INTERVAL_TICKS === 0 : this.frames % NET_SNAPSHOT_INTERVAL_TICKS === 0;
      if (due) this.sendSnapshot(nowMs);
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

  private sendSnapshot(nowMs: number): void {
    const link = this.link;
    if (!link) return;
    const resumeIn = this.paused && this.resumeAt !== null ? Math.max(0, (this.resumeAt - nowMs) / 1000) : 0;
    const bytes = encodeSnapshot(takeSnapshot(this.state, { ack: this.lastAppliedSeq, paused: this.paused, resumeIn }));
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
  }

  /** The guest reconnected: resend the events it missed, and start its inputs afresh. */
  private onRejoin(lastEvent: number): void {
    this.bindLink();
    this.queue = [];
    this.lastRemote = null;
    this.lastReceivedSeq = -1;
    this.inputLoss.reset();
    for (const event of this.state.events) if (event.id > lastEvent) this.link?.send({ t: 'event', event });
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
      `state         ${this.paused ? 'paused' : 'running'} · tick ${this.state.tick}`,
    ];
  }
}

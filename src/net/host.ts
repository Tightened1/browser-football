// Host side of an online game. T06: opens a room, accepts one guest, runs the lobby. (T07: runs the sim, broadcasts snapshots.)
import type Peer from 'peerjs';
import type { DataConnection } from 'peerjs';
import { NET_BROKER_TIMEOUT_MS, NET_CLOSE_FLUSH_MS, NET_CONNECT_TIMEOUT_MS, NET_HANDSHAKE_TIMEOUT_MS, ROOM_CODE_ATTEMPTS } from '../config';
import { kindForPeerError, netError, NETWORK_HINT } from './errors';
import { CONNECT_OPTIONS, createPeer, generateRoomCode, Link, peerErrorType, peerIdForRoom, type Lobby, type LobbyView, type StartInfo } from './peer';
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
    notice: null,
    error: null,
  };
  onStart: (info: StartInfo) => void = () => {};

  private peer: Peer | null = null;
  /** The guest's link once its connection is open (accepted or still handshaking). */
  private guest: Link | null = null;
  private accepted = false;
  private attempts = 0;
  private brokerTimer: ReturnType<typeof setTimeout> | undefined;
  private guestTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setInterval>;

  /** Closing the tab: say bye, so the other player hears straight away instead of after a timeout. */
  private readonly onPageHide = (): void => this.leave();

  constructor() {
    this.openRoom();
    window.addEventListener('pagehide', this.onPageHide);
    this.pingTimer = setInterval(() => (this.view.pingMs = this.accepted ? (this.guest?.pingMs ?? null) : null), 250);
  }

  private get lobby(): LobbyState {
    return this.view.lobby;
  }

  /** Register a new room code with the broker; retried with a fresh code if the code is taken. */
  private openRoom(): void {
    this.attempts++;
    const code = generateRoomCode();
    const peer = createPeer(peerIdForRoom(code));
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
      if (peer !== this.peer) return;
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
    if (this.guest || this.view.status === 'connecting' || !this.isActive()) {
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
    const failed = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(this.guestTimer);
      this.backToWaiting(`A player tried to join, but the connection couldn't be made. ${NETWORK_HINT}`);
    };
    this.guestTimer = setTimeout(() => {
      failed();
      conn.close();
    }, NET_CONNECT_TIMEOUT_MS);
    conn.on('error', failed);
    conn.on('iceStateChanged', (s) => s === 'failed' && failed());
    conn.on('open', () => {
      if (settled) return;
      settled = true;
      clearTimeout(this.guestTimer);
      const link = new Link(conn);
      this.guest = link;
      this.accepted = false;
      link.onMessage = (msg) => this.onGuestMessage(link, msg);
      link.onClose = () => this.onGuestGone(link);
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

  private onGuestGone(link: Link): void {
    if (link !== this.guest) return;
    const wasAccepted = this.accepted;
    this.backToWaiting(wasAccepted ? 'Your friend left the lobby. Waiting for someone to join…' : null);
  }

  private backToWaiting(notice: string | null): void {
    clearTimeout(this.guestTimer);
    this.guest = null;
    this.accepted = false;
    this.view.lobby = { ...this.lobby, ready: [false, false], names: [HOST_NAME, GUEST_NAME] };
    this.view.pingMs = null;
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
    this.guest?.send({ t: 'start', hostTeam: this.lobby.hostTeam, seed });
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
    clearInterval(this.pingTimer);
    this.guest?.close();
    this.guest = null;
    this.accepted = false;
    const peer = this.peer;
    this.peer = null;
    // Give the bye a moment to go out before tearing down the peer (which closes all its connections).
    if (peer) setTimeout(() => peer.destroy(), NET_CLOSE_FLUSH_MS * 2);
  }
}

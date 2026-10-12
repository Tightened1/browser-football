// Guest side of an online game. T06: joins a room by code and follows the host's lobby. (T07: sends inputs, interpolates snapshots.)
import type Peer from 'peerjs';
import { NET_BROKER_TIMEOUT_MS, NET_CLOSE_FLUSH_MS, NET_CONNECT_TIMEOUT_MS, NET_HANDSHAKE_TIMEOUT_MS } from '../config';
import { kindForPeerError, netError, type NetErrorKind } from './errors';
import { CONNECT_OPTIONS, createPeer, Link, peerErrorType, peerIdForRoom, type Lobby, type LobbyView, type StartInfo } from './peer';
import { createLobbyState, GUEST_NAME, hello, HOST_NAME, teamOf, versionMismatch, type Message } from './protocol';

export class GuestLobby implements Lobby {
  readonly view: LobbyView;
  onStart: (info: StartInfo) => void = () => {};

  private peer: Peer | null;
  private link: Link | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly pingTimer: ReturnType<typeof setInterval>;

  /** Closing the tab: say bye, so the other player hears straight away instead of after a timeout. */
  private readonly onPageHide = (): void => this.leave();

  constructor(code: string) {
    this.view = { role: 'guest', code, status: 'opening', lobby: createLobbyState(HOST_NAME, GUEST_NAME), pingMs: null, notice: null, error: null };
    // The guest gets a broker-assigned ID; only the host's ID is derived from the room code.
    const peer = createPeer();
    this.peer = peer;
    window.addEventListener('pagehide', this.onPageHide);
    this.timer = setTimeout(() => this.fail('broker-unreachable'), NET_BROKER_TIMEOUT_MS);
    peer.on('open', () => this.connect(peer));
    peer.on('error', (err) => {
      // Once connected to the host, losing the broker doesn't matter.
      if (this.view.status === 'connected') return;
      this.fail(kindForPeerError(peerErrorType(err)));
    });
    this.pingTimer = setInterval(() => (this.view.pingMs = this.link?.pingMs ?? null), 250);
  }

  private connect(peer: Peer): void {
    if (!this.isActive()) return;
    clearTimeout(this.timer);
    this.view.status = 'connecting';
    const conn = peer.connect(peerIdForRoom(this.view.code), CONNECT_OPTIONS);
    // If the host's ID isn't registered, the broker answers and PeerJS emits 'peer-unavailable' (-> room not found).
    this.timer = setTimeout(() => this.fail('timeout'), NET_CONNECT_TIMEOUT_MS);
    conn.on('error', () => this.fail('connection-failed'));
    conn.on('iceStateChanged', (s) => s === 'failed' && this.fail('connection-failed'));
    conn.on('open', () => {
      if (!this.isActive()) return;
      clearTimeout(this.timer);
      const link = new Link(conn);
      this.link = link;
      link.onMessage = (msg) => this.onHostMessage(msg);
      link.onClose = (reason) => {
        if (this.view.status === 'connected') this.fail(reason === 'timeout' ? 'timeout' : 'host-left');
        else this.fail('connection-failed');
      };
      link.send(hello(GUEST_NAME));
      this.timer = setTimeout(() => this.fail('timeout'), NET_HANDSHAKE_TIMEOUT_MS);
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
        this.view.status = 'connected';
        break;
      }
      case 'reject':
        if (msg.reason === 'version') this.fail('version-mismatch', versionMismatch(msg, 'host') ?? undefined);
        else this.fail('room-full');
        break;
      case 'lobby':
        this.view.lobby = msg.lobby;
        break;
      case 'start':
        this.view.lobby = { ...this.view.lobby, hostTeam: msg.hostTeam };
        this.onStart({ localTeam: teamOf(this.view.lobby, 'guest'), seed: msg.seed });
        break;
      default:
        break; // snapshot/event: T07
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

  swapTeams(): void {
    this.link?.send({ t: 'swap' });
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
    clearInterval(this.pingTimer);
    this.view.pingMs = null;
    this.link?.close();
    this.link = null;
    const peer = this.peer;
    this.peer = null;
    if (peer) setTimeout(() => peer.destroy(), NET_CLOSE_FLUSH_MS * 2);
  }
}

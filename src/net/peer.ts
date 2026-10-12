// PeerJS plumbing shared by host and guest: creating peers, and `Link`, a typed connection with ping and liveness.
import Peer, { type DataConnection } from 'peerjs';
import {
  ICE_SERVERS,
  NET_CLOSE_FLUSH_MS,
  NET_LINK_TIMEOUT_MS,
  NET_PING_INTERVAL_MS,
  NET_PING_SMOOTHING,
  PEER_DEBUG_LEVEL,
  PEER_SERVER,
} from '../config';
import type { NetError } from './errors';
import { decode, type LobbyState, type Message } from './protocol';
import type { TeamId } from '../sim/types';

export { generateRoomCode, inviteLink, normalizeRoomCode, peerIdForRoom } from './roomCode';

/** A peer registered with the PeerJS broker under `id` (or a broker-assigned ID). */
export function createPeer(id?: string): Peer {
  const options = { ...PEER_SERVER, debug: PEER_DEBUG_LEVEL, config: { iceServers: ICE_SERVERS } };
  return id ? new Peer(id, options) : new Peer(options);
}

/** PeerJS errors carry a string `type`. */
export function peerErrorType(err: unknown): string {
  return typeof err === 'object' && err !== null && typeof (err as { type?: unknown }).type === 'string' ? (err as { type: string }).type : 'unknown';
}

/** Data channel options: reliable and ordered, JSON-encoded. (T07 may add an unreliable channel for snapshots.) */
export const CONNECT_OPTIONS = { reliable: true, serialization: 'json' } as const;

export type CloseReason = 'bye' | 'closed' | 'timeout';

/**
 * An open data connection: sends and receives typed, validated messages, measures ping, and notices when
 * the other side goes silent. Ping/pong and bye are handled here and not passed on.
 */
export class Link {
  /** Smoothed round-trip time (ms), or null before the first pong. */
  pingMs: number | null = null;
  onMessage: (msg: Message) => void = () => {};
  /** Called once, when the link closes for any reason. */
  onClose: (reason: CloseReason) => void = () => {};

  private closed = false;
  private lastHeard = performance.now();
  private pingId = 0;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(readonly conn: DataConnection) {
    conn.on('data', (data) => this.receive(data));
    conn.on('close', () => this.finish('closed'));
    conn.on('error', () => this.finish('closed'));
    conn.on('iceStateChanged', (s) => {
      if (s === 'failed' || s === 'closed') this.finish('closed');
    });
    this.timer = setInterval(() => this.tick(), NET_PING_INTERVAL_MS);
    this.sendPing();
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  send(msg: Message): void {
    if (this.closed || !this.conn.open) return;
    try {
      void this.conn.send(msg);
    } catch {
      this.finish('closed');
    }
  }

  /** Close on purpose: optionally send a final message (e.g. a reject), then bye, then close shortly after. */
  close(final?: Message): void {
    if (this.closed) return;
    if (final) this.send(final);
    this.send({ t: 'bye' });
    this.finish(null);
    setTimeout(() => this.conn.close(), NET_CLOSE_FLUSH_MS);
  }

  private receive(data: unknown): void {
    if (this.closed) return;
    const msg = decode(data);
    if (!msg) {
      console.warn('[net] ignoring malformed message', data);
      return;
    }
    this.lastHeard = performance.now();
    if (msg.t === 'ping') this.send({ t: 'pong', id: msg.id, sent: msg.sent });
    else if (msg.t === 'pong') {
      const rtt = Math.max(0, performance.now() - msg.sent);
      this.pingMs = this.pingMs === null ? rtt : this.pingMs + (rtt - this.pingMs) * NET_PING_SMOOTHING;
    } else if (msg.t === 'bye') this.finish('bye');
    else this.onMessage(msg);
  }

  private tick(): void {
    if (performance.now() - this.lastHeard > NET_LINK_TIMEOUT_MS) {
      this.finish('timeout');
      this.conn.close();
      return;
    }
    this.sendPing();
  }

  private sendPing(): void {
    this.send({ t: 'ping', id: ++this.pingId, sent: performance.now() });
  }

  /** `reason` null = we closed it ourselves, so nobody needs telling. */
  private finish(reason: CloseReason | null): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    if (reason) this.onClose(reason);
  }
}

/* ---- What the lobby screen sees (implemented by HostLobby and GuestLobby) ------------------------ */

export type LobbyRole = 'host' | 'guest';

/**
 * opening: registering with the broker · waiting: host, room open, no guest yet ·
 * connecting: a peer-to-peer connection / handshake is in progress · connected: both players in the lobby ·
 * failed: see `error` · closed: we left.
 */
export type LobbyStatus = 'opening' | 'waiting' | 'connecting' | 'connected' | 'failed' | 'closed';

export interface LobbyView {
  role: LobbyRole;
  /** Room code ('' until the host has one). */
  code: string;
  status: LobbyStatus;
  lobby: LobbyState;
  /** Smoothed ping to the other player (ms). */
  pingMs: number | null;
  /** Non-fatal information for the player (e.g. "your friend left"). */
  notice: string | null;
  error: NetError | null;
}

export interface StartInfo {
  /** The team this player controls. */
  localTeam: TeamId;
  seed: number;
}

export interface Lobby {
  readonly view: LobbyView;
  /** Called when the match starts (on both sides). */
  onStart: (info: StartInfo) => void;
  setReady(ready: boolean): void;
  swapTeams(): void;
  /** Host only: start the match if both are ready. */
  start(): void;
  /** Leave: tell the other side, close the connection and unregister from the broker. */
  leave(): void;
}

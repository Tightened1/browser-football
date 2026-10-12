// PeerJS plumbing shared by host and guest: creating peers, and `Link`, a typed connection with ping and liveness.
import Peer, { type DataConnection } from 'peerjs';
import {
  ICE_SERVERS,
  NET_CLOSE_FLUSH_MS,
  NET_FAST_CHANNEL_ID,
  NET_LINK_TIMEOUT_MS,
  NET_PING_INTERVAL_MS,
  NET_PING_SMOOTHING,
  NET_ROUTE_CHECK_MS,
  PEER_DEBUG_LEVEL,
  PEER_SERVER,
  TURN_CACHE_MS,
  TURN_CREDENTIALS_URL,
  TURN_FETCH_TIMEOUT_MS,
} from '../config';
import type { NetError } from './errors';
import { hasTurn, parseIceServersResponse, selectedRoute, type Route, type StatsEntry } from './ice';
import { NetConditioner } from './netsim';
import { decode, fromBase64, toBase64, type LobbyState, type Message } from './protocol';
import type { TeamId } from '../sim/types';
import type { Look } from '../teams';

export { generateRoomCode, inviteLink, normalizeRoomCode, peerIdForRoom } from './roomCode';

/** The STUN/TURN servers to use, and where the TURN part came from. */
export interface IceSetup {
  servers: RTCIceServer[];
  /** A relay is available (so the relay-only retry is worth trying). */
  turn: boolean;
  source: 'none' | 'static' | 'fetched' | 'fetch-failed';
  error?: string;
}

let fetched: { servers: RTCIceServer[]; until: number } | null = null;

/**
 * STUN plus TURN: the fixed TURN_SERVERS, plus any fetched from TURN_CREDENTIALS_URL (cached for TURN_CACHE_MS).
 * Never rejects: if the fetch fails or is slow, it carries on without the fetched servers (and says why).
 */
export async function loadIceServers(): Promise<IceSetup> {
  const base = ICE_SERVERS;
  const staticSetup = (extra: Partial<IceSetup> = {}): IceSetup => ({ servers: base, turn: hasTurn(base), source: hasTurn(base) ? 'static' : 'none', ...extra });
  if (!TURN_CREDENTIALS_URL) return staticSetup();
  if (fetched && fetched.until > Date.now()) return { servers: [...base, ...fetched.servers], turn: true, source: 'fetched' };
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TURN_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(TURN_CREDENTIALS_URL, { cache: 'no-store', signal: abort.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const servers = parseIceServersResponse(await res.json());
    if (!servers || !hasTurn(servers)) throw new Error('no TURN servers in the reply');
    // Browsers refuse port 53 (DNS) for TURN; drop such URLs rather than fail the whole server.
    const usable = servers
      .map((s) => ({ ...s, urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u)) }))
      .filter((s) => s.urls.length > 0);
    fetched = { servers: usable, until: Date.now() + TURN_CACHE_MS };
    return { servers: [...base, ...usable], turn: true, source: 'fetched' };
  } catch (err) {
    const error = abort.signal.aborted ? 'timed out' : err instanceof Error ? err.message : String(err);
    console.warn('[net] could not fetch TURN credentials:', error);
    return { ...staticSetup(), source: 'fetch-failed', error };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A peer registered with the PeerJS broker under `id` (or a broker-assigned ID). `relayOnly` makes every
 * connection it opens go through a TURN relay (the fallback when a direct connection failed).
 */
export function createPeer(iceServers: RTCIceServer[], opts: { id?: string; relayOnly?: boolean } = {}): Peer {
  const config: RTCConfiguration = { iceServers, iceTransportPolicy: opts.relayOnly ? 'relay' : 'all' };
  const options = { ...PEER_SERVER, debug: PEER_DEBUG_LEVEL, config };
  return opts.id ? new Peer(opts.id, options) : new Peer(options);
}

/** The route of the most recent online connection in this tab (shown on the diagnostics screen). */
export let lastRoute: Route | null = null;

/** Direct or relayed: reads the selected candidate pair from the connection's stats. */
export async function routeOf(pc: RTCPeerConnection): Promise<Route | null> {
  const report = await pc.getStats();
  return selectedRoute(report.values() as Iterable<StatsEntry>);
}

/** PeerJS errors carry a string `type`. */
export function peerErrorType(err: unknown): string {
  return typeof err === 'object' && err !== null && typeof (err as { type?: unknown }).type === 'string' ? (err as { type: string }).type : 'unknown';
}

/**
 * PeerJS data channel options: reliable and ordered, JSON-encoded. (PeerJS's `reliable: false` only makes a
 * channel unordered, still retransmitting, so the truly unreliable channel is created by Link itself.)
 */
export const CONNECT_OPTIONS = { reliable: true, serialization: 'json' } as const;

export type CloseReason = 'bye' | 'closed' | 'timeout';

/**
 * An open data connection: sends and receives typed, validated messages, measures ping, and notices when
 * the other side goes silent. Ping/pong and bye are handled here and not passed on.
 *
 * Besides PeerJS's reliable JSON channel it opens a second, unreliable and unordered binary channel on the same
 * connection (`sendFast` / `onFast`) for snapshots and inputs. Both ends create it with the same fixed id
 * (a "negotiated" channel), so no extra signalling is needed. Simulated latency/loss (netsim.ts) applies here.
 */
export class Link {
  /** Smoothed round-trip time (ms), or null before the first pong. */
  pingMs: number | null = null;
  onMessage: (msg: Message) => void = () => {};
  /** A binary packet from the unreliable channel (or its reliable fallback). */
  onFast: (bytes: Uint8Array) => void = () => {};
  /** Called once, when the link closes for any reason. */
  onClose: (reason: CloseReason) => void = () => {};
  /** Direct or relayed (null until known). Re-checked every NET_ROUTE_CHECK_MS, as WebRTC can switch routes. */
  route: Route | null = null;
  readonly conditioner = new NetConditioner();

  private closed = false;
  private lastHeard = performance.now();
  private pingId = 0;
  private readonly timer: ReturnType<typeof setInterval>;
  private fast: RTCDataChannel | null = null;
  private lastRouteCheck = 0;

  constructor(readonly conn: DataConnection) {
    conn.on('data', (data) => this.receive(data));
    conn.on('close', () => this.finish('closed'));
    conn.on('error', () => this.finish('closed'));
    conn.on('iceStateChanged', (s) => {
      if (s === 'failed' || s === 'closed') this.finish('closed');
    });
    this.openFastChannel();
    this.timer = setInterval(() => this.tick(), NET_PING_INTERVAL_MS);
    this.sendPing();
    this.checkRoute();
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  /** Milliseconds since anything at all arrived from the other side. */
  get silentMs(): number {
    return performance.now() - this.lastHeard;
  }

  /** True when the unreliable channel is in use (false = fast packets go over the reliable channel). */
  get hasFastChannel(): boolean {
    return this.fast?.readyState === 'open';
  }

  send(msg: Message): void {
    if (this.closed || !this.conn.open) return;
    this.conditioner.send(() => {
      // Not `this.closed`: a final message (reject, bye) may still be on its way after close().
      if (!this.conn.open) return;
      try {
        void this.conn.send(msg);
      } catch {
        this.finish('closed');
      }
    }, true);
  }

  /** Unreliable: may be lost, duplicated or reordered. */
  sendFast(bytes: Uint8Array): void {
    if (this.closed) return;
    const fast = this.fast;
    if (fast?.readyState !== 'open') {
      this.send({ t: 'fast', b: toBase64(bytes) });
      return;
    }
    this.conditioner.send(() => {
      if (fast.readyState !== 'open') return;
      try {
        fast.send(bytes as Uint8Array<ArrayBuffer>);
      } catch {
        // Unreliable anyway; a failing channel shows up as silence or a close.
      }
    }, false);
  }

  /** Close on purpose: optionally send a final message (e.g. a reject), then bye, then close shortly after. */
  close(final?: Message): void {
    if (this.closed) return;
    if (final) this.send(final);
    this.send({ t: 'bye' });
    this.finish(null);
    setTimeout(() => this.conn.close(), NET_CLOSE_FLUSH_MS + this.conditioner.maxDelayMs);
  }

  private openFastChannel(): void {
    try {
      const ch = this.conn.peerConnection.createDataChannel('fast', { negotiated: true, id: NET_FAST_CHANNEL_ID, ordered: false, maxRetransmits: 0 });
      ch.binaryType = 'arraybuffer';
      ch.onmessage = (e: MessageEvent) => {
        if (this.closed || !(e.data instanceof ArrayBuffer)) return;
        this.lastHeard = performance.now();
        this.onFast(new Uint8Array(e.data));
      };
      this.fast = ch;
    } catch (err) {
      console.warn('[net] no unreliable channel, using the reliable one for snapshots', err);
    }
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
    else if (msg.t === 'fast') {
      const bytes = fromBase64(msg.b);
      if (bytes) this.onFast(bytes);
    } else this.onMessage(msg);
  }

  private tick(): void {
    if (performance.now() - this.lastHeard > NET_LINK_TIMEOUT_MS) {
      this.finish('timeout');
      this.conn.close();
      return;
    }
    this.sendPing();
    if (performance.now() - this.lastRouteCheck >= NET_ROUTE_CHECK_MS || !this.route) this.checkRoute();
  }

  private checkRoute(): void {
    this.lastRouteCheck = performance.now();
    const pc = this.conn.peerConnection;
    if (!pc) return;
    routeOf(pc)
      .then((route) => {
        if (this.closed || !route) return;
        this.route = route;
        lastRoute = route;
      })
      .catch(() => {});
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
 * reconnecting: mid-match, the connection dropped and the guest is trying to get back (until `reconnectUntil`) ·
 * failed: see `error` · closed: we left.
 */
export type LobbyStatus = 'opening' | 'waiting' | 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'closed';

export interface LobbyView {
  role: LobbyRole;
  /** Room code ('' until the host has one). */
  code: string;
  status: LobbyStatus;
  lobby: LobbyState;
  /** Smoothed ping to the other player (ms). */
  pingMs: number | null;
  /** Direct or relayed, once connected. */
  route: Route | null;
  /** Non-fatal information for the player (e.g. "your friend left"). */
  notice: string | null;
  error: NetError | null;
  /** While reconnecting: performance.now() time the match is given up at. */
  reconnectUntil: number | null;
  /** Full-time rematch: whether I want one, and whether the other player does. Both = it starts. */
  rematch: { mine: boolean; theirs: boolean };
}

export interface StartInfo {
  /** The team this player controls. */
  localTeam: TeamId;
  seed: number;
  /** Seconds per half (the host's setting). */
  halfLength: number;
  /** Both teams' looks, indexed by team. */
  looks: [Look, Look];
}

export interface Lobby {
  readonly view: LobbyView;
  /** Called when the match starts (on both sides). */
  onStart: (info: StartInfo) => void;
  setReady(ready: boolean): void;
  /** Change my team name / kit (the host keeps the two from clashing). */
  setLook(look: Look): void;
  swapTeams(): void;
  /** Full time: ask for (or withdraw) a rematch. It starts when both players have asked. */
  requestRematch(want: boolean): void;
  /** A rematch is starting (host and guest): begin a new match with this seed. */
  onRestart: (seed: number) => void;
  /** Host only: start the match if both are ready. */
  start(): void;
  /** Leave: tell the other side, close the connection and unregister from the broker. */
  leave(): void;
  /** During the match: the link to the other player while connected (it changes after a reconnect). */
  readonly matchLink: Link | null;
}

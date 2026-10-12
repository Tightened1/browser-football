// Network messages: typed, versioned, validated on receipt. Pure: no PeerJS, no DOM.
import { version as packageVersion } from '../../package.json';
import type { InputFrame, MatchEvent, TeamId } from '../sim/types';

/**
 * Bump whenever any message below changes shape or meaning. The `hello` message itself must never change,
 * so that two different versions can always tell each other apart.
 */
export const PROTOCOL_VERSION = 1;
/** The game version (package.json). Both players must run the same one; bump it with each task that ships. */
export const GAME_VERSION: string = packageVersion;

/** Lobby state. The host owns it and sends a copy to the guest whenever it changes. */
export interface LobbyState {
  /** The host's team; the guest plays the other one. */
  hostTeam: TeamId;
  /** [host ready, guest ready]. */
  ready: [boolean, boolean];
  /** [host name, guest name]. */
  names: [string, string];
}

/* ---- Handshake ---------------------------------------------------------------------------- */

/** Guest -> host, first message after the connection opens. Never change this shape. */
export interface HelloMsg { t: 'hello'; protocol: number; game: string; name: string }
/** Host -> guest: accepted. */
export interface WelcomeMsg { t: 'welcome'; protocol: number; game: string; name: string; lobby: LobbyState }
export type RejectReason = 'version' | 'room-full';
/** Host -> guest: not accepted (the host closes the connection straight after). */
export interface RejectMsg { t: 'reject'; reason: RejectReason; protocol: number; game: string }

/* ---- Lobby -------------------------------------------------------------------------------- */

/** Host -> guest: the lobby changed. */
export interface LobbyMsg { t: 'lobby'; lobby: LobbyState }
/** Guest -> host: my ready flag. */
export interface ReadyMsg { t: 'ready'; ready: boolean }
/** Guest -> host: please swap the teams (clears both ready flags). */
export interface SwapMsg { t: 'swap' }
/** Host -> guest: the match is starting. */
export interface StartMsg { t: 'start'; hostTeam: TeamId; seed: number }

/* ---- Connection upkeep (both directions) ---------------------------------------------------- */

/** `sent` is the sender's clock (ms); the reply echoes it, so the sender can measure the round trip. */
export interface PingMsg { t: 'ping'; id: number; sent: number }
export interface PongMsg { t: 'pong'; id: number; sent: number }
/** Leaving on purpose (the connection closes straight after). */
export interface ByeMsg { t: 'bye' }

/* ---- Match (placeholders: T07 fills these in) ---------------------------------------------- */

/** Guest -> host: the guest's input for one tick. */
export interface InputMsg { t: 'input'; frame: InputFrame }
/** Host -> guest: the authoritative game state (format decided in T07). */
export interface SnapshotMsg { t: 'snapshot'; tick: number; data: unknown }
/** Host -> guest: a match event (goal, whistle...), delivered exactly once. */
export interface EventMsg { t: 'event'; event: MatchEvent }

export type Message =
  | HelloMsg | WelcomeMsg | RejectMsg
  | LobbyMsg | ReadyMsg | SwapMsg | StartMsg
  | PingMsg | PongMsg | ByeMsg
  | InputMsg | SnapshotMsg | EventMsg;
export type MessageType = Message['t'];

/* ---- Validation ----------------------------------------------------------------------------- */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length <= 200;
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isTeam = (v: unknown): v is TeamId => v === 0 || v === 1;
const isPair = <T>(v: unknown, f: (x: unknown) => x is T): v is [T, T] => Array.isArray(v) && v.length === 2 && f(v[0]) && f(v[1]);
const isLobby = (v: unknown): v is LobbyState => isObj(v) && isTeam(v.hostTeam) && isPair(v.ready, isBool) && isPair(v.names, isStr);
const isVersioned = (m: Obj): boolean => isNum(m.protocol) && isStr(m.game);

const VALIDATORS: Record<MessageType, (m: Obj) => boolean> = {
  hello: (m) => isVersioned(m) && isStr(m.name),
  welcome: (m) => isVersioned(m) && isStr(m.name) && isLobby(m.lobby),
  reject: (m) => isVersioned(m) && (m.reason === 'version' || m.reason === 'room-full'),
  lobby: (m) => isLobby(m.lobby),
  ready: (m) => isBool(m.ready),
  swap: () => true,
  start: (m) => isTeam(m.hostTeam) && isNum(m.seed),
  ping: (m) => isNum(m.id) && isNum(m.sent),
  pong: (m) => isNum(m.id) && isNum(m.sent),
  bye: () => true,
  input: (m) => isObj(m.frame),
  snapshot: (m) => isNum(m.tick),
  event: (m) => isObj(m.event),
};

/** Checks that received data is a well-formed message; anything else (wrong shape, unknown type) gives null. */
export function decode(data: unknown): Message | null {
  if (!isObj(data) || typeof data.t !== 'string' || !Object.hasOwn(VALIDATORS, data.t)) return null;
  return VALIDATORS[data.t as MessageType](data) ? (data as unknown as Message) : null;
}

/** The hello a guest sends. */
export function hello(name: string): HelloMsg {
  return { t: 'hello', protocol: PROTOCOL_VERSION, game: GAME_VERSION, name };
}

/** Null if the other side runs a compatible version, else a message for the player explaining the mismatch. */
export function versionMismatch(remote: { protocol: number; game: string }, remoteRole: 'host' | 'guest'): string | null {
  if (remote.protocol === PROTOCOL_VERSION && remote.game === GAME_VERSION) return null;
  const who = remoteRole === 'host' ? 'the host has' : 'your friend has';
  return `You have version ${GAME_VERSION}, ${who} version ${remote.game}. Both players should reload the page (Ctrl+F5 / Cmd+Shift+R) to get the latest version, then try again.`;
}

/** Default player names (T09 lets players choose). */
export const HOST_NAME = 'Host';
export const GUEST_NAME = 'Guest';

/* ---- Lobby rules ------------------------------------------------------------------------------ */

export function createLobbyState(hostName: string, guestName: string): LobbyState {
  return { hostTeam: 0, ready: [false, false], names: [hostName, guestName] };
}

/** The team a player is on: the host's, or the other one for the guest. */
export function teamOf(lobby: LobbyState, role: 'host' | 'guest'): TeamId {
  return role === 'host' ? lobby.hostTeam : lobby.hostTeam === 0 ? 1 : 0;
}

/** Swap the teams; both players must confirm ready again. */
export function swapTeams(lobby: LobbyState): LobbyState {
  return { ...lobby, hostTeam: lobby.hostTeam === 0 ? 1 : 0, ready: [false, false] };
}

/** The host may start once a guest is connected and both players are ready. */
export function canStart(lobby: LobbyState, guestConnected: boolean): boolean {
  return guestConnected && lobby.ready[0] && lobby.ready[1];
}

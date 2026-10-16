// Network messages: typed, versioned, validated on receipt. Pure: no PeerJS, no DOM.
import { version as packageVersion } from '../../package.json';
import { copyRules, isMatchRules, rulesFor } from '../sim/matchRules';
import type { CardRecord, GoalRecord, MatchEvent, MatchEventType, MatchRules, MatchStats, PenaltyRecord, ShootoutRecord, TeamId } from '../sim/types';
import { DEFAULT_LOOK, isLook, type Look } from '../teams';

/**
 * Bump whenever any message below changes shape or meaning. The `hello` message itself must never change,
 * so that two different versions can always tell each other apart.
 */
export const PROTOCOL_VERSION = 7;
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
  /** [host look, guest look]: team name and kit colour. The host keeps them from clashing. */
  looks: [Look, Look];
  /** The match rules (T15): the host's choice, shown to the guest. */
  rules: MatchRules;
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
/** Guest -> host: my team name and kit (the host may change it if it clashes with the host's). */
export interface LookMsg { t: 'look'; look: Look }
/** Guest -> host: please swap the teams (clears both ready flags). */
export interface SwapMsg { t: 'swap' }
/**
 * Host -> guest: the match is starting (or, after a reconnect, carrying on). `token` proves the guest is the
 * same player when it reconnects mid-match.
 */
export interface StartMsg { t: 'start'; hostTeam: TeamId; seed: number; token: string; half: number; rules: MatchRules }

/* ---- Connection upkeep (both directions) ---------------------------------------------------- */

/** `sent` is the sender's clock (ms); the reply echoes it, so the sender can measure the round trip. */
export interface PingMsg { t: 'ping'; id: number; sent: number }
export interface PongMsg { t: 'pong'; id: number; sent: number }
/** Leaving on purpose (the connection closes straight after). */
export interface ByeMsg { t: 'bye' }

/* ---- Match ------------------------------------------------------------------------------------
 * Channels: this reliable, ordered JSON channel carries everything that must arrive (handshake, lobby, ping,
 * events, rejoin). Snapshots and inputs are binary packets (snapshot.ts) on a second, unreliable unordered
 * channel (peer.ts), because a newer one always replaces an older one and a retransmit would only arrive late
 * and hold up everything behind it. If that channel can't be opened, they fall back to `fast` messages here.
 */

/** Host -> guest: a match event (goal, whistle...). Sent once, in order; the guest ignores ids it has seen. */
export interface EventMsg { t: 'event'; event: MatchEvent }
/** Host -> guest, once, at full time: the final statistics. */
export interface StatsMsg { t: 'stats'; stats: MatchStats }
/** Either way: "I want a rematch" (or no longer). The host starts it, with a `restart`, once both do. */
export interface RematchMsg { t: 'rematch'; want: boolean }
/** Host -> guest: a rematch starts now (a new match with this seed; the sides stay as they were). */
export interface RestartMsg { t: 'restart'; seed: number }
/** Guest -> host, after hello, when reconnecting mid-match: the token from `start` and the newest event id received. */
export interface RejoinMsg { t: 'rejoin'; token: string; lastEvent: number }
/** A snapshot or input packet (base64), when the unreliable channel is not available. */
export interface FastMsg { t: 'fast'; b: string }

export type Message =
  | HelloMsg | WelcomeMsg | RejectMsg
  | LobbyMsg | ReadyMsg | LookMsg | SwapMsg | StartMsg
  | PingMsg | PongMsg | ByeMsg
  | EventMsg | StatsMsg | RematchMsg | RestartMsg | RejoinMsg | FastMsg;
export type MessageType = Message['t'];

/* ---- Validation ----------------------------------------------------------------------------- */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length <= 200;
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isTeam = (v: unknown): v is TeamId => v === 0 || v === 1;
const isPair = <T>(v: unknown, f: (x: unknown) => x is T): v is [T, T] => Array.isArray(v) && v.length === 2 && f(v[0]) && f(v[1]);
const isLobby = (v: unknown): v is LobbyState =>
  isObj(v) && isTeam(v.hostTeam) && isPair(v.ready, isBool) && isPair(v.names, isStr) && isPair(v.looks, isLook) && isMatchRules(v.rules);
const isVersioned = (m: Obj): boolean => isNum(m.protocol) && isStr(m.game);
const EVENT_TYPES: readonly MatchEventType[] = [
  'kickoff', 'goal', 'throw-in', 'goal-kick', 'corner', 'half-time', 'second-half', 'full-time',
  'foul', 'yellow-card', 'red-card', 'free-kick', 'penalty', 'penalty-result', 'extra-time', 'shootout',
];
const isOpt = <T>(v: unknown, f: (x: unknown) => x is T): boolean => v === undefined || f(v);
export const isMatchEvent = (v: unknown): v is MatchEvent =>
  isObj(v) &&
  isNum(v.id) &&
  isNum(v.tick) &&
  EVENT_TYPES.includes(v.type as MatchEventType) &&
  isNum(v.half) &&
  isNum(v.clock) &&
  isPair(v.score, isNum) &&
  isOpt(v.team, isTeam) &&
  isOpt(v.player, isNum) &&
  isOpt(v.ownGoal, isBool) &&
  isOpt(v.scored, isBool) &&
  isOpt(v.saved, isBool);

const isGoal = (v: unknown): v is GoalRecord => isObj(v) && isTeam(v.team) && isNum(v.player) && isBool(v.ownGoal) && isNum(v.half) && isNum(v.clock);
const isCard = (v: unknown): v is CardRecord => isObj(v) && isTeam(v.team) && isNum(v.player) && (v.card === 'yellow' || v.card === 'red') && isNum(v.half) && isNum(v.clock);
const isPenalty = (v: unknown): v is PenaltyRecord => isObj(v) && isTeam(v.team) && isNum(v.player) && isBool(v.scored) && isNum(v.half) && isNum(v.clock);
const isShootout = (v: unknown): v is ShootoutRecord =>
  isObj(v) && isTeam(v.first) && Array.isArray(v.kicks) && v.kicks.length <= 200 && v.kicks.every(isBool) && (v.winner === -1 || isTeam(v.winner));
const isList = <T>(v: unknown, f: (x: unknown) => x is T): v is T[] => Array.isArray(v) && v.length <= 100 && v.every(f);
const isStats = (v: unknown): v is MatchStats =>
  isObj(v) &&
  isPair(v.shots, isNum) &&
  isPair(v.possession, isNum) &&
  isList(v.goals, isGoal) &&
  isPair(v.fouls, isNum) &&
  isList(v.cards, isCard) &&
  isList(v.penalties, isPenalty) &&
  (v.shootout === null || isShootout(v.shootout));

const VALIDATORS: Record<MessageType, (m: Obj) => boolean> = {
  hello: (m) => isVersioned(m) && isStr(m.name),
  welcome: (m) => isVersioned(m) && isStr(m.name) && isLobby(m.lobby),
  reject: (m) => isVersioned(m) && (m.reason === 'version' || m.reason === 'room-full'),
  lobby: (m) => isLobby(m.lobby),
  ready: (m) => isBool(m.ready),
  look: (m) => isLook(m.look),
  swap: () => true,
  start: (m) => isTeam(m.hostTeam) && isNum(m.seed) && isStr(m.token) && isNum(m.half) && m.half >= 10 && m.half <= 1800 && isMatchRules(m.rules),
  ping: (m) => isNum(m.id) && isNum(m.sent),
  pong: (m) => isNum(m.id) && isNum(m.sent),
  bye: () => true,
  event: (m) => isMatchEvent(m.event),
  stats: (m) => isStats(m.stats),
  rematch: (m) => isBool(m.want),
  restart: (m) => isNum(m.seed),
  rejoin: (m) => isStr(m.token) && isNum(m.lastEvent),
  fast: (m) => typeof m.b === 'string' && m.b.length <= 4096,
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

/** Default player names (players choose their team's name and kit instead; these label the two connections). */
export const HOST_NAME = 'Host';
export const GUEST_NAME = 'Guest';

/* ---- Lobby rules ------------------------------------------------------------------------------ */

export function createLobbyState(hostName: string, guestName: string, hostLook: Look = DEFAULT_LOOK, guestLook: Look = DEFAULT_LOOK, rules: MatchRules = rulesFor('arcade')): LobbyState {
  return { hostTeam: 0, ready: [false, false], names: [hostName, guestName], looks: [{ ...hostLook }, { ...guestLook }], rules: copyRules(rules) };
}

/** The host changes the match rules: both players must confirm ready again. */
export function setLobbyRules(lobby: LobbyState, rules: MatchRules): LobbyState {
  return { ...lobby, rules: copyRules(rules), ready: [false, false] };
}


/** The two looks indexed by team (team 0 = home), whichever player is on which side. */
export function looksByTeam(lobby: LobbyState): [Look, Look] {
  return lobby.hostTeam === 0 ? [lobby.looks[0], lobby.looks[1]] : [lobby.looks[1], lobby.looks[0]];
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

/* ---- Base64 for the `fast` fallback --------------------------------------------------------------- */

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromBase64(text: string): Uint8Array | null {
  try {
    const s = atob(text);
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

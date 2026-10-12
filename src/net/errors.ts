// Network failures, in plain English for the player. Pure: no PeerJS, no DOM.

export type NetErrorKind =
  | 'room-not-found'
  | 'host-left'
  | 'host-lost'
  | 'guest-left'
  | 'guest-lost'
  | 'connection-failed'
  | 'timeout'
  | 'broker-unreachable'
  | 'room-codes-exhausted'
  | 'version-mismatch'
  | 'room-full'
  | 'unsupported-browser'
  | 'unknown';

export interface NetError {
  kind: NetErrorKind;
  title: string;
  message: string;
  /** Something the player can try. */
  hint?: string;
}

export const NETWORK_HINT =
  "Work, school and public Wi-Fi networks often block direct peer-to-peer connections. Try from a home network, or use a phone's mobile hotspot.";

const BASE: Record<NetErrorKind, Omit<NetError, 'kind'>> = {
  'room-not-found': {
    title: 'Room not found',
    message: "There's no game with that code. Check the code, or ask your friend to send the invite link again — the host may have closed their tab.",
  },
  'host-left': {
    title: 'The host left',
    message: 'The host closed the game or lost their connection.',
    hint: 'Ask them to host again and send you the new code.',
  },
  'host-lost': {
    title: 'Lost the host',
    message: "The connection to the host dropped and couldn't be restored in time, so the match is over.",
    hint: NETWORK_HINT,
  },
  'guest-left': {
    title: 'Your friend left',
    message: 'Your friend left the match.',
  },
  'guest-lost': {
    title: 'Your friend lost connection',
    message: "Your friend's connection dropped and they didn't reconnect in time, so the match is over.",
  },
  'connection-failed': {
    title: "Couldn't connect",
    message: 'The two browsers found each other but could not open a direct connection.',
    hint: NETWORK_HINT,
  },
  timeout: {
    title: 'Connection timed out',
    message: 'No response from the other player in time.',
    hint: NETWORK_HINT,
  },
  'broker-unreachable': {
    title: "Can't reach the matchmaking server",
    message: 'The game uses the free PeerJS server to introduce the two players, and it could not be reached.',
    hint: 'Check your internet connection and try again. A firewall or content filter (common on work networks) may block it.',
  },
  'room-codes-exhausted': {
    title: "Couldn't create a room",
    message: 'Every room code tried was already in use.',
    hint: 'Please try again.',
  },
  'version-mismatch': {
    title: 'Different game versions',
    message: 'You and the other player are running different versions of the game.',
  },
  'room-full': {
    title: 'Room is full',
    message: 'Someone else has already joined this game.',
  },
  'unsupported-browser': {
    title: 'Browser not supported',
    message: "This browser doesn't support WebRTC, which online play needs.",
    hint: 'Use a recent Chrome, Edge, Firefox or Safari.',
  },
  unknown: {
    title: 'Something went wrong',
    message: 'An unexpected network error happened.',
    hint: 'Try again. If it keeps happening, reload the page.',
  },
};

/** A NetError of the given kind; `message` replaces the default text when given. */
export function netError(kind: NetErrorKind, message?: string): NetError {
  const base = BASE[kind];
  return { kind, ...base, message: message ?? base.message };
}

/** Maps a PeerJS error type (PeerError.type) to one of ours. */
export function kindForPeerError(type: string): NetErrorKind {
  switch (type) {
    case 'peer-unavailable':
      return 'room-not-found';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
    case 'ssl-unavailable':
    case 'invalid-key':
      return 'broker-unreachable';
    case 'browser-incompatible':
      return 'unsupported-browser';
    case 'webrtc':
    case 'negotiation-failed':
      return 'connection-failed';
    default:
      return 'unknown';
  }
}

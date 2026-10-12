// Room codes (e.g. PASS-4827), invite links and broker peer IDs. Pure: no PeerJS, no DOM.
import { PEER_ID_PREFIX, ROOM_CODE_DIGIT_COUNT, ROOM_CODE_DIGITS, ROOM_CODE_WORDS } from '../config';

/** Uniform random integer in [0, n). Uses the browser's crypto RNG (not the sim's seeded one). */
function cryptoRandomInt(n: number): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % n;
}

/** A new random room code, e.g. "PASS-4827". */
export function generateRoomCode(randomInt: (n: number) => number = cryptoRandomInt): string {
  const word = ROOM_CODE_WORDS[randomInt(ROOM_CODE_WORDS.length)];
  let digits = '';
  for (let i = 0; i < ROOM_CODE_DIGIT_COUNT; i++) digits += ROOM_CODE_DIGITS[randomInt(ROOM_CODE_DIGITS.length)];
  return `${word}-${digits}`;
}

const CODE_PATTERN = new RegExp(`^([A-Z]{4})-?(\\d{${ROOM_CODE_DIGIT_COUNT}})$`);

/**
 * Turns whatever the player typed or pasted into a canonical room code ("PASS-4827"), or null if it isn't one.
 * Accepts any case, spaces, a missing dash, and a whole invite link.
 */
export function normalizeRoomCode(input: string): string | null {
  let text = input.trim();
  const fromLink = /[?&]room=([^&#\s]+)/i.exec(text);
  if (fromLink) text = decodeURIComponent(fromLink[1]);
  const m = CODE_PATTERN.exec(text.toUpperCase().replace(/[\s_.]+/g, ''));
  return m ? `${m[1]}-${m[2]}` : null;
}

/** The ID the host registers with the PeerJS broker for a room. */
export function peerIdForRoom(code: string): string {
  return `${PEER_ID_PREFIX}${code.toLowerCase()}`;
}

/** The page URL with ?room=CODE (other query options are dropped). `pageUrl` is the site root, e.g. the GitHub Pages URL. */
export function inviteLink(code: string, pageUrl: string): string {
  const url = new URL(pageUrl);
  url.search = '';
  url.hash = '';
  url.searchParams.set('room', code);
  return url.toString();
}

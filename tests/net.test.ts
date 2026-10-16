import { describe, expect, it } from 'vitest';
import { ROOM_CODE_DIGITS, ROOM_CODE_WORDS } from '../src/config';
import { kindForPeerError, netError } from '../src/net/errors';
import {
  canStart,
  createLobbyState,
  decode,
  GAME_VERSION,
  hello,
  PROTOCOL_VERSION,
  swapTeams,
  teamOf,
  versionMismatch,
} from '../src/net/protocol';
import { generateRoomCode, inviteLink, normalizeRoomCode, peerIdForRoom } from '../src/net/roomCode';
import { rulesFor } from '../src/sim/matchRules';

describe('room codes', () => {
  it('generates WORD-#### codes with no ambiguous characters', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateRoomCode();
      expect(code).toMatch(/^[A-Z]{4}-\d{4}$/);
      expect(code).not.toMatch(/[01IOL]/);
      const [word, digits] = code.split('-');
      expect(ROOM_CODE_WORDS).toContain(word);
      for (const d of digits) expect(ROOM_CODE_DIGITS).toContain(d);
    }
  });

  it('uses the supplied random source', () => {
    expect(generateRoomCode(() => 0)).toBe(`${ROOM_CODE_WORDS[0]}-2222`);
  });

  it('normalises what players type or paste', () => {
    expect(normalizeRoomCode('PASS-4827')).toBe('PASS-4827');
    expect(normalizeRoomCode('  pass 4827 ')).toBe('PASS-4827');
    expect(normalizeRoomCode('pass4827')).toBe('PASS-4827');
    expect(normalizeRoomCode('https://x.github.io/browser-football/?room=TEAM-2345')).toBe('TEAM-2345');
    expect(normalizeRoomCode('https://x.github.io/browser-football/?difficulty=hard&room=team-2345#top')).toBe('TEAM-2345');
  });

  it('rejects things that are not room codes', () => {
    for (const bad of ['', 'PASS', '4827', 'PAS-4827', 'PASS-48', 'PASS-48270', 'PA$S-4827', 'https://example.com/']) {
      expect(normalizeRoomCode(bad)).toBeNull();
    }
  });

  it('derives a valid, prefixed PeerJS id', () => {
    const id = peerIdForRoom('PASS-4827');
    expect(id).toBe('browser-football-pass-4827');
    // PeerJS ids: alphanumerics separated by single dashes/underscores/spaces.
    expect(id).toMatch(/^[A-Za-z0-9]+(?:[ _-][A-Za-z0-9]+)*$/);
  });

  it('builds invite links on the site root, dropping other options', () => {
    expect(inviteLink('PASS-4827', 'https://me.github.io/browser-football/')).toBe('https://me.github.io/browser-football/?room=PASS-4827');
    expect(inviteLink('PASS-4827', 'http://localhost:5173/?aivsai#x')).toBe('http://localhost:5173/?room=PASS-4827');
  });
});

describe('protocol', () => {
  it('accepts well-formed messages', () => {
    const lobby = createLobbyState('Host', 'Guest');
    const msgs = [
      hello('Guest'),
      { t: 'welcome', protocol: PROTOCOL_VERSION, game: GAME_VERSION, name: 'Host', lobby },
      { t: 'reject', reason: 'room-full', protocol: 1, game: '0.1.0' },
      { t: 'lobby', lobby },
      { t: 'ready', ready: true },
      { t: 'swap' },
      { t: 'look', look: { name: 2, kit: 3 } },
      { t: 'start', hostTeam: 1, seed: 42, token: 'abc', half: 120, rules: rulesFor('arcade') },
      { t: 'rematch', want: true },
      { t: 'restart', seed: 9 },
      { t: 'stats', stats: { shots: [3, 1], possession: [40.5, 20], goals: [{ team: 0, player: 4, ownGoal: false, half: 1, clock: 33.2 }], fouls: [1, 0], cards: [], penalties: [], shootout: null, players: [{ goals: 1, assists: 0, saves: 0, tackles: 0, shots: 2 }], humans: [{ goals: 0, assists: 0, saves: 0, tackles: 0, shots: 0 }, { goals: 1, assists: 0, saves: 0, tackles: 0, shots: 2 }] } },
      { t: 'rejoin', token: 'abc', lastEvent: 7 },
      { t: 'event', event: { id: 3, tick: 120, type: 'goal', team: 1, player: 8, ownGoal: false, half: 1, clock: 12.5, score: [0, 1] } },
      { t: 'fast', b: 'AQID' },
      { t: 'ping', id: 1, sent: 123.5 },
      { t: 'pong', id: 1, sent: 123.5 },
      { t: 'bye' },
    ];
    for (const m of msgs) expect(decode(m)).toEqual(m);
  });

  it('rejects malformed or unknown data', () => {
    const bad: unknown[] = [
      null,
      'hello',
      42,
      [],
      {},
      { t: 'nope' },
      { t: 'toString' },
      { t: 'hello', protocol: '1', game: GAME_VERSION, name: 'x' },
      { t: 'ready', ready: 'yes' },
      { t: 'start', hostTeam: 2, seed: 1, token: 'x', half: 60, rules: rulesFor('arcade') },
      { t: 'start', hostTeam: 0, seed: 1, token: 'x' },
      { t: 'start', hostTeam: 0, seed: 1, token: 'x', half: 5, rules: rulesFor('arcade') },
      { t: 'look', look: { name: 99, kit: 0 } },
      { t: 'rematch', want: 'yes' },
      { t: 'stats', stats: { shots: [1], possession: [1, 2], goals: [] } },
      { t: 'event', event: { id: 1, tick: 1, type: 'own-goal', half: 1, clock: 0, score: [0, 0] } },
      { t: 'rejoin', token: 5, lastEvent: 0 },
      { t: 'ping', id: 1, sent: Number.NaN },
      { t: 'lobby', lobby: { hostTeam: 0, ready: [true], names: ['a', 'b'], looks: [{ name: 0, kit: 0 }, { name: 1, kit: 1 }] } },
      { t: 'lobby', lobby: { hostTeam: 0, ready: [true, false], names: ['a', 'b'] } },
    ];
    for (const b of bad) expect(decode(b)).toBeNull();
  });

  it('detects version mismatches with a clear message', () => {
    expect(versionMismatch({ protocol: PROTOCOL_VERSION, game: GAME_VERSION }, 'host')).toBeNull();
    const msg = versionMismatch({ protocol: PROTOCOL_VERSION, game: '0.0.1' }, 'host');
    expect(msg).toContain('0.0.1');
    expect(msg).toContain(GAME_VERSION);
    expect(msg).toMatch(/reload/i);
    expect(versionMismatch({ protocol: PROTOCOL_VERSION + 1, game: GAME_VERSION }, 'guest')).not.toBeNull();
  });

  it('runs the lobby rules', () => {
    let lobby = createLobbyState('Host', 'Guest');
    expect(teamOf(lobby, 'host')).toBe(0); // host is home by default
    expect(teamOf(lobby, 'guest')).toBe(1);
    expect(canStart(lobby, true)).toBe(false);
    lobby = { ...lobby, ready: [true, true] };
    expect(canStart(lobby, false)).toBe(false); // nobody connected
    expect(canStart(lobby, true)).toBe(true);
    lobby = swapTeams(lobby);
    expect(teamOf(lobby, 'host')).toBe(1);
    expect(teamOf(lobby, 'guest')).toBe(0);
    expect(lobby.ready).toEqual([false, false]); // swapping teams clears ready
  });
});

describe('network errors', () => {
  it('maps PeerJS errors to player-facing ones', () => {
    expect(kindForPeerError('peer-unavailable')).toBe('room-not-found');
    expect(kindForPeerError('network')).toBe('broker-unreachable');
    expect(kindForPeerError('webrtc')).toBe('connection-failed');
    expect(kindForPeerError('something-new')).toBe('unknown');
  });

  it('gives connection failures a network hint', () => {
    expect(netError('connection-failed').hint).toMatch(/work|school|hotspot/i);
    expect(netError('timeout').hint).toMatch(/hotspot/i);
    expect(netError('version-mismatch', 'custom').message).toBe('custom');
  });
});

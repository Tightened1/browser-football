// T18: every message type survives encode -> wire -> decode, and malformed ones are rejected.
import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../src/config';
import {
  createLobbyState,
  decode,
  fromBase64,
  GAME_VERSION,
  PROTOCOL_VERSION,
  toBase64,
  type Message,
  type MessageType,
} from '../src/net/protocol';
import { decodeInputs, decodeSnapshot, encodeInputs, encodeSnapshot, packetType, PACKET_INPUTS, PACKET_SNAPSHOT, takeSnapshot } from '../src/net/snapshot';
import { rulesFor } from '../src/sim/matchRules';
import { createMatchState, NEUTRAL_INPUT, step } from '../src/sim/simulation';
import type { MatchEvent, MatchStats } from '../src/sim/types';

const lobby = createLobbyState('Host', 'Guest', { name: 1, kit: 2 }, { name: 3, kit: 4 }, rulesFor('classic'));
const event: MatchEvent = { id: 7, tick: 1234, type: 'penalty-result', half: 1, clock: 61.5, score: [1, 0], team: 0, player: 3, scored: false, saved: true };
const stats: MatchStats = {
  shots: [5, 3],
  possession: [120, 100],
  goals: [{ team: 0, player: 3, ownGoal: false, half: 1, clock: 61.5 }],
  fouls: [2, 4],
  cards: [{ team: 1, player: 7, card: 'yellow', half: 1, clock: 80 }],
  penalties: [{ team: 0, player: 4, scored: true, half: 2, clock: 12 }],
  shootout: { first: 1, kicks: [true, false, true, true], winner: -1 },
  players: [{ goals: 1, assists: 0, saves: 0, tackles: 2, shots: 3 }, { goals: 0, assists: 1, saves: 4, tackles: 0, shots: 0 }],
  humans: [{ goals: 1, assists: 0, saves: 0, tackles: 2, shots: 3 }, { goals: 0, assists: 1, saves: 4, tackles: 0, shots: 0 }],
};

/** One example of every message. Typed as a full Record so adding a message type without a test fails to compile. */
const SAMPLES: Record<MessageType, Message> = {
  hello: { t: 'hello', protocol: PROTOCOL_VERSION, game: GAME_VERSION, name: 'Guest' },
  welcome: { t: 'welcome', protocol: PROTOCOL_VERSION, game: GAME_VERSION, name: 'Host', lobby },
  reject: { t: 'reject', reason: 'version', protocol: PROTOCOL_VERSION, game: GAME_VERSION },
  lobby: { t: 'lobby', lobby },
  ready: { t: 'ready', ready: true },
  look: { t: 'look', look: { name: 2, kit: 5 } },
  swap: { t: 'swap' },
  'series-reset': { t: 'series-reset' },
  'lobby-back': { t: 'lobby-back' },
  emote: { t: 'emote', id: 3 },
  start: { t: 'start', hostTeam: 1, seed: 424242, token: 'abc123', half: 180, rules: rulesFor('arcade') },
  ping: { t: 'ping', id: 9, sent: 123456.5 },
  pong: { t: 'pong', id: 9, sent: 123456.5 },
  bye: { t: 'bye' },
  event: { t: 'event', event },
  stats: { t: 'stats', stats },
  rematch: { t: 'rematch', want: true },
  restart: { t: 'restart', seed: 99 },
  rejoin: { t: 'rejoin', token: 'abc123', lastEvent: 7 },
  replay: { t: 'replay', on: true, moment: 4321 },
  'replay-skip': { t: 'replay-skip', moment: 4321 },
  fast: { t: 'fast', b: toBase64(new Uint8Array([1, 2, 3, 250, 255])) },
};

describe('protocol messages', () => {
  for (const [type, msg] of Object.entries(SAMPLES)) {
    it(`${type}: survives JSON on the wire and decodes to the same message`, () => {
      const wire = JSON.parse(JSON.stringify(msg));
      expect(decode(wire)).toEqual(msg);
    });
  }

  it('has a sample for every validator (no message type is untested)', () => {
    expect(Object.keys(SAMPLES).length).toBe(22);
    for (const t of Object.keys(SAMPLES)) expect(decode(JSON.parse(JSON.stringify(SAMPLES[t as MessageType])))?.t).toBe(t);
  });

  it('rejects unknown types, wrong shapes and non-objects', () => {
    for (const bad of [null, undefined, 5, 'hello', [], {}, { t: 'nope' }, { t: '__proto__' }, { t: 'constructor' }]) expect(decode(bad)).toBeNull();
    expect(decode({ t: 'hello', protocol: 'x', game: GAME_VERSION, name: 'a' })).toBeNull();
    expect(decode({ ...SAMPLES.start, half: 5 })).toBeNull();
    expect(decode({ ...SAMPLES.start, seed: Infinity })).toBeNull();
    expect(decode({ ...SAMPLES.ready, ready: 'yes' })).toBeNull();
    expect(decode({ ...SAMPLES.event, event: { ...event, type: 'dance' } })).toBeNull();
    expect(decode({ ...SAMPLES.lobby, lobby: { ...lobby, hostTeam: 2 } })).toBeNull();
    expect(decode({ t: 'fast', b: 'x'.repeat(5000) })).toBeNull();
    // T21: quick chat is a preset index, never text; a lobby needs a valid series; stats need their tallies.
    for (const id of [6, -1, 1.5, '0', null]) expect(decode({ t: 'emote', id })).toBeNull();
    expect(decode({ t: 'emote', text: 'hello' })).toBeNull();
    // T23: replay messages need their goal's tick.
    expect(decode({ t: 'replay', on: 'yes', moment: 1 })).toBeNull();
    expect(decode({ t: 'replay-skip' })).toBeNull();
    expect(decode({ ...SAMPLES.lobby, lobby: { ...lobby, series: { host: -1, guest: 0, draws: 0 } } })).toBeNull();
    expect(decode({ ...SAMPLES.lobby, lobby: { ...lobby, series: undefined } })).toBeNull();
    expect(decode({ ...SAMPLES.stats, stats: { ...stats, players: [{ goals: 'x' }] } })).toBeNull();
  });
});

describe('binary packets', () => {
  it('snapshot -> bytes -> base64 `fast` message -> bytes -> snapshot', () => {
    let s = createMatchState({ aiVsAi: true, seed: 3 });
    for (let i = 0; i < 300; i++) s = step(s, [undefined, undefined], SIM_DT);
    const snap = takeSnapshot(s, { ack: 5, paused: false, resumeIn: 0 });
    const bytes = encodeSnapshot(snap);
    expect(packetType(bytes)).toBe(PACKET_SNAPSHOT);
    const msg = decode(JSON.parse(JSON.stringify({ t: 'fast', b: toBase64(bytes) })));
    expect(msg?.t).toBe('fast');
    const back = fromBase64((msg as { b: string }).b);
    expect(back).toEqual(bytes);
    expect(decodeSnapshot(back!)?.tick).toBe(snap.tick);
  });

  it('inputs -> bytes -> base64 `fast` message -> bytes -> inputs', () => {
    const frames = [1, 2, 3].map((seq) => ({ ...NEUTRAL_INPUT, seq, moveX: seq === 2 ? 1 : 0, shoot: seq === 3, sprint: true }));
    const bytes = encodeInputs(frames);
    expect(packetType(bytes)).toBe(PACKET_INPUTS);
    const back = decodeInputs(fromBase64(toBase64(bytes))!);
    expect(back?.map((f) => [f.seq, f.moveX, f.shoot, f.sprint])).toEqual(frames.map((f) => [f.seq, f.moveX, f.shoot, f.sprint]));
  });

  it('rejects truncated and garbage packets instead of throwing', () => {
    const bytes = encodeInputs([{ ...NEUTRAL_INPUT, seq: 1 }]);
    expect(decodeInputs(bytes.slice(0, 2))).toBeNull();
    expect(decodeSnapshot(new Uint8Array([PACKET_SNAPSHOT, 1, 2, 3]))).toBeNull();
    expect(decodeSnapshot(new Uint8Array(0))).toBeNull();
    expect(fromBase64('***not base64***')).toBeNull();
  });
});

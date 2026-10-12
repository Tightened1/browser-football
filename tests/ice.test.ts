import { describe, expect, it } from 'vitest';
import {
  describeRoute,
  diagnosticsReportText,
  explainIceError,
  hasTurn,
  parseCandidate,
  parseIceServersResponse,
  routeLabel,
  selectedRoute,
  summarizeCandidates,
  summarizeDiagnostics,
  turnServersFromEnv,
  type CandidateInfo,
  type DiagnosticsResults,
  type StatsEntry,
} from '../src/net/ice';

const HOST = 'candidate:1 1 udp 2122260223 abc.local 54400 typ host generation 0';
const SRFLX = 'candidate:2 1 udp 1686052607 203.0.113.7 61201 typ srflx raddr 0.0.0.0 rport 0 generation 0';
const RELAY = 'candidate:3 1 udp 41885439 198.51.100.9 50000 typ relay raddr 203.0.113.7 rport 61201 generation 0';

describe('parseCandidate', () => {
  it('reads type, protocol, address and port', () => {
    expect(parseCandidate(HOST)).toEqual({ type: 'host', protocol: 'udp', address: 'abc.local', port: 54400 });
    expect(parseCandidate(`a=${SRFLX}`)).toMatchObject({ type: 'srflx', address: '203.0.113.7', port: 61201 });
    expect(parseCandidate(RELAY, 'TLS')).toMatchObject({ type: 'relay', relayProtocol: 'tls' });
  });

  it('rejects junk', () => {
    expect(parseCandidate('')).toBeNull();
    expect(parseCandidate('candidate:1 1 udp 1 1.2.3.4 99 typ bogus')).toBeNull();
    expect(parseCandidate('hello world')).toBeNull();
  });
});

describe('summarizeCandidates', () => {
  const c = (line: string, rp?: string): CandidateInfo => parseCandidate(line, rp)!;

  it('counts each type and lists relay transports', () => {
    const s = summarizeCandidates([c(HOST), c(SRFLX), c(RELAY, 'udp'), c(RELAY.replace('50000', '50001'), 'tls')]);
    expect(s).toMatchObject({ host: 1, srflx: 1, relay: 2, relayProtocols: ['tls', 'udp'], strictNat: false });
  });

  it('flags a strict NAT when one public address maps to different ports', () => {
    const s = summarizeCandidates([c(SRFLX), c(SRFLX.replace('61201', '61999'))]);
    expect(s.strictNat).toBe(true);
  });
});

describe('selectedRoute', () => {
  const local = (type: string, extra: Record<string, unknown> = {}): StatsEntry => ({ id: 'L', type: 'local-candidate', candidateType: type, protocol: 'udp', ...extra });
  const remote = (type: string): StatsEntry => ({ id: 'R', type: 'remote-candidate', candidateType: type });
  const pair = (extra: Record<string, unknown> = {}): StatsEntry => ({ id: 'P', type: 'candidate-pair', localCandidateId: 'L', remoteCandidateId: 'R', ...extra });

  it('follows the transport selectedCandidatePairId (Chrome/Safari)', () => {
    const route = selectedRoute([{ id: 'T', type: 'transport', selectedCandidatePairId: 'P' }, pair(), local('srflx'), remote('host')]);
    expect(route).toEqual({ kind: 'direct', local: 'srflx', remote: 'host', protocol: 'udp' });
    expect(routeLabel(route!)).toBe('Direct');
  });

  it('uses the selected flag (Firefox) and spots a relay on either end', () => {
    expect(selectedRoute([pair({ selected: true }), local('host'), remote('relay')])?.kind).toBe('relayed');
    const r = selectedRoute([pair({ nominated: true, state: 'succeeded' }), local('relay', { relayProtocol: 'tls', protocol: 'udp' }), remote('srflx')]);
    expect(r).toMatchObject({ kind: 'relayed', relayProtocol: 'tls' });
    expect(describeRoute(r!)).toContain('TLS');
  });

  it('is null before a pair is chosen', () => {
    expect(selectedRoute([pair({ state: 'in-progress' }), local('host'), remote('host')])).toBeNull();
    expect(selectedRoute([])).toBeNull();
  });
});

describe('ICE server config', () => {
  it('detects TURN', () => {
    expect(hasTurn([{ urls: 'stun:stun.l.google.com:19302' }])).toBe(false);
    expect(hasTurn([{ urls: ['stun:x', 'turns:relay.example:443?transport=tcp'] }])).toBe(true);
  });

  it('reads Metered (array) and Cloudflare ({ iceServers }) responses', () => {
    const metered = [{ urls: 'turn:a:80', username: 'u', credential: 'p' }, { urls: 'stun:a:80' }];
    expect(parseIceServersResponse(metered)).toEqual(metered);
    const cloudflare = { iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }, { urls: ['turn:turn.cloudflare.com:3478?transport=udp'], username: 'u', credential: 'c' }] };
    expect(parseIceServersResponse(cloudflare)).toHaveLength(2);
    expect(parseIceServersResponse({ iceServers: { urls: 'turn:x', username: 'u', credential: 'c' } })).toHaveLength(1);
  });

  it('rejects responses with nothing usable', () => {
    expect(parseIceServersResponse(null)).toBeNull();
    expect(parseIceServersResponse({ error: 'bad key' })).toBeNull();
    expect(parseIceServersResponse([{ nope: 1 }])).toBeNull();
  });

  it('builds fixed TURN entries from env strings', () => {
    expect(turnServersFromEnv(undefined, 'u', 'p')).toEqual([]);
    expect(turnServersFromEnv(' turn:a:80 , turns:a:443?transport=tcp ', 'u', 'p')).toEqual([{ urls: ['turn:a:80', 'turns:a:443?transport=tcp'], username: 'u', credential: 'p' }]);
  });
});

describe('summarizeDiagnostics', () => {
  const base = (over: Partial<DiagnosticsResults> = {}): DiagnosticsResults => ({
    webrtc: true,
    broker: { ok: true, ms: 120 },
    turn: { configured: true, source: 'fetched' },
    gathering: { candidates: [parseCandidate(HOST)!, parseCandidate(SRFLX)!, parseCandidate(RELAY, 'udp')!], errors: [], ms: 300 },
    relayTest: { ok: true, ms: 40, route: null },
    lastRoute: null,
    ...over,
  });

  it('is all good with direct routes and a working relay', () => {
    expect(summarizeDiagnostics(base()).verdict.level).toBe('ok');
  });

  it('says it is still running while checks are pending', () => {
    expect(summarizeDiagnostics(base({ broker: null })).verdict.level).toBe('pending');
  });

  it('fails clearly when the broker is blocked', () => {
    const s = summarizeDiagnostics(base({ broker: { ok: false, ms: 10000, error: 'network' } }));
    expect(s.verdict.level).toBe('bad');
    expect(s.verdict.detail).toMatch(/matchmaking/);
  });

  it('warns that games will be relayed when UDP is blocked but the relay works', () => {
    const s = summarizeDiagnostics(base({ gathering: { candidates: [parseCandidate(HOST)!, parseCandidate(RELAY, 'tls')!], errors: [], ms: 300 } }));
    expect(s.verdict.level).toBe('warn');
    expect(s.rows.find((r) => r.title.startsWith('Public'))?.level).toBe('bad');
  });

  it('says online play is unlikely with no public address and no relay', () => {
    const s = summarizeDiagnostics(
      base({ turn: { configured: false, source: 'none' }, gathering: { candidates: [parseCandidate(HOST)!], errors: [], ms: 300 }, relayTest: 'skipped' }),
    );
    expect(s.verdict.level).toBe('bad');
    expect(s.rows.find((r) => r.title.startsWith('Relay (TURN)'))?.level).toBe('warn');
  });

  it('explains TURN errors such as bad keys', () => {
    const errors = [{ url: 'turn:global.relay.metered.ca:80?transport=tcp', code: 401, text: 'Unauthorized' }];
    const s = summarizeDiagnostics(base({ gathering: { candidates: [parseCandidate(SRFLX)!], errors, ms: 300 }, relayTest: 'skipped' }));
    expect(s.rows.find((r) => r.title.startsWith('Relay address'))?.detail).toMatch(/wrong or have expired/);
    expect(explainIceError(errors[0])).not.toContain('?transport');
  });

  it('reports without addresses', () => {
    const r = base();
    const text = diagnosticsReportText(summarizeDiagnostics(r), r, '0.8.0');
    expect(text).toContain('v0.8.0');
    expect(text).not.toContain('203.0.113.7');
  });

  it('handles a browser without WebRTC', () => {
    expect(summarizeDiagnostics(base({ webrtc: false })).verdict.level).toBe('bad');
  });
});

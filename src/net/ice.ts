// ICE helpers, pure (no WebRTC objects, no DOM): reading candidates and stats, TURN credential responses, and
// turning connection-diagnostics results into plain English.

/* ---- Candidates ----------------------------------------------------------------------------------- */

/** host: this device's own address · srflx: its public address (found via STUN) · prflx: one learned while connecting · relay: a TURN server's address. */
export type CandidateType = 'host' | 'srflx' | 'prflx' | 'relay';

export interface CandidateInfo {
  type: CandidateType;
  /** Transport between the two browsers (or the browser and the TURN server, for relay): udp or tcp. */
  protocol: string;
  address: string;
  port: number;
  /** Relay only: how this browser reaches the TURN server (udp, tcp or tls), when the browser says. */
  relayProtocol?: string;
}

/** Parses an SDP candidate line ("candidate:842163049 1 udp 1677729535 203.0.113.7 61201 typ srflx raddr …"). */
export function parseCandidate(line: string, relayProtocol?: string): CandidateInfo | null {
  const parts = line.trim().replace(/^a=/, '').split(/\s+/);
  if (parts.length < 8 || !parts[0].startsWith('candidate:')) return null;
  const typIndex = parts.indexOf('typ');
  const type = typIndex >= 0 ? parts[typIndex + 1] : undefined;
  if (type !== 'host' && type !== 'srflx' && type !== 'prflx' && type !== 'relay') return null;
  const port = Number(parts[5]);
  if (!Number.isFinite(port)) return null;
  const info: CandidateInfo = { type, protocol: parts[2].toLowerCase(), address: parts[4], port };
  if (relayProtocol) info.relayProtocol = relayProtocol.toLowerCase();
  return info;
}

export interface CandidateSummary {
  host: number;
  srflx: number;
  relay: number;
  /** How the relay can be reached (udp/tcp/tls), de-duplicated. */
  relayProtocols: string[];
  /**
   * The same public address showed up with different ports for different STUN servers: a "symmetric" NAT, which
   * gives every destination a new port, so the other player can't reach the one STUN saw. Direct connections
   * through it usually fail. (A heuristic: two network adapters behind one router can look the same.)
   */
  strictNat: boolean;
}

export function summarizeCandidates(candidates: readonly CandidateInfo[]): CandidateSummary {
  const count = (t: CandidateType): number => candidates.filter((c) => c.type === t).length;
  const relayProtocols = [...new Set(candidates.filter((c) => c.type === 'relay').map((c) => c.relayProtocol ?? c.protocol))].sort();
  const portsByAddress = new Map<string, Set<number>>();
  for (const c of candidates) {
    if (c.type !== 'srflx' || c.protocol !== 'udp') continue;
    const ports = portsByAddress.get(c.address) ?? new Set<number>();
    ports.add(c.port);
    portsByAddress.set(c.address, ports);
  }
  const strictNat = [...portsByAddress.values()].some((ports) => ports.size > 1);
  return { host: count('host'), srflx: count('srflx') + count('prflx'), relay: count('relay'), relayProtocols, strictNat };
}

/* ---- Which route a connection took ------------------------------------------------------------------ */

export type RouteKind = 'direct' | 'relayed';

export interface Route {
  kind: RouteKind;
  local: CandidateType;
  remote: CandidateType;
  /** udp or tcp. */
  protocol: string;
  /** For a relayed route through our own TURN allocation: how we reach the relay (udp/tcp/tls), when known. */
  relayProtocol?: string;
}

/** The fields of RTCStats entries this module reads (getStats() returns a Map of these). */
export interface StatsEntry {
  id: string;
  type: string;
  [key: string]: unknown;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const asCandidateType = (v: unknown): CandidateType | null =>
  v === 'host' || v === 'srflx' || v === 'prflx' || v === 'relay' ? v : null;

/**
 * The route of the candidate pair WebRTC is actually using, from a getStats() report, or null if none is
 * selected yet. Chrome/Safari name it on the transport (selectedCandidatePairId); Firefox flags the pair (selected).
 */
export function selectedRoute(stats: Iterable<StatsEntry>): Route | null {
  const byId = new Map<string, StatsEntry>();
  for (const s of stats) byId.set(s.id, s);
  let pair: StatsEntry | undefined;
  for (const s of byId.values()) {
    const id = s.type === 'transport' ? str(s.selectedCandidatePairId) : undefined;
    if (id && byId.get(id)) pair = byId.get(id);
  }
  pair ??= [...byId.values()].find((s) => s.type === 'candidate-pair' && s.selected === true);
  pair ??= [...byId.values()].find((s) => s.type === 'candidate-pair' && s.nominated === true && s.state === 'succeeded');
  if (!pair) return null;
  const local = byId.get(str(pair.localCandidateId) ?? '');
  const remote = byId.get(str(pair.remoteCandidateId) ?? '');
  const localType = asCandidateType(local?.candidateType);
  const remoteType = asCandidateType(remote?.candidateType);
  if (!local || !localType || !remoteType) return null;
  const route: Route = {
    kind: localType === 'relay' || remoteType === 'relay' ? 'relayed' : 'direct',
    local: localType,
    remote: remoteType,
    protocol: (str(local.protocol) ?? 'udp').toLowerCase(),
  };
  const relayProtocol = str(local.relayProtocol);
  if (localType === 'relay' && relayProtocol) route.relayProtocol = relayProtocol.toLowerCase();
  return route;
}

/** "Direct" or "Relayed", as shown in the lobby. */
export function routeLabel(route: Route): string {
  return route.kind === 'direct' ? 'Direct' : 'Relayed';
}

/** A short explanation of a route, e.g. "Direct (over the internet, UDP)" or "Relayed (through the TURN server, TLS)". */
export function describeRoute(route: Route): string {
  if (route.kind === 'relayed') {
    const via = route.relayProtocol ?? route.protocol;
    return `Relayed (through a TURN relay server, ${via.toUpperCase()})`;
  }
  const where = route.local === 'host' && route.remote === 'host' ? 'same network' : 'over the internet';
  return `Direct (${where}, ${route.protocol.toUpperCase()})`;
}

/* ---- ICE server lists ------------------------------------------------------------------------------- */

const urlsOf = (s: RTCIceServer): string[] => (Array.isArray(s.urls) ? s.urls : [s.urls]);

/** True if any of the servers is a TURN relay (turn: or turns:). */
export function hasTurn(servers: readonly RTCIceServer[]): boolean {
  return servers.some((s) => urlsOf(s).some((u) => /^turns?:/i.test(u)));
}

function isIceServer(v: unknown): v is RTCIceServer {
  if (typeof v !== 'object' || v === null) return false;
  const urls = (v as { urls?: unknown }).urls;
  return typeof urls === 'string' || (Array.isArray(urls) && urls.length > 0 && urls.every((u) => typeof u === 'string'));
}

/**
 * Reads the ICE servers out of a TURN credentials response. Accepts the shapes the common services return:
 * a bare array (Metered's credentials API) or `{ iceServers: [...] | {...} }` (Cloudflare's generate-ice-servers).
 * Returns null if nothing usable is in it.
 */
export function parseIceServersResponse(body: unknown): RTCIceServer[] | null {
  let list: unknown = body;
  if (typeof body === 'object' && body !== null && !Array.isArray(body) && 'iceServers' in body) list = (body as { iceServers: unknown }).iceServers;
  if (isIceServer(list)) list = [list];
  if (!Array.isArray(list)) return null;
  const servers = list.filter(isIceServer).map((s) => {
    const out: RTCIceServer = { urls: s.urls };
    if (typeof s.username === 'string') out.username = s.username;
    if (typeof s.credential === 'string') out.credential = s.credential;
    return out;
  });
  return servers.length > 0 ? servers : null;
}

/** Fixed TURN entries from comma-separated URLs plus one username/credential (the build-time env variables). */
export function turnServersFromEnv(urls: string | undefined, username: string | undefined, credential: string | undefined): RTCIceServer[] {
  const list = (urls ?? '').split(',').map((u) => u.trim()).filter(Boolean);
  if (list.length === 0) return [];
  return [{ urls: list, username: username ?? '', credential: credential ?? '' }];
}

/* ---- Diagnostics: plain-English results --------------------------------------------------------------- */

export type CheckLevel = 'ok' | 'warn' | 'bad' | 'pending' | 'info';

export interface CheckRow {
  level: CheckLevel;
  title: string;
  detail: string;
}

/** A STUN/TURN server that failed while gathering candidates (RTCPeerConnectionIceErrorEvent). */
export interface IceServerError {
  url: string;
  code: number;
  text: string;
}

export interface DiagnosticsResults {
  webrtc: boolean;
  /** null = still checking. */
  broker: { ok: boolean; ms: number; error?: string } | null;
  /** How TURN is set up in config.ts / the build. */
  turn: { configured: boolean; source: 'none' | 'static' | 'fetched' | 'fetch-failed'; error?: string };
  /** null = still gathering. */
  gathering: { candidates: CandidateInfo[]; errors: IceServerError[]; ms: number } | null;
  /** Sending data to ourselves through the relay. null = still running; 'skipped' when no TURN is set up. */
  relayTest: { ok: boolean; ms: number; route: Route | null; error?: string } | 'skipped' | null;
  /** The route of the last online game in this tab, if any. */
  lastRoute: Route | null;
}

/** What a TURN error code means, for people. */
export function explainIceError(e: IceServerError): string {
  const server = e.url.replace(/\?.*$/, '');
  if (e.code === 401) return `${server} refused the username/password — the TURN keys are wrong or have expired.`;
  if (e.code === 701) return `${server} could not be reached (blocked, or the address is wrong).`;
  if (e.code === 403) return `${server} refused to relay (quota used up, or this address isn't allowed).`;
  return `${server} failed: ${e.code} ${e.text}`.trim();
}

export interface DiagnosticsSummary {
  verdict: CheckRow;
  rows: CheckRow[];
}

/** Turns raw diagnostics into a headline verdict plus one row per check. */
export function summarizeDiagnostics(r: DiagnosticsResults): DiagnosticsSummary {
  const rows: CheckRow[] = [];

  if (!r.webrtc) {
    const row: CheckRow = { level: 'bad', title: 'Browser', detail: "This browser doesn't support WebRTC, which online play needs. Use a recent Chrome, Edge, Firefox or Safari." };
    return { verdict: { ...row, title: 'Online play is not possible in this browser' }, rows: [row] };
  }
  rows.push({ level: 'ok', title: 'Browser', detail: 'WebRTC is supported.' });

  // 1. Matchmaking server.
  if (r.broker === null) rows.push({ level: 'pending', title: 'Matchmaking server', detail: 'Checking…' });
  else if (r.broker.ok) rows.push({ level: 'ok', title: 'Matchmaking server', detail: `Reached the PeerJS server in ${Math.round(r.broker.ms)} ms. Room codes will work.` });
  else
    rows.push({
      level: 'bad',
      title: 'Matchmaking server',
      detail: `Could not reach the PeerJS server${r.broker.error ? ` (${r.broker.error})` : ''}. Without it the two players can't find each other — a firewall or web filter may be blocking it.`,
    });

  // 2. Relay set-up.
  if (!r.turn.configured) rows.push({ level: 'warn', title: 'Relay (TURN) set-up', detail: 'No relay server is configured, so players on strict networks will not be able to connect. See docs/NETWORK_TESTING.md.' });
  else if (r.turn.source === 'fetch-failed')
    rows.push({ level: 'bad', title: 'Relay (TURN) set-up', detail: `Could not fetch the relay credentials${r.turn.error ? ` (${r.turn.error})` : ''}.` });
  else rows.push({ level: 'ok', title: 'Relay (TURN) set-up', detail: r.turn.source === 'fetched' ? 'Relay credentials fetched.' : 'Relay credentials are built in.' });

  // 3. Candidates.
  const summary = r.gathering ? summarizeCandidates(r.gathering.candidates) : null;
  if (!r.gathering || !summary) rows.push({ level: 'pending', title: 'Network routes', detail: 'Looking for ways to reach other players…' });
  else {
    rows.push({
      level: summary.host > 0 ? 'ok' : 'warn',
      title: 'Local address (host)',
      detail: summary.host > 0 ? `${summary.host} found. Players on the same Wi-Fi can connect directly.` : 'None found (unusual — a privacy setting or extension may be hiding it).',
    });
    if (summary.srflx === 0)
      rows.push({
        level: 'bad',
        title: 'Public address (srflx)',
        detail: 'None found: this network blocks the UDP traffic direct connections need (common on work and school networks). Only the relay can work from here.',
      });
    else if (summary.strictNat)
      rows.push({
        level: 'warn',
        title: 'Public address (srflx)',
        detail: 'Found, but this network changes your public port for every destination ("strict" or symmetric NAT). Direct connections will often fail; the relay will take over.',
      });
    else rows.push({ level: 'ok', title: 'Public address (srflx)', detail: 'Found via STUN. Direct connections over the internet should be possible.' });

    if (!r.turn.configured || r.turn.source === 'fetch-failed') rows.push({ level: 'info', title: 'Relay address (relay)', detail: 'Not tested — no relay server set up.' });
    else if (summary.relay > 0) rows.push({ level: 'ok', title: 'Relay address (relay)', detail: `Got an address on the relay server (via ${summary.relayProtocols.join(', ').toUpperCase()}).` });
    else {
      const why = r.gathering.errors.filter((e) => /^turns?:/i.test(e.url)).map(explainIceError);
      rows.push({
        level: 'bad',
        title: 'Relay address (relay)',
        detail: `The relay server gave no address.${why.length ? ` ${[...new Set(why)].slice(0, 2).join(' ')}` : ' It may be blocked by this network, or the keys may be wrong.'}`,
      });
    }
  }

  // 4. Relay round trip.
  if (r.relayTest === 'skipped') {
    // Already explained by the relay rows.
  } else if (r.relayTest === null) rows.push({ level: 'pending', title: 'Relay test', detail: 'Sending test data through the relay…' });
  else if (r.relayTest.ok)
    rows.push({
      level: 'ok',
      title: 'Relay test',
      detail: `Test data went through the relay and back in ${Math.round(r.relayTest.ms)} ms. If a direct connection fails, the game will fall back to the relay.`,
    });
  else rows.push({ level: 'bad', title: 'Relay test', detail: `Could not send data through the relay${r.relayTest.error ? ` (${r.relayTest.error})` : ''}.` });

  // 5. The last real game.
  if (r.lastRoute) rows.push({ level: 'info', title: 'Last online game', detail: describeRoute(r.lastRoute) });

  return { verdict: verdictFor(r, summary), rows };
}

function verdictFor(r: DiagnosticsResults, s: CandidateSummary | null): CheckRow {
  const title = 'Overall';
  if (r.broker && !r.broker.ok) return { level: 'bad', title, detail: "Online play won't work from this network: the matchmaking server is blocked or down. Try a home network or a phone hotspot." };
  const running = r.broker === null || r.gathering === null || r.relayTest === null;
  if (running || !s) return { level: 'pending', title, detail: 'Running checks…' };
  const relayOk = typeof r.relayTest === 'object' && r.relayTest !== null && r.relayTest.ok;
  const directLikely = s.srflx > 0 && !s.strictNat;
  if (directLikely && relayOk) return { level: 'ok', title, detail: 'All good. Direct connections should work, and the relay is there as a backup.' };
  if (directLikely)
    return {
      level: 'ok',
      title,
      detail: 'Direct connections should work from here. With no working relay, a friend on a strict network (work, school, some mobile data) may still be unable to connect.',
    };
  if (relayOk) return { level: 'warn', title, detail: 'Direct connections are unlikely from this network, but the relay works — online games will be relayed (slightly higher ping).' };
  return { level: 'bad', title, detail: 'Online play is unlikely to work from this network: direct connections look blocked and no working relay is available.' };
}

/** A plain-text copy of the results, to paste to a friend or into a bug report. */
export function diagnosticsReportText(summary: DiagnosticsSummary, r: DiagnosticsResults, version: string): string {
  const mark: Record<CheckLevel, string> = { ok: 'OK  ', warn: 'WARN', bad: 'FAIL', pending: '... ', info: 'INFO' };
  const lines = [`Browser Football v${version} — connection test`, `${mark[summary.verdict.level]} ${summary.verdict.detail}`, ''];
  for (const row of summary.rows) lines.push(`${mark[row.level]} ${row.title}: ${row.detail}`);
  if (r.gathering) {
    lines.push('', 'Candidates (type protocol [relay transport]):');
    // Addresses are left out on purpose: the report may be pasted in public.
    for (const c of r.gathering.candidates) lines.push(`  ${c.type} ${c.protocol}${c.relayProtocol ? ` via ${c.relayProtocol}` : ''}`);
    for (const e of r.gathering.errors) lines.push(`  error ${e.code} ${e.text} (${e.url.replace(/\?.*$/, '')})`);
  }
  return lines.join('\n');
}

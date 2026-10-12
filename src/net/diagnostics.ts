// Connection diagnostics: can we reach the PeerJS broker, which ICE candidates does this network give us, and does
// data actually flow through the TURN relay? Results fill in as each check finishes; ice.ts turns them into English.
import { DIAG_GATHER_TIMEOUT_MS, DIAG_RELAY_TIMEOUT_MS, NET_BROKER_TIMEOUT_MS, TURN_CREDENTIALS_URL } from '../config';
import { parseCandidate, type CandidateInfo, type DiagnosticsResults, type IceServerError, type Route } from './ice';
import { createPeer, lastRoute, loadIceServers, peerErrorType, routeOf } from './peer';

/** One run of every check. Read `results` (it fills in over time) until `done`; `cancel()` when leaving the screen. */
export class DiagnosticsRun {
  readonly results: DiagnosticsResults = {
    webrtc: typeof RTCPeerConnection !== 'undefined',
    broker: null,
    turn: { configured: false, source: 'none' },
    gathering: null,
    relayTest: null,
    lastRoute,
  };
  done = false;
  private cancelled = false;
  private readonly cleanups: (() => void)[] = [];

  constructor() {
    void this.run().finally(() => {
      this.done = true;
      this.cleanup();
    });
  }

  cancel(): void {
    this.cancelled = true;
    this.cleanup();
  }

  private cleanup(): void {
    for (const fn of this.cleanups.splice(0)) {
      try {
        fn();
      } catch {
        // Already closed.
      }
    }
  }

  private async run(): Promise<void> {
    if (!this.results.webrtc) return;
    const ice = await loadIceServers();
    if (this.cancelled) return;
    this.results.turn = { configured: ice.turn || !!TURN_CREDENTIALS_URL, source: ice.source, error: ice.error };
    await Promise.all([
      this.checkBroker(ice.servers).then((broker) => (this.results.broker = broker)),
      this.gather(ice.servers).then(async (gathering) => {
        if (this.cancelled) return;
        this.results.gathering = gathering;
        const relayFound = gathering.candidates.some((c) => c.type === 'relay');
        this.results.relayTest = relayFound ? await this.relayRoundTrip(ice.servers) : 'skipped';
      }),
    ]);
  }

  /** Registers a throwaway peer with the broker (the same thing hosting or joining does first). */
  private checkBroker(servers: RTCIceServer[]): Promise<{ ok: boolean; ms: number; error?: string }> {
    const t0 = performance.now();
    return new Promise((resolve) => {
      const peer = createPeer(servers);
      this.cleanups.push(() => peer.destroy());
      const finish = (ok: boolean, error?: string): void => {
        clearTimeout(timer);
        peer.destroy();
        resolve({ ok, ms: performance.now() - t0, error });
      };
      const timer = setTimeout(() => finish(false, 'no answer'), NET_BROKER_TIMEOUT_MS);
      peer.on('open', () => finish(true));
      peer.on('error', (err) => finish(false, peerErrorType(err)));
    });
  }

  /** Collects this browser's ICE candidates, and any errors from the STUN/TURN servers. */
  private gather(servers: RTCIceServer[]): Promise<{ candidates: CandidateInfo[]; errors: IceServerError[]; ms: number }> {
    const t0 = performance.now();
    const candidates: CandidateInfo[] = [];
    const errors: IceServerError[] = [];
    const pc = new RTCPeerConnection({ iceServers: servers });
    this.cleanups.push(() => pc.close());
    return new Promise((resolve) => {
      let finished = false;
      const finish = (): void => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        pc.close();
        resolve({ candidates, errors, ms: performance.now() - t0 });
      };
      const timer = setTimeout(finish, DIAG_GATHER_TIMEOUT_MS);
      pc.onicecandidate = (e) => {
        if (!e.candidate) {
          finish(); // null candidate = gathering complete
          return;
        }
        // relayProtocol (udp/tcp/tls to the TURN server) is Chrome/Safari only.
        const relayProtocol = (e.candidate as RTCIceCandidate & { relayProtocol?: string }).relayProtocol;
        const c = parseCandidate(e.candidate.candidate, relayProtocol ?? undefined);
        if (c) candidates.push(c);
      };
      pc.onicecandidateerror = (e) => {
        const err = e as RTCPeerConnectionIceErrorEvent;
        const entry = { url: err.url ?? '', code: err.errorCode, text: err.errorText ?? '' };
        if (!errors.some((x) => x.url === entry.url && x.code === entry.code)) errors.push(entry);
      };
      pc.createDataChannel('probe');
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .catch(finish);
    });
  }

  /**
   * Opens a connection to ourselves where one side may only use the relay, then bounces a message off the other
   * side: proves data really flows through the TURN server from this network (which the fallback depends on).
   */
  private relayRoundTrip(servers: RTCIceServer[]): Promise<{ ok: boolean; ms: number; route: Route | null; error?: string }> {
    const a = new RTCPeerConnection({ iceServers: servers, iceTransportPolicy: 'relay' });
    const b = new RTCPeerConnection({ iceServers: servers });
    this.cleanups.push(() => a.close(), () => b.close());
    a.onicecandidate = (e) => e.candidate && void b.addIceCandidate(e.candidate).catch(() => {});
    b.onicecandidate = (e) => e.candidate && void a.addIceCandidate(e.candidate).catch(() => {});
    b.ondatachannel = (e) => {
      const echo = e.channel;
      echo.onmessage = (m) => echo.send(m.data);
    };
    const channel = a.createDataChannel('relay-test');
    return new Promise((resolve) => {
      let finished = false;
      let sentAt = 0;
      const finish = (ms: number | null, route: Route | null, error?: string): void => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        a.close();
        b.close();
        resolve({ ok: ms !== null, ms: ms ?? 0, route, error });
      };
      const timer = setTimeout(() => finish(null, null, 'timed out'), DIAG_RELAY_TIMEOUT_MS);
      a.oniceconnectionstatechange = () => a.iceConnectionState === 'failed' && finish(null, null, 'the relay connection failed');
      channel.onopen = () => {
        sentAt = performance.now();
        channel.send('ping');
      };
      channel.onmessage = () => {
        const ms = performance.now() - sentAt;
        void routeOf(a)
          .catch(() => null)
          .then((route) => finish(ms, route));
      };
      (async () => {
        await a.setLocalDescription(await a.createOffer());
        await b.setRemoteDescription(a.localDescription!);
        await b.setLocalDescription(await b.createAnswer());
        await a.setRemoteDescription(b.localDescription!);
      })().catch((err: unknown) => finish(null, null, err instanceof Error ? err.message : 'setup failed'));
    });
  }
}

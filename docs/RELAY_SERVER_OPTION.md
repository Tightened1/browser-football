# Fallback option: a small Node.js / Socket.io relay server (not built)

**Status: written up only (T08). This is roadmap item B05.** Build it only if real-world testing (`docs/NETWORK_TESTING.md`) shows peer-to-peer plus a TURN relay still fails too often.

## When it would be worth it

- **The PeerJS broker is blocked** on networks we care about. With TURN set up, this is the only failure P2P can't fix: if `0.peerjs.com` can't be reached, the players never find each other.
  - A cheaper first step is to self-host a PeerJS server (`peer` npm package) on our own domain. Change `PEER_SERVER` in `config.ts` and keep everything else.
- **Networks that block WebRTC entirely**, including TURN over TLS on port 443. These are uncommon, but some locked-down corporate networks allow only HTTPS/WebSockets.
- **We want features P2P makes awkward**, e.g. 2v2 (B04), spectators, or the match surviving the host closing their tab.

## What changes

The good news: the netcode is already **host-authoritative with typed messages**. So a server can start as a plain message relay, with the host browser still running the sim.

| Area | Change |
|---|---|
| **Server** (new `server/` folder, ~200 lines) | Node + Socket.io (WebSockets with an HTTP long-polling fallback, so it gets through almost any proxy). Rooms keyed by room code; `create`/`join`/`leave`. It forwards each message to the other player in the room, enforces 2 per room, and treats a socket disconnect as "left". Heartbeats come built in. |
| **Client transport** | `Link` (net/peer.ts) is the only thing that touches PeerJS. Add a `Transport` interface (`send`, `sendFast`, `onMessage`, `onFast`, `onClose`) with two implementations: PeerJS and Socket.io. `sendFast` becomes a binary Socket.io emit; the binary snapshots (143 bytes) and input packets work unchanged. |
| **Lobby** | `HostLobby`/`GuestLobby` connect through the chosen transport. Room codes, handshake, versioning, rejoin token and events all stay the same. |
| **Choosing** | Option A: try P2P, and fall back to the server if both direct and relay fail. Option B: always use the server (simpler, one code path). The diagnostics screen gets a "game server reachable" check. |
| **Hosting** | GitHub Pages can't run Node. Options: **Fly.io** or **Render** (free/hobby tiers, but they may sleep when idle, so expect a cold start of a few seconds), a ~£4/month VPS, or **Cloudflare Workers + Durable Objects** (WebSockets, generous free tier, but not Socket.io, so use plain `ws` messages). Needs HTTPS/WSS and a CORS allow-list for the Pages origin. |
| **Config** | `GAME_SERVER_URL` in `config.ts` (empty = P2P only). |

## Trade-offs

- **Latency:** every packet goes player → server → player. With a nearby region, expect +10–40 ms compared with direct P2P. That's about the same as TURN, and fine with our 100 ms interpolation delay.
- **Reliability over TCP:** WebSockets are TCP, so there's no truly unreliable channel. A lost packet holds up the ones behind it ("head-of-line blocking"), which shows up as occasional stutter on lossy connections. Our snapshots tolerate it; prediction hides most of it for the guest.
- **Cost and upkeep:** it's a server to keep running, patch and monitor. Bandwidth is tiny (~20 KB/s per match), so the free tiers will do for a hobby game.
- **Later upgrade:** with a server, the server itself could run the authoritative sim (the sim is pure TypeScript). That would remove host advantage and host-tab-hidden pauses. It's a bigger change and only worth it for B04 or ranked play.

## Rough effort

About one Opus session: the server plus deploy config, the `Transport` abstraction with tests, the diagnostics check, and the docs. The netcode itself (snapshots, interpolation, prediction, events) wouldn't change.

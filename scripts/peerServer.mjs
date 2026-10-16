// A local PeerJS signalling server, for the e2e tests only (T18). The public broker is shared and can be slow
// or down in CI; this one lives and dies with the test run. Started by playwright.config.ts.
//   PEER_PORT=9000 node scripts/peerServer.mjs
import { PeerServer } from 'peer';

const port = Number(process.env.PEER_PORT ?? 9000);
PeerServer({ port, path: '/', allow_discovery: false }, () => console.log(`PeerJS test server listening on :${port}`));

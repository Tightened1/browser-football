import { defineConfig } from '@playwright/test';

// Two servers: a local PeerJS broker (instead of the public one) and `vite preview` of the e2e build
// (`npm run build:e2e`, which reads .env.e2e). The broker port must match VITE_PEER_PORT in .env.e2e.
const PORT = Number(process.env.E2E_PORT ?? 4173);
const PEER_PORT = Number(process.env.PEER_PORT ?? 9000);

export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    launchOptions: {
      // Both pages are in one browser on one machine: let WebRTC offer real host candidates (no mDNS names).
      args: ['--disable-features=WebRtcHideLocalIpsWithMdns'],
    },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: [
    { command: 'node scripts/peerServer.mjs', env: { PEER_PORT: String(PEER_PORT) }, port: PEER_PORT, reuseExistingServer: !process.env.CI },
    { command: `npx vite preview --mode e2e --outDir dist-e2e --port ${PORT} --strictPort`, port: PORT, reuseExistingServer: !process.env.CI },
  ],
});

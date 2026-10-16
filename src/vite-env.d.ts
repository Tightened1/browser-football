/// <reference types="vite/client" />

// Build-time settings (see config.ts, TURN SERVERS). Unset = undefined.
interface ImportMetaEnv {
  readonly VITE_TURN_CREDENTIALS_URL?: string;
  readonly VITE_TURN_URLS?: string;
  readonly VITE_TURN_USERNAME?: string;
  readonly VITE_TURN_CREDENTIAL?: string;
  // Tests only (T18, .env.e2e): a local PeerJS broker, and `window.__game` in a production build.
  readonly VITE_PEER_HOST?: string;
  readonly VITE_PEER_PORT?: string;
  readonly VITE_PEER_PATH?: string;
  readonly VITE_PEER_SECURE?: string;
  readonly VITE_STUN_URLS?: string;
  readonly VITE_E2E?: string;
}

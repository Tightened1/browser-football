/// <reference types="vite/client" />

// Build-time settings (see config.ts, TURN SERVERS). Unset = undefined.
interface ImportMetaEnv {
  readonly VITE_TURN_CREDENTIALS_URL?: string;
  readonly VITE_TURN_URLS?: string;
  readonly VITE_TURN_USERNAME?: string;
  readonly VITE_TURN_CREDENTIAL?: string;
}

import { defineConfig } from 'vite';

// Served from https://<user>.github.io/browser-football/ in production.
export default defineConfig(({ command, mode }) => ({
  // The e2e build (--mode e2e) is served from the root by `vite preview`.
  base: command === 'build' && mode !== 'e2e' ? '/browser-football/' : '/',
  test: { include: ['tests/**/*.test.ts'] },
}));
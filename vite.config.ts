import { defineConfig } from 'vite';

// Served from https://<user>.github.io/browser-football/ in production.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/browser-football/' : '/',
  test: { include: ['tests/**/*.test.ts'] },
}));
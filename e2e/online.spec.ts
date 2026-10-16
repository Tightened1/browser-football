// T18: two real browser pages play an online match through a local PeerJS broker: host, join with the room
// code, start, press keys on both, and check that both show the same score and clock with no console errors.
import { expect, test, type Page } from '@playwright/test';

interface Snap {
  score: [number, number];
  clock: number;
  half: number;
  phase: string;
  tick: number;
}

const look = { name: 0, kit: 0 };

/** Phaser scenes are reachable through window.__game in the e2e build (see src/main.ts). */
async function openGame(page: Page, errors: string[], who: string): Promise<void> {
  page.on('pageerror', (e) => errors.push(`${who} pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${who} console.error: ${m.text()}`);
  });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__game?.scene.isActive('MenuScene'));
}

async function matchState(page: Page): Promise<Snap | null> {
  return page.evaluate(() => {
    const s = (window as any).__game.scene.getScene('MatchScene')?.driver?.state;
    return s ? { score: [...s.score], clock: s.clock, half: s.half, phase: s.phase, tick: s.tick } : null;
  });
}

/** Run in one direction for a moment, then pass and shoot, like a player would. */
async function playKeys(page: Page, key: string, ms: number): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.press('x');
  await page.keyboard.down('Space');
  await page.waitForTimeout(250);
  await page.keyboard.up('Space');
  await page.keyboard.up(key);
}

test('host and guest play a synchronised online match', async ({ browser }) => {
  const errors: string[] = [];
  // Two separate browser contexts = two separate players (own storage, own WebRTC peer).
  const hostPage = await (await browser.newContext()).newPage();
  const guestPage = await (await browser.newContext()).newPage();
  await openGame(hostPage, errors, 'host');
  await openGame(guestPage, errors, 'guest');

  // Host opens a room and reads its code from the lobby.
  await hostPage.evaluate((l) => (window as any).__game.scene.start('LobbyScene', { mode: 'host', look: l }), look);
  await hostPage.waitForFunction(() => /^[A-Z]{4}-\d{4}$/.test((window as any).__game.scene.getScene('LobbyScene')?.lobby?.view.code ?? ''), null, { timeout: 30_000 });
  const code = await hostPage.evaluate(() => (window as any).__game.scene.getScene('LobbyScene').lobby.view.code as string);

  // Guest joins with that code; both lobbies show a connection.
  await guestPage.evaluate(([c, l]) => (window as any).__game.scene.start('LobbyScene', { mode: 'join', code: c, look: l }), [code, look] as const);
  for (const page of [hostPage, guestPage]) {
    await page.waitForFunction(() => (window as any).__game.scene.getScene('LobbyScene')?.lobby?.view.status === 'connected', null, { timeout: 30_000 });
  }

  // Both ready, host starts.
  for (const page of [guestPage, hostPage]) await page.evaluate(() => (window as any).__game.scene.getScene('LobbyScene').lobby.setReady(true));
  await hostPage.waitForFunction(() => {
    const v = (window as any).__game.scene.getScene('LobbyScene').lobby.view;
    return v.lobby.ready[0] && v.lobby.ready[1];
  });
  await hostPage.evaluate(() => (window as any).__game.scene.getScene('LobbyScene').lobby.start());
  for (const page of [hostPage, guestPage]) {
    await page.waitForFunction(
      () => (window as any).__game.scene.isActive('MatchScene') && (window as any).__game.scene.getScene('MatchScene').driver?.state.phase === 'playing',
      null,
      { timeout: 30_000 },
    );
  }

  // A few seconds of play: both players run, pass and shoot.
  await hostPage.locator('canvas').click({ position: { x: 5, y: 5 } });
  await guestPage.locator('canvas').click({ position: { x: 5, y: 5 } });
  const before = (await matchState(guestPage))!;
  // Rendering in headless CI can be slow, so play until three match-seconds have passed rather than for a fixed time.
  const dirs = [['ArrowRight', 'ArrowLeft'], ['ArrowUp', 'ArrowDown'], ['ArrowDown', 'ArrowUp'], ['ArrowLeft', 'ArrowRight']];
  for (let round = 0; round < 40; round++) {
    const [h, g] = dirs[round % dirs.length];
    await Promise.all([playKeys(hostPage, h, 600), playKeys(guestPage, g, 600)]);
    if (((await matchState(hostPage))?.clock ?? 0) > before.clock + 3) break;
  }
  await hostPage.waitForTimeout(1500);

  // Same match on both screens: score equal, clock within snapshot/interpolation delay, and the clock moved.
  const host = (await matchState(hostPage))!;
  const guest = (await matchState(guestPage))!;
  expect(guest.score).toEqual(host.score);
  expect(guest.half).toBe(host.half);
  expect(Math.abs(guest.clock - host.clock)).toBeLessThan(1);
  expect(host.clock).toBeGreaterThan(before.clock + 3);
  expect(guest.tick).toBeGreaterThan(before.tick);

  expect(errors).toEqual([]);
});

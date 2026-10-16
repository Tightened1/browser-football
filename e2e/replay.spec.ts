// T23: two real browser pages: a goal is replayed on both screens while the host holds the kickoff, the guest skips it
// (which ends it for both), and at full time each player gets the highlights reel and then the results.
import { expect, test, type Browser, type Page } from '@playwright/test';

const look = { name: 0, kit: 0 };

async function openGame(page: Page, errors: string[], who: string): Promise<void> {
  page.on('pageerror', (e) => errors.push(`${who} pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${who} console.error: ${m.text()}`);
  });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__game?.scene.isActive('MenuScene'));
}

/** Evaluates `expr` with `scene` bound to the named Phaser scene of the page. */
const scene = (page: Page, key: string, expr: string) =>
  page.evaluate(([k, e]) => new Function('scene', `return ${e}`)((window as any).__game.scene.getScene(k)), [key, expr] as const);
const waitScene = (page: Page, key: string, expr: string, timeout = 15_000) =>
  page.waitForFunction(([k, e]) => { const s = (window as any).__game.scene.getScene(k); return !!s && !!new Function('scene', `return ${e}`)(s); }, [key, expr] as const, { timeout });

async function startOnlineMatch(browser: Browser, errors: string[]): Promise<{ hostPage: Page; guestPage: Page }> {
  const hostPage = await (await browser.newContext()).newPage();
  const guestPage = await (await browser.newContext()).newPage();
  await openGame(hostPage, errors, 'host');
  await openGame(guestPage, errors, 'guest');
  await hostPage.evaluate((l) => (window as any).__game.scene.start('LobbyScene', { mode: 'host', look: l }), look);
  await waitScene(hostPage, 'LobbyScene', '/^[A-Z]{4}-\\d{4}$/.test(scene.lobby?.view.code ?? "")', 30_000);
  const code: string = await scene(hostPage, 'LobbyScene', 'scene.lobby.view.code');
  await guestPage.evaluate(([c, l]) => (window as any).__game.scene.start('LobbyScene', { mode: 'join', code: c, look: l }), [code, look] as const);
  await Promise.all([hostPage, guestPage].map((p) => waitScene(p, 'LobbyScene', 'scene.lobby?.view.status === "connected"', 30_000)));
  for (const page of [guestPage, hostPage]) await scene(page, 'LobbyScene', 'scene.lobby.setReady(true)');
  await waitScene(hostPage, 'LobbyScene', 'scene.lobby.view.lobby.ready.every(Boolean)');
  await scene(hostPage, 'LobbyScene', 'scene.lobby.start()');
  for (const page of [hostPage, guestPage]) await waitScene(page, 'MatchScene', 'scene.driver?.state.phase === "playing"', 30_000);
  for (const page of [hostPage, guestPage]) await page.locator('canvas').click({ position: { x: 5, y: 5 } });
  return { hostPage, guestPage };
}

/** On the host: the ball just over the right goal line, between the posts (the next tick scores). */
async function scoreOnHost(hostPage: Page): Promise<void> {
  await hostPage.evaluate(() => {
    const s = (window as any).__game.scene.getScene('MatchScene').driver.state;
    s.restart = null;
    s.possession = null;
    s.ball.pos = { x: 1120 + s.ball.radius + 4, y: 410 }; // PITCH_RIGHT, mid-height
    s.ball.vel = { x: 250, y: 0 };
  });
}

const replayMode = (page: Page) => scene(page, 'MatchScene', 'scene.driver.replay()?.mode ?? null');
const live = (page: Page) => scene(page, 'MatchScene', '({ phase: scene.driver.state.phase, tick: scene.driver.state.tick, clock: scene.driver.state.clock, score: [...scene.driver.state.score] })');

test('T23: a goal is replayed on both screens, the kickoff waits, and either player can skip it for both', async ({ browser }) => {
  const errors: string[] = [];
  const { hostPage, guestPage } = await startOnlineMatch(browser, errors);
  // Some build-up to replay.
  await hostPage.waitForTimeout(2500);

  await scoreOnHost(hostPage);
  for (const page of [hostPage, guestPage]) await waitScene(page, 'MatchScene', 'scene.driver.state.phase === "goal-scored"', 10_000);
  // After the goal pause, the replay starts on both screens.
  for (const page of [hostPage, guestPage]) await waitScene(page, 'MatchScene', 'scene.driver.replay()?.mode === "replay"', 10_000);
  const clip = (p: Page) => scene(p, 'MatchScene', '({ kind: scene.driver.replay().clip.kind, moment: scene.driver.replay().clip.moment, frames: scene.driver.replay().clip.frames.length })');
  const [hc, gc] = [await clip(hostPage), await clip(guestPage)];
  expect(hc.kind).toBe('goal');
  expect(gc.moment).toBe(hc.moment); // the same goal, each from its own replay buffer
  expect(gc.frames).toBeGreaterThan(30);
  // The HUD shows the REPLAY banner.
  expect(await scene(guestPage, 'HudScene', 'scene.replayBanner.visible')).toBe(true);

  // The host's match is held: no ticks, no clock, no kickoff.
  const held = await live(hostPage);
  await hostPage.waitForTimeout(1200);
  expect(await live(hostPage)).toEqual(held);
  expect(held.phase).toBe('goal-scored');
  expect(held.score).toEqual([1, 0]);

  // The guest presses a key: the replay ends for both, and the kickoff follows.
  await guestPage.keyboard.press('KeyK');
  for (const page of [hostPage, guestPage]) await waitScene(page, 'MatchScene', 'scene.driver.replay() === null', 10_000);
  await waitScene(hostPage, 'MatchScene', 'scene.driver.state.phase === "playing"', 10_000);
  await waitScene(guestPage, 'MatchScene', 'scene.driver.state.phase === "playing"', 10_000);
  const after = await live(hostPage);
  expect(after.tick).toBeGreaterThan(held.tick);
  expect(await replayMode(guestPage)).toBeNull();

  // A second goal, this time the replay plays out by itself (no key): it still ends on both, then play resumes.
  await hostPage.waitForTimeout(2000);
  await scoreOnHost(hostPage);
  for (const page of [hostPage, guestPage]) await waitScene(page, 'MatchScene', 'scene.driver.replay()?.mode === "replay"', 10_000);
  for (const page of [hostPage, guestPage]) await waitScene(page, 'MatchScene', 'scene.driver.replay() === null && scene.driver.state.phase === "playing"', 30_000);

  // Full time: each player gets the highlights reel (both goals), skips it, and sees the results.
  await hostPage.evaluate(() => {
    const s = (window as any).__game.scene.getScene('MatchScene').driver.state;
    s.half = 2;
    s.clock = s.halfLength - 0.05;
    s.restart = null;
  });
  for (const page of [hostPage, guestPage]) await waitScene(page, 'MatchScene', 'scene.driver.replay()?.mode === "highlights"', 15_000);
  for (const page of [hostPage, guestPage]) expect(await scene(page, 'MatchScene', 'scene.driver.replay().total')).toBe(2);
  expect(await scene(hostPage, 'HudScene', 'scene.replayTitle.text')).toMatch(/^HIGHLIGHTS 1\/2$/);
  // Skipping your highlights doesn't skip the other player's.
  await hostPage.keyboard.press('KeyK');
  await waitScene(hostPage, 'ResultsScene', 'scene.sys.isActive()', 10_000);
  expect(await replayMode(guestPage)).toBe('highlights');
  await guestPage.keyboard.press('KeyK');
  await waitScene(guestPage, 'ResultsScene', 'scene.sys.isActive()', 10_000);

  expect(errors).toEqual([]);
  await Promise.all([hostPage.context().close(), guestPage.context().close()]);
});

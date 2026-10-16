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

/**
 * A CI runner can draw very few frames, so a replay's moments (it starting, the match being held) are watched from
 * inside each page every 20 ms and kept in `window.__rp`, rather than polled from the test.
 */
async function watchReplays(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as any;
    const rp = (w.__rp = { mode: null as string | null, replays: {} as Record<number, any>, highlights: null as any, highlightsEndedAt: null as number | null });
    setInterval(() => {
      const m = w.__game.scene.getScene('MatchScene');
      const hud = w.__game.scene.getScene('HudScene');
      if (!m?.driver) return;
      const v = m.driver.replay();
      const s = m.driver.state;
      if (rp.mode === 'highlights' && v?.mode !== 'highlights') rp.highlightsEndedAt = Date.now();
      rp.mode = v?.mode ?? null;
      if (v?.mode === 'replay') {
        const r = (rp.replays[v.clip.moment] ??= { kind: v.clip.kind, frames: v.clip.frames.length, banner: false, ticks: [], clocks: [], phases: [] });
        r.banner ||= !!hud?.replayBanner?.visible;
        if (!r.ticks.includes(s.tick)) r.ticks.push(s.tick);
        if (!r.clocks.includes(s.clock)) r.clocks.push(s.clock);
        if (!r.phases.includes(s.phase)) r.phases.push(s.phase);
      } else if (v?.mode === 'highlights') rp.highlights = { total: v.total, title: hud?.replayTitle?.text };
    }, 20);
  });
}

const rp = (page: Page): Promise<any> => page.evaluate(() => (window as any).__rp);
const waitRp = (page: Page, expr: string, timeout = 60_000) =>
  page.waitForFunction((e) => !!new Function('rp', 'm', `return ${e}`)((window as any).__rp, (window as any).__game.scene.getScene('MatchScene')), expr, { timeout, polling: 100 });

test('T23: a goal is replayed on both screens, the kickoff waits, and either player can skip it for both', async ({ browser }) => {
  test.setTimeout(420_000); // two goals and the highlights, on a runner that may draw only a few frames a second
  const errors: string[] = [];
  const { hostPage, guestPage } = await startOnlineMatch(browser, errors);
  for (const page of [hostPage, guestPage]) await watchReplays(page);
  // Some build-up to replay.
  await hostPage.waitForTimeout(2500);

  // A goal: after the goal pause, its replay plays on both screens (the same goal, each from its own replay buffer).
  await scoreOnHost(hostPage);
  for (const page of [hostPage, guestPage]) await waitRp(page, 'Object.keys(rp.replays).length >= 1');
  const [h1, g1] = [await rp(hostPage), await rp(guestPage)];
  const moment = Number(Object.keys(h1.replays)[0]);
  expect(h1.replays[moment].kind).toBe('goal');
  expect(g1.replays[moment]).toBeDefined();
  expect(g1.replays[moment].frames).toBeGreaterThan(30);
  expect(g1.replays[moment].banner).toBe(true); // the HUD shows the REPLAY banner

  // The guest presses a key: the replay ends for both, and the kickoff follows.
  await guestPage.waitForTimeout(1000);
  await guestPage.keyboard.press('KeyK');
  for (const page of [hostPage, guestPage]) await waitRp(page, 'rp.mode === null && m.driver.state.phase === "playing"');
  // Meanwhile the host's match was held: one tick, one clock reading, still in the goal pause, the score 1-0.
  const held = (await rp(hostPage)).replays[moment];
  expect(held.ticks.length).toBe(1);
  expect(held.clocks.length).toBe(1);
  expect(held.phases).toEqual(['goal-scored']);
  expect(await scene(hostPage, 'MatchScene', '[...scene.driver.state.score]')).toEqual([1, 0]);
  expect(await scene(hostPage, 'MatchScene', 'scene.driver.state.tick')).toBeGreaterThan(held.ticks[0]);

  // A second goal, this time the replay plays out by itself (no key): it still ends on both, then play resumes.
  await hostPage.waitForTimeout(2000);
  await scoreOnHost(hostPage);
  for (const page of [hostPage, guestPage]) await waitRp(page, 'Object.keys(rp.replays).length >= 2');
  for (const page of [hostPage, guestPage]) await waitRp(page, 'rp.mode === null && m.driver.state.phase === "playing"', 120_000);

  // Full time: each player gets the highlights reel (both goals), skips it, and sees the results.
  await hostPage.evaluate(() => {
    const s = (window as any).__game.scene.getScene('MatchScene').driver.state;
    s.half = 2;
    s.clock = s.halfLength - 0.05;
    s.restart = null;
  });
  for (const page of [hostPage, guestPage]) await waitRp(page, 'rp.highlights !== null');
  for (const page of [hostPage, guestPage]) expect((await rp(page)).highlights.total).toBe(2);
  expect((await rp(hostPage)).highlights.title).toMatch(/^HIGHLIGHTS [12]\/2$/);
  // Skipping your highlights doesn't skip the other player's: theirs ends later (on their key, or by itself).
  await hostPage.keyboard.press('KeyK');
  await waitScene(hostPage, 'ResultsScene', 'scene.sys.isActive()', 60_000);
  await guestPage.keyboard.press('KeyK');
  await waitScene(guestPage, 'ResultsScene', 'scene.sys.isActive()', 60_000);
  const [hostEnd, guestEnd] = [(await rp(hostPage)).highlightsEndedAt, (await rp(guestPage)).highlightsEndedAt];
  expect(guestEnd - hostEnd).toBeGreaterThan(300);

  expect(errors).toEqual([]);
  await Promise.all([hostPage.context().close(), guestPage.context().close()]);
});

// T21: two real browser pages: names, quick chat, the series score, man of the match, back to the lobby, and a guest
// that refreshes the page (in the lobby and in a match) and rejoins its room by itself.
import { expect, test, type Browser, type Page } from '@playwright/test';

const look = { name: 0, kit: 0 };
const SETTINGS_KEY = 'browser-football-settings-v1';

async function openGame(page: Page, errors: string[], who: string, name: string): Promise<void> {
  page.on('pageerror', (e) => errors.push(`${who} pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${who} console.error: ${m.text()}`);
  });
  // A saved player name, as if typed on the title screen.
  await page.addInitScript(([key, n]) => localStorage.setItem(key, JSON.stringify({ playerName: n })), [SETTINGS_KEY, name] as const);
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__game?.scene.isActive('MenuScene'));
}

/** Evaluates `expr` with `scene` bound to the named Phaser scene of the page. */
const scene = (page: Page, key: string, expr: string) =>
  page.evaluate(([k, e]) => new Function('scene', `return ${e}`)((window as any).__game.scene.getScene(k)), [key, expr] as const);
const activeScene = (page: Page, key: string) => page.waitForFunction((k) => (window as any).__game.scene.isActive(k), key, { timeout: 30_000 });
const waitScene = (page: Page, key: string, expr: string, timeout = 15_000) =>
  page.waitForFunction(([k, e]) => { const s = (window as any).__game.scene.getScene(k); return !!s && !!new Function('scene', `return ${e}`)(s); }, [key, expr] as const, { timeout });

async function matchState(page: Page): Promise<{ score: [number, number]; clock: number; phase: string; tick: number }> {
  return scene(page, 'MatchScene', '({ score: [...scene.driver.state.score], clock: scene.driver.state.clock, phase: scene.driver.state.phase, tick: scene.driver.state.tick })');
}

/** Host opens a room, guest joins by its code (both lobbies connected). */
async function connect(browser: Browser, errors: string[], names: { host: string; guest: string }): Promise<{ hostPage: Page; guestPage: Page; code: string }> {
  const hostPage = await (await browser.newContext()).newPage();
  const guestPage = await (await browser.newContext()).newPage();
  await openGame(hostPage, errors, 'host', names.host);
  await openGame(guestPage, errors, 'guest', names.guest);
  await hostPage.evaluate((l) => (window as any).__game.scene.start('LobbyScene', { mode: 'host', look: l }), look);
  await waitScene(hostPage, 'LobbyScene', '/^[A-Z]{4}-\\d{4}$/.test(scene.lobby?.view.code ?? "")', 30_000);
  const code: string = await scene(hostPage, 'LobbyScene', 'scene.lobby.view.code');
  await guestPage.evaluate(([c, l]) => (window as any).__game.scene.start('LobbyScene', { mode: 'join', code: c, look: l }), [code, look] as const);
  await Promise.all([hostPage, guestPage].map((p) => waitScene(p, 'LobbyScene', 'scene.lobby?.view.status === "connected"', 30_000)));
  return { hostPage, guestPage, code };
}

/** Both ready, host starts, both in the match. */
async function kickOff(hostPage: Page, guestPage: Page): Promise<void> {
  for (const page of [guestPage, hostPage]) await scene(page, 'LobbyScene', 'scene.lobby.setReady(true)');
  await waitScene(hostPage, 'LobbyScene', 'scene.lobby.view.lobby.ready.every(Boolean)');
  await scene(hostPage, 'LobbyScene', 'scene.lobby.start()');
  for (const page of [hostPage, guestPage]) await waitScene(page, 'MatchScene', 'scene.driver?.state.phase === "playing"', 30_000);
  for (const page of [hostPage, guestPage]) await page.locator('canvas').click({ position: { x: 5, y: 5 } });
}

/** Puts the host's match a moment from full time with a known score and stats (the sim itself is covered by unit tests). */
async function endMatch(hostPage: Page, score: [number, number]): Promise<void> {
  await hostPage.evaluate((sc) => {
    const s = (window as any).__game.scene.getScene('MatchScene').driver.state;
    s.half = 2;
    s.clock = s.halfLength - 0.05;
    s.score = sc;
    s.restart = null;
    s.stats.players[3].goals = 2;
    s.stats.humans[0].goals = 2;
  }, score);
}

test('T21: names, quick chat, a series score, man of the match, back to the lobby', async ({ browser }) => {
  const errors: string[] = [];
  const { hostPage, guestPage } = await connect(browser, errors, { host: 'Kev', guest: '<b>Sam</b>' });
  await kickOff(hostPage, guestPage);

  // Names: the guest's is cleaned, both screens use the same ones, and the HUD shows them.
  for (const page of [hostPage, guestPage]) expect(await scene(page, 'MatchScene', 'scene.online.view.lobby.names')).toEqual(['Kev', 'bSamb']);
  for (const page of [hostPage, guestPage]) await waitScene(page, 'HudScene', 'scene.players?.[0].text === "Kev" && scene.players[1].text === "bSamb"');

  // Quick chat: 1 from the guest reaches the host (a second one straight after is refused by the rate limit).
  // A bubble only lasts a few seconds and a CI runner draws few frames, so each page watches for it from inside the page.
  for (const page of [hostPage, guestPage]) {
    await page.evaluate(() => {
      const w = window as any;
      w.__sawBubble = false;
      setInterval(() => {
        if (w.__game.scene.getScene('MatchScene').bubbles.some((b: any) => b.visible && b.text === 'Nice goal!')) w.__sawBubble = true;
      }, 20);
    });
  }
  await guestPage.keyboard.press('1');
  await guestPage.keyboard.press('2');
  // The message is a bubble above the guest's controlled player on both screens...
  for (const page of [hostPage, guestPage]) await page.waitForFunction(() => (window as any).__sawBubble, null, { timeout: 30_000 });
  // ...and a line in the feed, with its sender's name; a second message straight after was refused by the rate limit.
  expect(await scene(hostPage, 'MatchScene', 'scene.chatFeed().map((l) => l.name + ": " + l.text)')).toEqual(['bSamb: Nice goal!']);
  expect(await scene(guestPage, 'MatchScene', 'scene.chatFeed().length')).toBe(1); // you see your own message too

  // The host mutes, then the guest says GG: the host does not see it, the guest still does.
  await hostPage.keyboard.press('m');
  await guestPage.waitForTimeout(1400);
  await guestPage.keyboard.press('6');
  await waitScene(guestPage, 'MatchScene', 'scene.chatFeed().some((l) => l.text === "GG")');
  await hostPage.waitForTimeout(800);
  expect(await scene(hostPage, 'MatchScene', 'scene.chatFeed().some((l) => l.text === "GG")')).toBe(false);
  await hostPage.keyboard.press('m');

  // Full time (host wins 2-1): results on both, the series 1-0 to the host, a man of the match and the stat lines.
  await endMatch(hostPage, [2, 1]);
  for (const page of [hostPage, guestPage]) await activeScene(page, 'ResultsScene');
  await waitScene(hostPage, 'ResultsScene', 'scene.series.text.startsWith("Series 1–0")');
  await waitScene(guestPage, 'ResultsScene', 'scene.series.text.startsWith("Series 0–1")');
  for (const page of [hostPage, guestPage]) {
    await waitScene(page, 'ResultsScene', 'scene.statsLayer.list.some((t) => String(t.text).includes("MAN OF THE MATCH"))');
    const lines: string[] = await scene(page, 'ResultsScene', 'scene.statsLayer.list.map((t) => String(t.text))');
    expect(lines.some((l) => l.startsWith('Kev:') && l.includes('2 goals'))).toBe(true);
    expect(lines.some((l) => l.startsWith('bSamb:'))).toBe(true);
  }

  // Rematch (both ask), then the guest wins 0-1: the series is level.
  for (const page of [hostPage, guestPage]) await scene(page, 'ResultsScene', 'scene.rematchBtn.click()');
  for (const page of [hostPage, guestPage]) await waitScene(page, 'MatchScene', 'scene.driver.state.phase === "playing" && !scene.resultsShown', 30_000);
  await endMatch(hostPage, [0, 1]);
  await waitScene(hostPage, 'ResultsScene', 'scene.series.text.startsWith("Series 1–1")');
  await waitScene(guestPage, 'ResultsScene', 'scene.series.text.startsWith("Series 1–1")');

  // Back to the lobby (the guest asks): both land in the lobby, still connected, with the series shown there.
  await scene(guestPage, 'ResultsScene', 'scene.lobbyBtn.click()');
  for (const page of [hostPage, guestPage]) {
    await activeScene(page, 'LobbyScene');
    await waitScene(page, 'LobbyScene', 'scene.seriesLabel.text.startsWith("Series 1–1")');
    expect(await scene(page, 'LobbyScene', 'scene.lobby.view.status')).toBe('connected');
  }

  // Reset the series from the guest's side: both lobbies clear it.
  await scene(guestPage, 'LobbyScene', 'scene.lobby.resetSeries()');
  for (const page of [hostPage, guestPage]) await waitScene(page, 'LobbyScene', 'scene.seriesLabel.text === ""');

  // And a new match from that same lobby works.
  await kickOff(hostPage, guestPage);
  const [h, g] = [await matchState(hostPage), await matchState(guestPage)];
  expect(h.phase).toBe('playing');
  expect(g.phase).toBe('playing');

  expect(errors).toEqual([]);
  await Promise.all([hostPage.context().close(), guestPage.context().close()]);
});

test('T21: a guest that refreshes the page rejoins its room, in the lobby and in a match', async ({ browser }) => {
  const errors: string[] = [];
  const { hostPage, guestPage, code } = await connect(browser, errors, { host: 'Kev', guest: 'Sam' });
  // The room code is now in the guest's address bar.
  expect(new URL(guestPage.url()).searchParams.get('room')).toBe(code);

  // Refresh in the lobby: back in the same room by itself, with the same name.
  await guestPage.reload();
  await waitScene(guestPage, 'LobbyScene', 'scene.lobby?.view.status === "connected"', 45_000);
  await waitScene(hostPage, 'LobbyScene', 'scene.lobby?.view.status === "connected"', 45_000);
  expect(await scene(guestPage, 'LobbyScene', 'scene.lobby.view.code')).toBe(code);
  expect(await scene(hostPage, 'LobbyScene', 'scene.lobby.view.lobby.names')).toEqual(['Kev', 'Sam']);

  // Start a match, then refresh in the middle of it: the guest is put back into the same match.
  await kickOff(hostPage, guestPage);
  await hostPage.waitForTimeout(1500);
  const before = await matchState(hostPage);
  await guestPage.reload();
  await waitScene(guestPage, 'MatchScene', 'scene.driver?.state.phase === "playing" && scene.humanTeam === 1', 45_000);
  // The host's match carries on after the reconnect pause, and both agree again.
  await waitScene(hostPage, 'MatchScene', `scene.driver.state.tick > ${before.tick + 120} && scene.online.view.status === "connected"`, 45_000);
  await waitScene(guestPage, 'MatchScene', 'scene.driver.state.tick > 60', 30_000);
  const [h, g] = [await matchState(hostPage), await matchState(guestPage)];
  expect(g.score).toEqual(h.score);
  expect(Math.abs(g.clock - h.clock)).toBeLessThan(2);

  expect(errors.filter((e) => !/net::ERR|Failed to load resource/.test(e))).toEqual([]);
  await Promise.all([hostPage.context().close(), guestPage.context().close()]);
});

# Browser Football

A top-down, 5-a-side arcade football game that runs in your browser. Each team has four outfield players and a keeper. You control one player at a time, and the AI runs your teammates and the opposition.

**Play now:** https://tightened1.github.io/browser-football/

Nothing to install. Open the link in a desktop browser (Chrome, Edge or Firefox recommended).

## Play with a friend

Online play is peer-to-peer, so you each need the game open in your own browser.

1. **Host.** Open the link and press **Host online**. Pick a Premier League club and its home, away or third kit, then press **Open a room**.
2. **Share.** The lobby shows a room code (for example `PASS-4827`) and a **Copy invite link** button. Send the link to your friend.
3. **Join.** Your friend opens the link. It fills in the room code for them, so they only need to pick a club and press **Join**. Without the link, they can press **Join online** on the title screen and type the room code.
4. **Ready up.** Both of you press **Ready** in the lobby. The lobby shows each other's connection type and ping.
5. **Kick off.** The host presses **Start match**.

After full time, either player can press **Rematch**. The match starts again once you both accept. **Back to lobby** returns you both to the lobby (same room, no new code), and **Menu** takes you back to the title screen.

- **Names.** Type your name in the box on the title screen (up to 16 letters, digits, spaces, `_ - .`; it is saved). It shows in the lobby, under the team names and on the results screen.
- **Clubs and kits.** Pick any of the 20 current Premier League clubs (2026-27) with its real home, away or third kit colours; each club has a fixed squad of five real players (a goalkeeper, two defenders or midfielders and two forwards) with their real shirt numbers. Player names show in the goal banner ("Saka 23'"), the cards, the replays, the penalties, the man of the match and the goal list; you are the "manager" of your side. Clubs are cosmetic: every club plays the same. The two teams' kits can never clash: if the kits (or either goalkeeper's) are too alike, or too close to the grass green, the guest (offline: the AI opponent) is switched to its next kit that works, and the picker and lobby say "Kit changed to avoid a colour clash". Offline you can leave the opponent random or choose one. To refresh the clubs for a new season see [docs/UPDATING_SQUADS.md](docs/UPDATING_SQUADS.md).
- **Quick chat.** Keys `1`–`6` say *Nice goal!*, *Unlucky*, *What a save!*, *Rematch?*, 😂 or *GG*, as a bubble over your player and a line in the feed (there is a short wait between messages). `M` mutes your friend's messages (also under **Settings**).
- **Series.** Rematches in the same room keep a running score ("Series 3–2") on the results screen and in the lobby; **Reset series** clears it.
- **Man of the match** and a stat line for each player (goals, assists, saves, tackles, shots) appear on the results screen.
- **Refreshed the page?** The room code stays in the address bar, so a refresh in the lobby or in a match rejoins by itself (the host holds the match for 30 seconds).

Both players must be running the same version of the game. If you see a "different game versions" message, reload the page (Ctrl+F5, or Cmd+Shift+R on a Mac).

## Controls

| Action | Keys |
|---|---|
| Move | Arrow keys or `W` `A` `S` `D` |
| Pass (tap) / Shoot (hold to charge, release to kick) | `X` / `Space` |
| Finesse shot (Arcade rules): hold shoot, then tap pass | `Space` + `X` |
| Tackle or slide (when you don't have the ball) | `C` |
| Sprint (hold; drains the stamina bar under you) | `Shift` |
| Shield the ball (hold, with the ball) | `V` |
| Feint / drag-back (with the ball) | double-tap a move key |
| Switch player (when you don't have the ball) | `Z` |
| Pause menu / back | `Esc` |
| Skip a replay or the highlights | any other key |
| Network overlay (ping, route, rates) | `F3` or `N` |
| AI debug overlay | `F2` or `` ` `` |

**Running with the ball:** run into a loose ball to take it; it then stays at your feet (you run a little slower). A slide tackle, an opponent in your way, or turning straight back at full speed loses it. Passes and shots go where the move keys point when you kick, so you can run one way and shoot another. Press pass or let go of shoot a moment *before* the ball reaches you and the kick fires as it arrives (an amber ring shows it is waiting; a white flash when it fires).

**Match rules: Arcade or Classic** (Settings, or the team picker; online the host's choice is used and shown in the lobby, where the host can change it). **Arcade** (the default) makes scoring easier: bigger goals, a quicker charge (0.5 s to full power), a dotted aim line while you charge near goal, a mild aim assist (a shot near the goal bends a little towards a corner, never all the way), the finesse shot (curled and placed by a post, but slower, so keepers can get there), keepers that parry more and react a touch later, and the AI defends a human shooter a little more gently. **Classic** is the original game. Settings → Keepers sets the keepers' skill on its own. Tip: the keys aim in 8 directions, so line yourself up — a straight shot from off-centre goes towards the corner.

**Throw-ins, corners and the lines:**
 throw-ins are thrown, not dribbled. Stand still, aim with the move keys (a yellow arrow shows where), then press pass for a short throw or hold and release shoot for a long one. A throw always goes into the pitch, and if you do nothing for 3 seconds it goes to a free teammate. Corners are taken the same way: aim the cross with the arrow, then pass for a low cross or hold and release shoot for a hard one. Goal kicks are kicked as usual, also always into the pitch. You can't dribble the ball over a touchline or goal line: the line holds it and you slide along it, so the ball only goes out if it's kicked, tackled or deflected. If a restart goes straight back out before anyone else touches it, your team takes it again.

**Beating a defender:** an AI defender about to slide in crouches and flashes orange for a moment first, committed to its direction: change direction (or feint) and it slides past. Sprint to get away (the stamina bar empties and refills; with the ball your touches get bigger, so it's easier to lose). Hold shield with the ball to keep it on the far side of your body: you move slowly, but tackles from behind or the side rarely get it. Double-tap a move key to drag the ball across that way and step past. How hard the AI tackles *you* is set by **AI defending vs humans** (Settings: Relaxed / Normal / Tough; Arcade uses Relaxed, Classic Normal); AI players still defend each other at full strength.

**Fouls, free kicks and penalties:** a slide that hits the player instead of the ball, or comes in from behind, is a foul (and so is a clearly late challenge after someone has passed). The referee whistles at once and the fouled team gets a free kick on the spot, taken like a corner: aim with the arrow, pass = pass, hold and release shoot = shot. Near goal the AI puts one or two players in a wall. A foul inside the box is a **penalty**: aim up or down (or neither, for the middle), pass for a placed kick or hold shoot for a power kick. Facing one, you're the keeper: you stay on your line until you dive with up or down + tackle (or stand still to cover the middle). How strict the referee is comes from the match rules (Arcade: Lenient, no cards; Classic: Strict, with cards: a reckless slide is a yellow, two yellows and the player is off for the rest of the half), and Settings can change it (Fouls: Off / Lenient / Strict; Cards: on / off). **A draw** goes to a penalty shoot-out under Arcade (best of five, then sudden death), stays a draw under Classic, or goes to golden-goal extra time first (Settings: A draw).

Move, pass, shoot, tackle, sprint, shield and switch can all be rebound under **Settings** (two keys per action; the controller's buttons under Settings → Controller…). `Esc`, `Enter`, `Tab`, the F-keys, `` ` ``, `N`, `M` and `1`–`6` are reserved. **How to play** on the title screen shows the same table.

In menus, use the arrow keys or the mouse. `Enter` or `Space` selects.

### Xbox / PlayStation controller

Plug in or pair a controller (any browser "standard" gamepad: Xbox, PlayStation, Switch Pro and most others) and press a button once so the browser notices it. It works **alongside the keyboard**; whichever you used last decides the on-screen prompts ("Press A" / "Press ✕" / "Press Enter"). Xbox or PlayStation labels are chosen from the controller's name (Xbox when unsure).

| Action | Xbox | PlayStation |
|---|---|---|
| Move / aim (walk to run by how far you push; set pieces and penalties aim exactly where it points) | Left stick or d-pad | Left stick or d-pad |
| Pass (tap) | A | ✕ |
| Shoot (hold to charge, release) / long throw / hard cross | X | □ |
| Tackle or slide; keeper dive at a penalty (with the stick up / down) | B | ○ |
| Sprint (analogue: counts past the trigger threshold, default 30%) | RT | R2 |
| Shield the ball | LT | L2 |
| Switch player | LB | L1 |
| Feint / drag-back | flick the stick twice | flick the stick twice |
| Quick chat 1–4 (online): hold RB / R1 and press | A B X Y | ✕ ○ □ △ |
| Quick chat 5–6 (online): hold RB / R1 and press | d-pad ↑ ↓ | d-pad ↑ ↓ |
| Mute the other player's chat | RB + View | R1 + Share |
| Pause menu | Menu | Options |
| Skip a replay or the highlights | A B X Y | ✕ ○ □ △ |
| Menus: move / choose / back | d-pad or stick / A / B | d-pad or stick / ✕ / ○ |

Every menu (title, club and kit picker, lobby, settings, pause, results) works with the d-pad or stick, `A`/`✕` and `B`/`○`. The one thing a controller can't do is type a room code on the join screen (use the invite link, or the keyboard). **Settings → Controller…** shows which controller is connected and its type, lets you rebind the six action buttons (picking a button another action uses swaps the two), and sets the stick dead zone, the trigger threshold and vibration. Vibration (kicks, your slides, goals, your keeper's saves) works where the browser supports it (Chrome and Edge) and can be turned off. If the controller is unplugged mid-match, an offline match pauses with a notice; online, the match carries on and you play with the keyboard.

**Replays and highlights:** after a goal you see it again — the build-up, the last second in slow motion, with the camera following the ball — before the kickoff (the match clock waits). Press any key to skip it; online, either player skipping ends it for both of you, since the kickoff waits for it. At full time every goal of the match (and the big saves) plays as a highlights reel before the results; each player watches and skips their own. Settings → Replays: Off / Goals only / Goals + full-time highlights (online, the host's setting decides whether goal replays happen, and a guest with replays off skips them).

**Online pause:** pressing `Esc` in an online match opens the menu, but the match keeps running for your friend. Only offline matches freeze.

## Troubleshooting connection problems

Online play connects directly between the two browsers, with a relay used when a direct route is blocked. If you can't connect:

- **Run the test first.** On the title screen, press **Test my connection**. Both players should run it. **Copy report** gives you a text summary to send to each other, without IP addresses.
- **Check the route.** The lobby shows **Direct** or **Relayed** for each player. Relayed still plays fine, but it may add a little lag.
- **Corporate, school or hotel networks** often block direct connections. Try a phone hotspot for one of you.
- **"Room not found"** usually means the host has left the lobby or the code was mistyped. Check the code, or ask the host to open a new room.
- **"Can't reach the matchmaking server"** means the game's public signalling service is unreachable from your network. Try another network, then run the connection test.
- **Disconnected during a match?** The game pauses for both players and waits about 30 seconds for the other player to reconnect. After that the match ends.

The full network test checklist, and how the TURN relay is set up, are in [docs/NETWORK_TESTING.md](docs/NETWORK_TESTING.md).

## Run it locally

You need [Node.js](https://nodejs.org/) 24 or newer.

```bash
npm install
npm run dev
```

Then open the address Vite prints (usually http://localhost:5173/).

Other useful commands:

```bash
npm test          # run the simulation and network unit tests (more under Tests below)
npm run build     # type-check and build the site into dist/
npm run simulate  # play AI-vs-AI matches headlessly and print the stats
```

## Tests

Every push and pull request runs these in GitHub Actions (`.github/workflows/deploy.yml`); a push to `main` deploys only if all of them pass.

```bash
npm test            # Vitest: sim rules, AI, network protocol/snapshot round trips, determinism (~20 s)
npm run test:sim    # sim regression: 8 fixed-seed AI-vs-AI matches each for Arcade and Classic; fails if an average is outside scripts/simRanges.json (~25 s)
npm run build       # type-check and build (this is also a CI check)
npm run test:e2e    # two-browser online tests with Playwright (headless Chromium): a synchronised match, a penalty, names/chat/series/MVP, and a guest refresh
npm run test:all    # all of the above
```

- **Sim regression ranges** live in one file, [`scripts/simRanges.json`](scripts/simRanges.json): goals, shots, corners, throw-ins, stuck-ball and dead-ball episodes, longest still spell. Each is the allowed range for the average per match. When you change balance on purpose, run `npm run simulate -- --matches 8 --seed 1 --difficulty normal --rules arcade` (and `classic`) and move the ranges. The check prints every stat with `ok` or `FAIL`.
- **Determinism** (`tests/determinism.test.ts`): the same seed and inputs give an identical final state, and a whole match runs with `Math.random`, `Date.now` and `performance.now` made to throw, so any use of them in `src/sim/` fails the test.
- **Protocol** (`tests/protocol.test.ts`, `tests/snapshot.test.ts`): one sample of every message type goes through the wire format and back (a new message type without a sample fails to compile); snapshot and input packets round-trip, including through the base64 fallback.
- **Online smoke test** (`e2e/online.spec.ts`): two browser contexts, host on one and join by room code on the other, start, press keys on both, then check the score and clock match and there are no console errors. First time only: `npx playwright install chromium`. It takes a minute or two on a slow machine, because the pages render in software.
  - It runs against a **local PeerJS server** (dev dependency `peer`, `scripts/peerServer.mjs`, started by `playwright.config.ts`) rather than the public broker, so CI does not depend on a shared service. The test build is made with `vite build --mode e2e`, which reads [`.env.e2e`](.env.e2e): `VITE_PEER_HOST` / `VITE_PEER_PORT` / `VITE_PEER_PATH` / `VITE_PEER_SECURE` point the game at that server, `VITE_STUN_URLS=` (empty) turns STUN off, and `VITE_E2E=1` exposes `window.__game` for the test. Normal builds ignore all of these and use the public broker. To use another port, change `PEER_PORT` and `VITE_PEER_PORT` together (`E2E_PORT` changes the preview port).
  - It starts matches by opening the lobby scene directly, so the menu buttons themselves are not clicked.
  - On failure Playwright keeps a trace in `test-results/` (CI uploads it): `npx playwright show-trace <trace.zip>`.

To test online play on one computer, open two browser windows. Use one as the host and the invite link in the other. The URL option `?lag=50&jitter=10&loss=0.03` simulates a poor connection.

To set up a TURN relay, copy `.env.example` to `.env.local` and fill it in. See [docs/NETWORK_TESTING.md](docs/NETWORK_TESTING.md).

## How it's built

TypeScript, Vite and Phaser 3 for drawing and input. Online play uses PeerJS (WebRTC) with the host running the authoritative match. The game logic in `src/sim/` is pure TypeScript, with no Phaser or network code. The site deploys to GitHub Pages on every push to `main`.

Sound effects are synthesised in the browser, so there are no audio files. Credits are in [docs/CREDITS.md](docs/CREDITS.md).

> Unofficial fan game, not affiliated with the Premier League or any club. Club and player names are used for identification only; there are no crests, badges, logos or sponsor names, just colours and text.

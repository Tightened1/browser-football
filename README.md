# Browser Football

A top-down, 5-a-side arcade football game that runs in your browser. Each team has four outfield players and a keeper. You control one player at a time, and the AI runs your teammates and the opposition.

**Play now:** https://tightened1.github.io/browser-football/

Nothing to install. Open the link in a desktop browser (Chrome, Edge or Firefox recommended).

## Play with a friend

Online play is peer-to-peer, so you each need the game open in your own browser.

1. **Host.** Open the link and press **Host online**. Pick your team name and kit colour, then press **Open a room**.
2. **Share.** The lobby shows a room code (for example `PASS-4827`) and a **Copy invite link** button. Send the link to your friend.
3. **Join.** Your friend opens the link. It fills in the room code for them, so they only need to pick a team and press **Join**. Without the link, they can press **Join online** on the title screen and type the room code.
4. **Ready up.** Both of you press **Ready** in the lobby. The lobby shows each other's connection type and ping.
5. **Kick off.** The host presses **Start match**.

After full time, either player can press **Rematch**. The match starts again once you both accept. **Menu** takes you back to the title screen.

Both players must be running the same version of the game. If you see a "different game versions" message, reload the page (Ctrl+F5, or Cmd+Shift+R on a Mac).

## Controls

| Action | Keys |
|---|---|
| Move | Arrow keys or `W` `A` `S` `D` |
| Pass (tap) / Shoot (hold to charge, release to kick) | `X` / `Space` |
| Tackle or slide (when you don't have the ball) | `C` |
| Switch player (when you don't have the ball) | `Z` or `Shift` |
| Pause menu / back | `Esc` |
| Network overlay (ping, route, rates) | `F3` or `N` |
| AI debug overlay | `F2` or `` ` `` |

**Running with the ball:** run into a loose ball to take it; it then stays at your feet (you run a little slower). A slide tackle, an opponent in your way, or turning straight back at full speed loses it. Passes and shots go where the move keys point when you kick, so you can run one way and shoot another. Press pass or let go of shoot a moment *before* the ball reaches you and the kick fires as it arrives (an amber ring shows it is waiting; a white flash when it fires).

**Throw-ins and the lines:** throw-ins are thrown, not dribbled. Stand still, aim with the move keys (a yellow arrow shows where), then press pass for a short throw or hold and release shoot for a long one. A throw always goes into the pitch, and if you do nothing for 3 seconds it goes to a free teammate. Corners and goal kicks are kicked as usual, also always into the pitch. You can't dribble the ball over a touchline or goal line: the line holds it and you slide along it, so the ball only goes out if it's kicked, tackled or deflected. If a restart goes straight back out before anyone else touches it, your team takes it again.

Move, pass, shoot, tackle and switch can all be rebound under **Settings** (two keys per action). `Esc`, `Enter`, `Tab`, the F-keys, `` ` `` and `N` are reserved. **How to play** on the title screen shows the same table.

In menus, use the arrow keys or the mouse. `Enter` or `Space` selects.

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
npm test          # run the simulation and network unit tests
npm run build     # type-check and build the site into dist/
npm run simulate  # play AI-vs-AI matches headlessly and print the stats
```

To test online play on one computer, open two browser windows. Use one as the host and the invite link in the other. The URL option `?lag=50&jitter=10&loss=0.03` simulates a poor connection.

To set up a TURN relay, copy `.env.example` to `.env.local` and fill it in. See [docs/NETWORK_TESTING.md](docs/NETWORK_TESTING.md).

## How it's built

TypeScript, Vite and Phaser 3 for drawing and input. Online play uses PeerJS (WebRTC) with the host running the authoritative match. The game logic in `src/sim/` is pure TypeScript, with no Phaser or network code. The site deploys to GitHub Pages on every push to `main`.

Sound effects are synthesised in the browser, so there are no audio files. Credits are in [docs/CREDITS.md](docs/CREDITS.md).

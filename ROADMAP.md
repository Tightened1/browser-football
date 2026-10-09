# Browser Football â€” Roadmap & Task Queue

An online, top-down arcade football game that runs in the browser. Two players in different places each control one team (one human player at a time, with switching); AI controls the teammates and nothing needs installing â€” share a link and a room code.

---

## 1. Decisions (locked in for v1)

| Topic | Decision | Notes |
|---|---|---|
| Play mode | Online, two players in different locations | Host + Join by room code |
| Style | 2D top-down arcade (Sensible Soccer / Haxball feel) | |
| Teams | **5-a-side** (4 outfield + keeper), 1 human per team, AI teammates | Human controls one player, can switch |
| Controls | Desktop keyboard only | Gamepad/mobile are backlog |
| Match length | 2 Ã— 3-minute halves (configurable) | |
| Art | Simple shapes first (coloured circles, line-drawn pitch) | Sprites are backlog |
| Language / tooling | TypeScript + Vite | `npm run dev` / `npm run build` |
| Rendering | Phaser 3 (rendering, input, scenes only) | |
| Physics / game logic | **Custom pure-TypeScript simulation** (no Phaser physics) | Keeps logic network-friendly and testable |
| Networking | PeerJS (WebRTC peer-to-peer), **host-authoritative** | Free public PeerJS broker for signalling |
| Hosting | **GitHub Pages**, auto-deployed by GitHub Actions | If P2P fails on some networks, add TURN relay or switch to a Node/Socket.io server later |
| Testing | Vitest for simulation logic | |

> Things can change later. If something doesn't work, we update this table and add a task.

---

## 2. Architecture (all tasks must follow this)

```
src/
  main.ts              Phaser game bootstrap
  config.ts            All tunable constants (pitch size, speeds, friction, match lengthâ€¦)
  sim/                 PURE TypeScript â€” no Phaser, no DOM, no network imports
    types.ts           GameState, PlayerState, BallState, InputFrameâ€¦
    physics.ts         Circle movement, friction, collisions, wall bounces
    simulation.ts      step(state, inputs, dt) -> state   (the whole game advances here)
    rules.ts           Goals, kickoff, out of play, timer, halves
    ai.ts              AI decisions -> produces InputFrames for AI-controlled players
  render/              Phaser scenes that DRAW a GameState (never change it)
    MatchScene.ts
    MenuScene.ts / LobbyScene.ts / HudScene.ts
  input/
    keyboard.ts        Keyboard -> InputFrame
  net/
    peer.ts            PeerJS connection, room codes
    protocol.ts        Message types (input, snapshot, events)
    host.ts            Runs the sim, broadcasts snapshots
    client.ts          Sends inputs, interpolates snapshots
tests/                 Vitest tests for sim/
```

**Golden rules**
1. `sim/` is pure: `step(state, inputs, dt)` is the only way the game advances. Fixed timestep (60 Hz).
2. Rendering only reads state. Input only produces `InputFrame`s.
3. Offline play = local host with no remote peer. Online play = the same sim on the host, inputs from the remote peer.
4. All magic numbers live in `config.ts`.

**Controls (default)**

| Action | Key |
|---|---|
| Move | Arrow keys (also WASD) |
| Pass (tap) / Shoot (hold to charge, release) | `X` / `Space` |
| Tackle / slide (no ball) | `C` |
| Switch player (no ball) | `Z` / `Shift` |

---

## 3. Roadmap (milestones)

| Milestone | Outcome | Tasks |
|---|---|---|
| **M0 â€” Foundations** | Project builds, deploys to GitHub Pages, blank pitch on the live URL | T00 |
| **M1 â€” Playable offline** | Kick a ball around, score goals, full 5-a-side match vs AI on one computer | T01â€“T05 |
| **M2 â€” Online multiplayer** | Two browsers in different places play a full match via room code | T06â€“T08 |
| **M3 â€” Game feel** | Menus, sound, celebrations, tuned gameplay | T09â€“T11 |
| **M4 â€” Release** | Polished public link, README, how-to-play | T12 |
| **Backlog** | Sprites, gamepad, mobile, 2v2 humans, rematch stats | B01+ |

---

## 4. Task Queue

Status key: `[ ]` todo Â· `[~]` in progress Â· `[x]` done Â· `[!]` blocked

| # | Task | Depends on | Model | Status |
|---|---|---|---|---|
| T00 | Project setup, GitHub repo & Pages deploy | â€” | Sonnet 5.5 | [x] |
| T01 | Pitch, ball & core physics | T00 | Sonnet 5.5 | [x] |
| T02 | Player control: move, dribble, pass, shoot, tackle | T01 | Sonnet 5.5 | [ ] |
| T03 | Teams, keepers & player switching | T02 | Sonnet 5.5 | [ ] |
| T04 | AI teammates & opponents | T03 | **Opus 5.5** | [ ] |
| T05 | Match rules: kickoff, goals, out of play, timer, HUD | T03 | Sonnet 5.5 | [ ] |
| T06 | Networking: PeerJS host/join lobby with room codes | T05 | **Opus 5.5** | [ ] |
| T07 | Netcode: input sending, snapshots, interpolation, disconnects | T06 | **Opus 5.5** | [ ] |
| T08 | Real-world network test & TURN fallback | T07 | **Opus 5.5** | [ ] |
| T09 | Menus & game flow (title, host/join, settings, results) | T07 | Sonnet 5.5 | [ ] |
| T10 | Juice & audio: sounds, goal celebration, team colours, camera | T05 | Sonnet 5.5 | [ ] |
| T11 | Playtest & gameplay tuning | T04, T10 | Sonnet 5.5 | [ ] |
| T12 | Release: README, how-to-play, final deploy | T11, T08, T09 | Haiku 5.5 | [ ] |

### Which model, and why

- **Opus 5.5** â€” the hardest problems: AI behaviour (T04), networking and netcode (T06â€“T08). These have tricky timing and design trade-offs, and bugs that are hard to track down, so the strongest reasoning is worth the cost.
- **Sonnet 5.5** â€” standard feature work with a clear spec: setup, physics, controls, rules, UI, audio, tuning. Fast and very capable for well-defined coding.
- **Haiku 5.5** â€” simple, low-risk jobs: docs, README, final deploy checks. Cheapest and quickest.
- If a Sonnet task gets stuck on the same bug twice, re-run it with Opus.

### How to run a task
1. Start a **fresh agent session** in `C:\Projects\Game` and pick the model listed.
2. Paste the task's prompt (below) as-is.
3. When it's done, test it yourself (the "Done when" list), then check the agent marked it `[x]` and pushed.
4. Move to the next task in the queue.

---

## 5. Task Prompts

### T00 â€” Project setup, GitHub repo & Pages deploy
**Model:** Sonnet 5.5

```text
You are working on a browser football game in C:\Projects\Game. Read ROADMAP.md first â€” it holds the locked decisions, the architecture and the task queue. You are doing task T00.

Goal: set up the project skeleton and get it auto-deploying to GitHub Pages.

Do the following:
1. Scaffold a Vite + TypeScript project in the current folder (do not create a subfolder). Add Phaser 3 as a dependency and Vitest as a dev dependency. Scripts: dev, build, preview, test.
2. Create the folder structure exactly as described in ROADMAP.md section 2 (sim/, render/, input/, net/, tests/), with minimal placeholder files where sensible. Create config.ts with initial constants (pitch size, match length 2x3 min, 60 Hz timestep).
3. main.ts boots Phaser with a MatchScene that draws a green pitch with white lines (halfway line, centre circle, penalty boxes, two goals). It must scale to fit the browser window, keeping the aspect ratio.
4. Set Vite's `base` so the app works when served from https://<user>.github.io/<repo>/.
5. Add a GitHub Actions workflow that builds the site and deploys it to GitHub Pages on every push to main.
6. Add a .gitignore, initialise git, and make the first commit.
7. Create the GitHub repo and push: if the `gh` CLI is installed and authenticated, create a public repo named "browser-football" and push, then enable Pages (source: GitHub Actions). If gh isn't available or authenticated, stop and give me exact step-by-step instructions to do it myself.
8. Add one trivial Vitest test so `npm test` passes.

Done when: `npm run dev` shows the pitch locally, `npm run build` and `npm test` pass, and the live GitHub Pages URL shows the pitch. Tell me the live URL.
Finally, mark T00 as [x] in the ROADMAP.md task queue, commit and push.
```

---

### T01 â€” Pitch, ball & core physics
**Model:** Sonnet 5.5

```text
You are working on a browser football game in C:\Projects\Game. Read ROADMAP.md first â€” follow the architecture and golden rules exactly. You are doing task T01.

Goal: a ball that moves realistically on the pitch, simulated in pure TypeScript.

Do the following:
1. In sim/types.ts define GameState, BallState (position, velocity, height/z for lofted balls is optional â€” keep it 2D for now), PlayerState and InputFrame. Design these to be serialisable to JSON (needed later for networking).
2. In sim/physics.ts implement: circle movement with velocity, rolling friction, max speed caps, ball bouncing off the pitch boundary (with some energy loss), and circle-vs-circle collision helpers (for players later).
3. Goals: the goal mouths must be openings in the boundary â€” the ball can go into the goal area and bounces off the goal net/back walls and posts (treat posts as small circles).
4. In sim/simulation.ts implement step(state, inputs, dt) using a fixed 60 Hz timestep. Rendering in MatchScene reads the state and draws it (it must not change state).
5. Temporary debug control: clicking on the pitch kicks the ball towards the click point, so physics can be tested by hand.
6. All tunables (friction, restitution, ball radius, etc.) go in config.ts.
7. Vitest tests: ball slows to a stop under friction; ball bounces off walls; ball can enter the goal area; step is deterministic for the same inputs.

Done when: in `npm run dev` I can click to kick the ball around, it slows naturally, bounces off walls and posts, and can go into the goals. All tests pass.
Finally, mark T01 as [x] in the ROADMAP.md task queue, commit and push.
```

---

### T02 â€” Player control: move, dribble, pass, shoot, tackle
**Model:** Sonnet 5.5

```text
You are working on a browser football game in C:\Projects\Game. Read ROADMAP.md first â€” follow the architecture, golden rules and controls table exactly. You are doing task T02.

Goal: one keyboard-controlled player who feels good to play.

Do the following:
1. input/keyboard.ts turns key presses into an InputFrame (move direction as a normalised vector, plus pass, shoot and tackle/switch button states). Support arrows and WASD.
2. Add one player to the state. Movement with acceleration/deceleration (not instant), max speed, and player-vs-ball and player-vs-wall collisions.
3. Dribbling: when the player touches the ball while moving, the ball is nudged ahead of them, so it stays close but can be lost. Don't glue the ball to the player.
4. Pass: tap pass/shoot â†’ a medium-power kick in the facing direction. Shoot: hold to charge (show a small power bar near the player), release to kick harder. Cap the charge time.
5. Tackle: pressing tackle without the ball does a short dash/slide in the facing direction with a cooldown; it knocks the ball away if it hits it.
6. Remove the click-to-kick debug control (or hide it behind a debug flag in config.ts).
7. Draw the player as a coloured circle with a facing indicator.
8. Vitest tests for the inputâ†’movement and kick logic in sim/.

Done when: I can run around, dribble, pass, charge a shot into the goal and slide-tackle the ball, and it feels responsive. Tests pass.
Finally, mark T02 as [x] in the ROADMAP.md task queue, commit and push.
```

---

### T03 â€” Teams, keepers & player switching
**Model:** Sonnet 5.5

```text
You are working on a browser football game in C:\Projects\Game. Read ROADMAP.md first â€” follow the architecture and golden rules exactly. You are doing task T03.

Goal: two full 5-a-side teams on the pitch, with the human controlling one player at a time.

Do the following:
1. Two teams (home/away) of 5: 1 goalkeeper + 4 outfield players, with distinct colours and a starting formation (e.g. 2-2). Each team defends one goal.
2. The state tracks which player each human controls per team (one controlled player per team). Show a marker/ring and number above the controlled player.
3. Switching: pressing switch when not in possession moves control to the teammate best placed to reach the ball (closest, with a bias towards players between the ball and your own goal). Also auto-switch when a pass is received by a teammate.
4. Playerâ€“player collisions (soft pushing, no overlap).
5. Uncontrolled players for now simply return to/hold their formation position, shifted by where the ball is (basic positioning â€” full AI comes in T04). Keep this logic in sim/ai.ts so T04 can build on it.
6. Goalkeepers: for now they stay on their goal line and track the ball's position side-to-side. The keeper can catch or block the ball when touching it.
7. For offline testing, the second team has no human: all its players use the basic positioning.
8. Tests for the switching choice and collisions.

Done when: I see two full teams, can switch players with the switch key, pass to teammates and have control follow the ball, and the keepers block shots.
Finally, mark T03 as [x] in the ROADMAP.md task queue, commit and push.
```

---

### T04 â€” AI teammates & opponents
**Model:** Opus 5.5

```text
You are working on a browser football game in C:\Projects\Game. Read ROADMAP.md first â€” follow the architecture and golden rules exactly. In particular, the AI must live in sim/ai.ts, be pure TypeScript, and output InputFrames, the same as a human would (no cheating by moving players directly). You are doing task T04.

Goal: AI good enough that a match against an all-AI team is fun, and AI teammates help the human.

Design and implement:
1. A simple, readable role/state-based AI (no machine learning). Team states: attacking, defending, transitioning. Player roles: keeper, defender, attacker.
2. Off the ball: positions shift with the ball and the team state; attackers find space and make runs, defenders mark and stay goal-side. Avoid all players bunching on the ball â€” at most 1â€“2 players press.
3. On the ball (AI player in possession): choose between dribbling, passing to an open teammate (check the passing lane for opponents) and shooting (based on distance/angle to goal). Add a small reaction delay and aiming error so it's beatable.
4. Pressing/tackling: the nearest defender closes down the ball carrier and tackles when in range.
5. Goalkeeper: positions on the angle between the ball and the goal centre, comes out for close balls, dives for shots (a short burst of movement), and after a save distributes the ball to a teammate.
6. Difficulty setting in config.ts (easy/normal/hard) controlling reaction time, aiming error and speed.
7. The AI must run efficiently (5â€“10 players at 60 Hz) and deterministically given the same state (use a seeded random number generator stored in the state, not Math.random), so it works on the network host later.
8. A debug overlay (toggle with a key) showing each AI player's current role and intent.
9. Tests for key decisions (e.g. shoots when clear in front of goal, passes when pressured with an open teammate).

Done when: an AI vs AI match (add a config flag for it) looks like football â€” passing, shooting, tackling, keepers saving â€” and I can play a fun match against the AI.
Explain the AI design briefly at the end of your reply. Finally, mark T04 as [x] in the ROADMAP.md task queue, commit and push.
```

---

### T05 â€” Match rules: kickoff, goals, out of play, timer, HUD
**Model:** Sonnet 5.5

```text
You are working on a browser football game in C:\Projects\Game. Read ROADMAP.md first â€” follow the architecture and golden rules exactly. All rule logic goes in sim/rules.ts. You are doing task T05.

Goal: a complete match from kickoff to full time.

Do the following:
1. Match phases in the state: pre-kickoff, playing, goal-scored (short pause), half-time, full-time.
2. Kickoff: teams reset to formation in their own halves; the kicking-off team takes it from the centre spot. Kickoff alternates after each goal (the conceding team kicks off) and at the start of the second half.
3. Goal detection when the whole ball crosses the goal line between the posts. Update the score, pause ~2 seconds, then kickoff.
4. Out of play (keep it arcade): ball over a sideline â†’ throw-in, quickly placed for the other team. Over a goal line â†’ goal kick or corner as appropriate. Keep restarts fast (auto-restart after about 1 second if the human doesn't act).
5. Match timer: 2 halves of the length in config.ts; teams swap ends at half-time; full-time screen showing the final score and "Play again".
6. HUD scene: score, team names/colours, match clock, half indicator, and a "GOAL!" banner.
7. Every event (goal, half-time, etc.) also goes into a list of events in the state, so sounds and networking can react to them later.
8. Tests for goal detection, kickoff alternation, restarts and timer/half transitions.

Done when: I can play a full 2-half match against the AI with correct scoring, restarts, half-time, swapping ends and a full-time result.
Finally, mark T05 as [x] in the ROADMAP.md task queue, commit and push.
```

---

### T06 â€” Networking: PeerJS host/join lobby with room codes
**Model:** Opus 5.5

```text
You are working on a browser football game in C:\Projects\Game. Read ROADMAP.md first â€” follow the architecture and golden rules exactly. Networking code lives in net/. You are doing task T06.

Goal: two browsers in different places can connect by room code. (Syncing gameplay is T07 â€” this task is the connection and lobby only.)

Do the following:
1. Add PeerJS. Use the free public PeerJS cloud broker for signalling. Put ICE/STUN server config in config.ts (Google public STUN for now; leave a clearly marked place for TURN servers, which come in T08).
2. Host flow: "Host game" creates a peer with an ID derived from a short, readable room code (e.g. KICK-4821, avoiding ambiguous characters) and shows the code with a "copy invite link" button. The link is the GitHub Pages URL with ?room=CODE.
3. Join flow: "Join game" with a code input; opening an invite link auto-fills it and joins.
4. net/protocol.ts: typed, versioned message definitions (hello/handshake with game version, ready, ping/pong, and placeholders for input/snapshot/event). Reject a mismatched version with a clear message.
5. Lobby scene: shows both players, connection status, measured ping, and team choice (host = home by default). The host can start the match when both are ready.
6. Clear error handling: room not found, host left, connection failed (with a hint that a corporate network may block it), timeouts.
7. Keep the offline mode working ("Play vs AI").
8. Explain how I can test this on one computer (two browser windows) and with a friend.

Done when: on the live GitHub Pages site, I can host in one browser, join from another (including a different device/network), see each other in the lobby with ping, and the host can press Start (for now this can just start the same offline match on both).
Finally, mark T06 as [x] in the ROADMAP.md task queue, commit and push.
```

---

### T07 â€” Netcode: input sending, snapshots, interpolation, disconnects
**Model:** Opus 5.5

```text
You are working on a browser football game in C:\Projects\Game. Read ROADMAP.md first â€” follow the architecture and golden rules exactly. T06 (PeerJS lobby) is done. You are doing task T07.

Goal: a smooth, fair online match using the host-authoritative model.

Design and implement:
1. Host: runs the only authoritative simulation at 60 Hz. Each tick it applies its own local input, the latest remote input for the away team's controlled player, and the AI inputs.
2. Client: sends its InputFrame to the host every tick (or on change plus a regular heartbeat), using sequence numbers. Choose and justify reliable vs unreliable PeerJS data channels for each message type.
3. Snapshots: the host broadcasts a compact snapshot 20â€“30 times a second (positions, velocities, ball, score, clock, phase, controlled players, recent events). Keep it small (round numbers, short keys or binary packing) â€” measure and report the bytes per snapshot.
4. Client rendering: buffer snapshots and interpolate about 100 ms behind, so movement is smooth. Add light client-side prediction for the client's own controlled player only if it clearly improves feel; keep the reconciliation simple.
5. Events (goal, whistle, etc.) are delivered reliably and exactly once, so sounds and banners fire on both screens.
6. Disconnects: pause the match with an overlay, allow reconnecting to the same room within ~30 s, otherwise end the match. Handle the host leaving.
7. A network debug overlay (toggle key): ping, snapshot rate, buffer size, packet loss estimate.
8. A "simulated latency/loss" option in config.ts for testing on one machine.
9. Tests for snapshot encode/decode and interpolation maths.

Done when: two browsers can play a full online match that feels smooth at around 100 ms ping, goals and the clock match on both screens, and a dropped connection is handled gracefully.
Explain the netcode design briefly at the end of your reply. Finally, mark T07 as [x] in the ROADMAP.md task queue, commit and push.
```

---

### T08 â€” Real-world network test & TURN fallback
**Model:** Opus 5.5

```text
You are working on a browser football game in C:\Projects\Game. Read ROADMAP.md first. Online play (T06, T07) is done. You are doing task T08.

Goal: make sure online play works across real networks, including restrictive ones (like corporate networks), and fails clearly if not.

Do the following:
1. Add a connection diagnostics screen (reachable from the menu) that checks: whether the PeerJS broker is reachable, which ICE candidates are found (host/srflx/relay), and whether a direct or relayed connection was made. Show plain-English results.
2. Add TURN relay support configured in config.ts, using a free TURN option (e.g. Metered or Cloudflare free tier). Research the current free options and setup steps and tell me exactly what account/keys I need to create â€” do NOT sign up for anything or enter credentials yourself. Since this is a static site, explain the trade-offs of putting TURN credentials in client code and recommend the safest practical approach.
3. Make it fall back to the relay automatically when a direct connection fails, and show in the lobby whether the connection is "Direct" or "Relayed".
4. Write a short test checklist in docs/NETWORK_TESTING.md: same machine, same Wi-Fi, different networks (e.g. phone hotspot), corporate network.
5. If P2P turns out to be fundamentally unreliable for us, write up (do not build) what switching to a small Node.js/Socket.io relay server would involve, as a fallback option for the roadmap.

Done when: the diagnostics screen works, TURN is configured (once I've added keys), and I've been given a clear checklist to test with a friend.
Finally, mark T08 as [x] in the ROADMAP.md task queue (or [!] with a note if it's blocked on me creating an account), commit and push.
```

---

### T09 â€” Menus & game flow
**Model:** Sonnet 5.5

```text
You are working on a browser football game in C:\Projects\Game. Read ROADMAP.md first â€” follow the architecture. You are doing task T09.

Goal: a clean, complete flow through the game.

Do the following:
1. Title screen: game name, "Play vs AI", "Host online", "Join online", "Settings", "How to play".
2. Settings (saved to localStorage, wrapped in try/catch): match length, AI difficulty, sound volume, show controls overlay, and key rebinding for the main actions.
3. How-to-play screen with the controls table from ROADMAP.md.
4. Team picker before a match: team name and kit colour from a preset list (online: each player picks their own, and clashing colours are prevented).
5. Pause menu (offline: pauses the game; online: either player can call a short pause, or it just shows the menu without pausing â€” choose sensibly and explain). Includes "Resume", "Quit to menu".
6. Results screen: final score, simple stats (shots, possession %, goals with times), "Rematch" (online: both must accept) and "Menu".
7. Keyboard navigable throughout, plus mouse. Consistent, simple visual style.

Done when: I can go from the title screen through a full offline or online match and back again without refreshing the page.
Finally, mark T09 as [x] in the ROADMAP.md task queue, commit and push.
```

---

### T10 â€” Juice & audio
**Model:** Sonnet 5.5

```text
You are working on a browser football game in C:\Projects\Game. Read ROADMAP.md first â€” follow the architecture (render/audio react to state and events only and never change the sim). You are doing task T10.

Goal: make the game feel alive.

Do the following:
1. Sound effects: kick (soft/hard by power), bounce off a post, whistle (kickoff/half/full time), crowd ambience, a crowd roar on goals. Generate them with the Web Audio API or use free CC0 sounds â€” list the source and licence of each one in docs/CREDITS.md.
2. Audio starts after the first user interaction (browser autoplay rules), and respects the volume setting.
3. Visuals: a ball shadow and slight scaling for hard shots, kick dust particles, a net ripple when a goal goes in, a "GOAL!" celebration with a brief slow-motion or screen shake (kept light), player shirt numbers.
4. Camera: if the pitch is bigger than the screen, follow the ball smoothly with look-ahead; otherwise keep it static. Make it configurable.
5. Pitch: a striped grass pattern and nicer goal nets â€” still drawn with code, no sprites needed.
6. Make sure all of this works identically for the online client (driven by snapshots and events).

Done when: a match has satisfying sound and visual feedback and still runs at 60 fps.
Finally, mark T10 as [x] in the ROADMAP.md task queue, commit and push.
```

---

### T11 â€” Playtest & gameplay tuning
**Model:** Sonnet 5.5

```text
You are working on a browser football game in C:\Projects\Game. Read ROADMAP.md first. All core features exist. You are doing task T11.

Goal: make matches fun and balanced.

Do the following:
1. Run AI-vs-AI matches headlessly (a script using the pure sim/ code, no Phaser) for many matches at each difficulty, and report: average goals per match, shots, possession split, and how often the ball goes out of play or play gets stuck. Add this as an `npm run simulate` script.
2. Targets: about 3â€“6 goals per 6-minute match at normal difficulty, no stalemates (ball stuck against a wall or players), keepers save some but not all shots.
3. Tune config.ts values (speeds, friction, kick power, tackle cooldown, AI reaction) to hit the targets. Report the before/after numbers.
4. Fix any exploits you find (e.g. an unstoppable shot angle, tackle spam, the keeper getting stuck).
5. Write docs/PLAYTEST_NOTES.md: what you changed and why, plus a short list of things for me to feel-test by hand (e.g. "does a charged shot feel powerful enough?").

Done when: the simulation stats are within the targets and I have a list of things to feel-test.
Finally, mark T11 as [x] in the ROADMAP.md task queue, commit and push.
```

---

### T12 â€” Release: README, how-to-play, final deploy
**Model:** Haiku 5.5

```text
You are working on a browser football game in C:\Projects\Game. Read ROADMAP.md first. You are doing task T12, the release.

Do the following:
1. Write README.md: what the game is, the live GitHub Pages link, how to play with a friend (host â†’ share link â†’ join), controls, troubleshooting connection problems (link to docs/NETWORK_TESTING.md), and how to run it locally (npm install, npm run dev).
2. Add the page title, favicon and meta description/social preview tags in index.html.
3. Run `npm test` and `npm run build` and fix only trivial problems; report anything bigger instead of fixing it.
4. Check the GitHub Actions deploy succeeded and the live site loads.
5. Tag the release v1.0.0.

Done when: the live link works and the README explains everything a friend needs.
Finally, mark T12 as [x] in the ROADMAP.md task queue, commit, push and give me the link to share.
```

---

## 6. Backlog (after v1)

| # | Idea | Suggested model |
|---|---|---|
| B01 | Pixel-art sprites & animations for players | Sonnet 5.5 |
| B02 | Gamepad support (browser Gamepad API) | Sonnet 5.5 |
| B03 | Mobile touch controls (virtual joystick) | Sonnet 5.5 |
| B04 | 2v2 humans online (more peers, more controlled players per team) | Opus 5.5 |
| B05 | Switch to a Node/Socket.io server if P2P is unreliable | Opus 5.5 |
| B06 | Penalty shoot-out after a draw | Sonnet 5.5 |
| B07 | Replays of goals (record snapshots) | Opus 5.5 |

---

## 7. Change log
- 2026-10-09 â€” Roadmap created. Decisions: online 1v1 with AI teammates, top-down, keyboard, GitHub Pages.

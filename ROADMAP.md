# Browser Football — Roadmap & Task Queue

An online, top-down arcade football game that runs in the browser. Two players in different places each control one team (one human player at a time, with switching); AI controls the teammates and nothing needs installing — share a link and a room code.

---

## 1. Decisions (locked in for v1)

| Topic | Decision | Notes |
|---|---|---|
| Play mode | Online, two players in different locations | Host + Join by room code |
| Style | 2D top-down arcade (Sensible Soccer / Haxball feel) | |
| Teams | **5-a-side** (4 outfield + keeper), 1 human per team, AI teammates | Human controls one player, can switch |
| Controls | Desktop keyboard only | Gamepad/mobile are backlog |
| Match length | 2 × 3-minute halves (configurable) | |
| Art | Simple shapes first (coloured circles, line-drawn pitch) | Sprites are backlog |
| Language / tooling | TypeScript + Vite | `npm run dev` / `npm run build` |
| Rendering | Phaser 3 (rendering, input, scenes only) | |
| Physics / game logic | **Custom pure-TypeScript simulation** (no Phaser physics) | Keeps logic network-friendly and testable |
| Networking | PeerJS (WebRTC peer-to-peer), **host-authoritative** | Free public PeerJS broker for signalling; TURN relay fallback (Metered recommended, keys via build-time secrets — `docs/NETWORK_TESTING.md`) |
| Hosting | **GitHub Pages**, auto-deployed by GitHub Actions | If P2P fails on some networks, add TURN relay or switch to a Node/Socket.io server later |
| Testing | Vitest for simulation logic | |

> Things can change later. If something doesn't work, we update this table and add a task.

---

## 2. Architecture (all tasks must follow this)

```
src/
  main.ts              Phaser game bootstrap
  config.ts            All tunable constants (pitch size, speeds, friction, match length…)
  settings.ts          Player settings in localStorage (try/catch), key bindings and their validation (pure apart from storage)
  teams.ts             Preset team names and kit colours, clash prevention (pure)
  matchStats.ts        Results-screen helpers: clock text, possession % (pure)
  sim/                 PURE TypeScript — no Phaser, no DOM, no network imports
    types.ts           GameState, PlayerState, BallState, InputFrame…
    physics.ts         Circle movement, friction, collisions, wall bounces
    simulation.ts      step(state, inputs, dt) -> state   (the whole game advances here)
    dribble.ts         Sticky dribbling: taking, carrying and losing the ball, the touchline holding it (shared with the guest's prediction)
    shooting.ts        Shot speed from charge, aim assist, finesse (curled) shot and curl (shared with the guest's prediction and the aim line)
    matchRules.ts      Match-rules presets (Arcade / Classic): building, validating (network) and reading them; GameState.rules
    setpiece.ts        Set pieces: throw-ins thrown not dribbled, aim clamped into the pitch, auto-throw, grace period
    rules.ts           Goals, kickoff, out of play, timer, halves
    ai.ts              AI decisions -> produces InputFrames for AI-controlled players
  render/              Phaser scenes that DRAW a GameState (never change it)
    MatchScene.ts
    MenuScene.ts       Title screen
    SettingsScene.ts / HowToPlayScene.ts / JoinScene.ts / TeamPickScene.ts / LobbyScene.ts / DiagnosticsScene.ts
    HudScene.ts / PauseScene.ts / ResultsScene.ts   (drawn over MatchScene)
    effects.ts         Dust/confetti particles, net ripple, fake ball height, camera aim (render maths, tested)
    teamStyle.ts       The names and kit colours the current match is drawn with
    ui.ts              Shared buttons/labels and `Focus` (keyboard navigation) for all menu screens
  audio/
    cues.ts            What the match sounds like, from the drawn state: new events, kicks/post hits seen in the ball's motion (pure)
    sound.ts           Web Audio synthesis (no audio files), unlock on first interaction, volume setting
  input/
    keyboard.ts        Keyboard -> InputFrame
  net/
    peer.ts            PeerJS connection, ICE/TURN server loading, Link (typed messages, ping, liveness, route), lobby interface
    ice.ts             ICE candidates, direct/relayed route from stats, TURN responses, diagnostics wording (pure)
    diagnostics.ts     Connection test: broker, candidate gathering, relay round trip
    roomCode.ts        Room codes, invite links, peer IDs (pure)
    errors.ts          Player-facing network errors (pure)
    protocol.ts        Versioned message types (handshake, lobby, ping, events, rejoin) (pure)
    snapshot.ts        Binary snapshot and input packets (pure)
    interpolation.ts   Snapshot buffer, interpolation, render clock (pure)
    stats.ts           Rate / packet-loss meters for the network overlay (pure)
    netsim.ts          Simulated latency / jitter / loss for testing
    match.ts           MatchDriver: what MatchScene advances and draws
    host.ts            HostLobby + HostMatch: runs the sim (also offline), broadcasts snapshots and events
    client.ts          GuestLobby + GuestMatch: sends inputs, interpolates snapshots, predicts own player
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
| Finesse shot (Arcade rules): hold shoot, tap pass | `Space` + `X` |
| Tackle / slide (no ball) | `C` |
| Switch player (no ball) | `Z` / `Shift` |
| AI debug overlay (roles, intents, team modes) | `F2` / `` ` `` |
| Network debug overlay (ping, snapshots, buffer, loss) | `F3` / `N` |
| Pause menu (offline: pauses; online: the match keeps running) / back | `Esc` |

With the ball (sticky dribbling) it stays at your feet; passes and shots go where the move keys point at release, and a kick pressed just before the ball arrives is held for 0.25 s and fires when it does.

Throw-ins are thrown: the taker stands still, aims with the move keys (yellow arrow) and presses pass (short throw) or holds and releases shoot (long throw); the aim is always clamped into the pitch, and after 3 s of nothing it goes to a free teammate. Corners and goal kicks are kicked, also clamped into the pitch. A dribbled ball can't be carried over a line (`TOUCHLINE_HOLDS_DRIBBLE`).

All of the movement and action keys can be rebound under **Settings** (two keys per action); the table shows the defaults. `Esc`, `Enter`, `Tab`, the F-keys, `` ` `` and `N` are reserved.

URL options: `?room=CODE` (invite link: joins that room), `?aivsai` (both teams AI, spectate), `?difficulty=easy|normal|hard`, and for testing online play on one machine `?lag=50&jitter=10&loss=0.03` (simulated network, per window) and `?predict=0|1` (guest prediction off/on).

Match rules (T15): **Arcade** (default: big goals, easy keepers who parry more, quick charge, aim line, aim assist, finesse shots, gentler AI defending against a human) or **Classic** (the game before T15), chosen under Settings / the team picker; online, the host's choice is used and shown in the lobby. The rules live in `GameState.rules` (presets: `MATCH_RULES` in `config.ts`). Tools: `npm run simulate -- --rules arcade|classic` (AI vs AI) and `npm run shoottest` (scripted shots vs each keeper level).


---

## 3. Roadmap (milestones)

| Milestone | Outcome | Tasks |
|---|---|---|
| **M0 — Foundations** | Project builds, deploys to GitHub Pages, blank pitch on the live URL | T00 |
| **M1 — Playable offline** | Kick a ball around, score goals, full 5-a-side match vs AI on one computer | T01–T05 |
| **M2 — Online multiplayer** | Two browsers in different places play a full match via room code | T06–T08 |
| **M3 — Game feel** | Menus, sound, celebrations, tuned gameplay | T09–T11 |
| **M4 — Release** | Polished public link, README, how-to-play | T12 |
| **Backlog** | Sprites, gamepad, mobile, 2v2 humans, rematch stats | B01+ |

---

## 4. Task Queue

Status key: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked

| # | Task | Depends on | Model | Status |
|---|---|---|---|---|
| T00 | Project setup, GitHub repo & Pages deploy | — | Sonnet 5.5 | [x] |
| T01 | Pitch, ball & core physics | T00 | Sonnet 5.5 | [x] |
| T02 | Player control: move, dribble, pass, shoot, tackle | T01 | Sonnet 5.5 | [x] |
| T03 | Teams, keepers & player switching | T02 | Sonnet 5.5 | [x] |
| T04 | AI teammates & opponents | T03 | **Opus 5.5** | [x] |
| T05 | Match rules: kickoff, goals, out of play, timer, HUD | T03 | Sonnet 5.5 | [x] |
| T06 | Networking: PeerJS host/join lobby with room codes | T05 | **Opus 5.5** | [x] |
| T07 | Netcode: input sending, snapshots, interpolation, disconnects | T06 | **Opus 5.5** | [x] |
| T08 | Real-world network test & TURN fallback | T07 | **Opus 5.5** | [x] |
| T09 | Menus & game flow (title, host/join, settings, results) | T07 | Sonnet 5.5 | [x] |
| T10 | Juice & audio: sounds, goal celebration, team colours, camera | T05 | Sonnet 5.5 | [x] |
| T11 | Playtest & gameplay tuning | T04, T10 | Sonnet 5.5 | [x] |
| T12 | Release: README, how-to-play, final deploy | T11, T08, T09 | Haiku 5.5 | [x] |
| T13 | Sticky dribbling & fix shooting | T12 | **Opus 5.5** | [x] |
| T14 | Throw-ins & touchlines: no walking the ball back out | T13 | Sonnet 5.5 | [x] |
| T15 | Make scoring easier: keepers, shooting & "Arcade" rules preset | T14 | **Opus 5.5** | [x] |

### Which model, and why

- **Opus 5.5** — the hardest problems: AI behaviour (T04), networking and netcode (T06–T08). These have tricky timing and design trade-offs, and bugs that are hard to track down, so the strongest reasoning is worth the cost.
- **Sonnet 5.5** — standard feature work with a clear spec: setup, physics, controls, rules, UI, audio, tuning. Fast and very capable for well-defined coding.
- **Haiku 5.5** — simple, low-risk jobs: docs, README, final deploy checks. Cheapest and quickest.
- If a Sonnet task gets stuck on the same bug twice, re-run it with Opus.

### How to run a task
1. Start a **fresh agent session** in `C:\Projects\Game` and pick the model listed.
2. Paste the task's prompt (below) as-is.
3. When it's done, test it yourself (the "Done when" list), then check the agent marked it `[x]` and pushed.
4. Move to the next task in the queue.

---

## 5. Task Prompts

### T00 — Project setup, GitHub repo & Pages deploy
**Model:** Sonnet 5.5

```text
You are working on a browser football game in C:\Projects\Game. Read ROADMAP.md first — it holds the locked decisions, the architecture and the task queue. You are doing task T00.

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

### T01 — Pitch, ball & core physics
**Model:** Sonnet 5.5

```text
You are working on a browser football game in C:\Projects\Game. Read ROADMAP.md first — follow the architecture and golden rules exactly. You are doing task T01.

Goal: a ball that moves realistically on the pitch, simulated in pure TypeScript.

Do the following:
1. In sim/types.ts define GameState, BallState (position, velocity, height/z for lofted balls is optional — keep it 2D for now), PlayerState and InputFrame. Design these to be serialisable to JSON (needed later for networking).
2. In sim/physics.ts implement: circle movement with velocity, rolling friction, max speed caps, ball bouncing off the pitch boundary (with some energy loss), and circle-vs-circle collision helpers (for players later).
3. Goals: the goal mouths must be openings in the boundary — the ball can go into the goal area and bounces off the goal net/back walls and posts (treat posts as small circles).
4. In sim/simulation.ts implement step(state, inputs, dt) using a fixed 60 Hz timestep. Rendering in MatchScene reads the state and draws it (it must not change state).
5. Temporary debug control: clicking on the pitch kicks the ball towards the click point, so physics can be tested by hand.
6. All tunables (friction, restitution, ball radius, etc.) go in config.ts.
7. Vitest tests: ball slows to a stop under friction; ball bounces off walls; ball can enter the goal area; step is deterministic for the same inputs.

Done when: in `npm run dev` I can click to kick the ball around, it slows naturally, bounces off walls and posts, and can go into the goals. All tests pass.
Finally, mark T01 as [x] in the ROADMAP.md task queue, commit and push.
```

---

### T02 — Player control: move, dribble, pass, shoot, tackle
**Model:** Sonnet 5.5

```text
You are working on a browser football game in C:\Projects\Game. Read ROADMAP.md first — follow the architecture, golden rules and controls table exactly. You are doing task T02.

Goal: one keyboard-controlled player who feels good to play.

Do the following:
1. input/keyboard.ts turns key presses into an InputFrame (move direction as a normalised vector, plus pass, shoot and tackle/switch button states). Support arrows and WASD.
2. Add one player to the state. Movement with acceleration/deceleration (not instant), max speed, and player-vs-ball and player-vs-wall collisions.
3. Dribbling: when the player touches the ball while moving, the ball is nudged ahead of them, so it stays close but can be lost. Don't glue the ball to the player.
4. Pass: tap pass/shoot → a medium-power kick in the facing direction. Shoot: hold to charge (show a small power bar near the player), release to kick harder. Cap the charge time.
5. Tackle: pressing tackle without the ball does a short dash/slide in the facing direction with a cooldown; it knocks the ball away if it hits it.
6. Remove the click-to-kick debug control (or hide it behind a debug flag in config.ts).
7. Draw the player as a coloured circle with a facing indicator.
8. Vitest tests for the input→movement and kick logic in sim/.

Done when: I can run around, dribble, pass, charge a shot into the goal and slide-tackle the ball, and it feels responsive. Tests pass.
Finally, mark T02 as [x] in the ROADMAP.md task queue, commit and push.
```

---

### T03 — Teams, keepers & player switching
**Model:** Sonnet 5.5

```text
You are working on a browser football game in C:\Projects\Game. Read ROADMAP.md first — follow the architecture and golden rules exactly. You are doing task T03.

Goal: two full 5-a-side teams on the pitch, with the human controlling one player at a time.

Do the following:
1. Two teams (home/away) of 5: 1 goalkeeper + 4 outfield players, with distinct colours and a starting formation (e.g. 2-2). Each team defends one goal.
2. The state tracks which player each human controls per team (one controlled player per team). Show a marker/ring and number above the controlled player.
3. Switching: pressing switch when not in possession moves control to the teammate best placed to reach the ball (closest, with a bias towards players between the ball and your own goal). Also auto-switch when a pass is received by a teammate.
4. Player–player collisions (soft pushing, no overlap).
5. Uncontrolled players for now simply return to/hold their formation position, shifted by where the ball is (basic positioning — full AI comes in T04). Keep this logic in sim/ai.ts so T04 can build on it.
6. Goalkeepers: for now they stay on their goal line and track the ball's position side-to-side. The keeper can catch or block the ball when touching it.
7. For offline testing, the second team has no human: all its players use the basic positioning.
8. Tests for the switching choice and collisions.

Done when: I see two full teams, can switch players with the switch key, pass to teammates and have control follow the ball, and the keepers block shots.
Finally, mark T03 as [x] in the ROADMAP.md task queue, commit and push.
```

---

### T04 — AI teammates & opponents
**Model:** Opus 5.5

```text
You are working on a browser football game in C:\Projects\Game. Read ROADMAP.md first — follow the architecture and golden rules exactly. In particular, the AI must live in sim/ai.ts, be pure TypeScript, and output InputFrames, the same as a human would (no cheating by moving players directly). You are doing task T04.

Goal: AI good enough that a match against an all-AI team is fun, and AI teammates help the human.

Design and implement:
1. A simple, readable role/state-based AI (no machine learning). Team states: attacking, defending, transitioning. Player roles: keeper, defender, attacker.
2. Off the ball: positions shift with the ball and the team state; attackers find space and make runs, defenders mark and stay goal-side. Avoid all players bunching on the ball — at most 1–2 players press.
3. On the ball (AI player in possession): choose between dribbling, passing to an open teammate (check the passing lane for opponents) and shooting (based on distance/angle to goal). Add a small reaction delay and aiming error so it's beatable.
4. Pressing/tackling: the nearest defender closes down the ball carrier and tackles when in range.
5. Goalkeeper: positions on the angle between the ball and the goal centre, comes out for close balls, dives for shots (a short burst of movement), and after a save distributes the ball to a teammate.
6. Difficulty setting in config.ts (easy/normal/hard) controlling reaction time, aiming error and speed.
7. The AI must run efficiently (5–10 players at 60 Hz) and deterministically given the same state (use a seeded random number generator stored in the state, not Math.random), so it works on the network host later.
8. A debug overlay (toggle with a key) showing each AI player's current role and intent.
9. Tests for key decisions (e.g. shoots when clear in front of goal, passes when pressured with an open teammate).

Done when: an AI vs AI match (add a config flag for it) looks like football — passing, shooting, tackling, keepers saving — and I can play a fun match against the AI.
Explain the AI design briefly at the end of your reply. Finally, mark T04 as [x] in the ROADMAP.md task queue, commit and push.
```

---

### T05 — Match rules: kickoff, goals, out of play, timer, HUD
**Model:** Sonnet 5.5

```text
You are working on a browser football game in C:\Projects\Game. Read ROADMAP.md first — follow the architecture and golden rules exactly. All rule logic goes in sim/rules.ts. You are doing task T05.

Goal: a complete match from kickoff to full time.

Do the following:
1. Match phases in the state: pre-kickoff, playing, goal-scored (short pause), half-time, full-time.
2. Kickoff: teams reset to formation in their own halves; the kicking-off team takes it from the centre spot. Kickoff alternates after each goal (the conceding team kicks off) and at the start of the second half.
3. Goal detection when the whole ball crosses the goal line between the posts. Update the score, pause ~2 seconds, then kickoff.
4. Out of play (keep it arcade): ball over a sideline → throw-in, quickly placed for the other team. Over a goal line → goal kick or corner as appropriate. Keep restarts fast (auto-restart after about 1 second if the human doesn't act).
5. Match timer: 2 halves of the length in config.ts; teams swap ends at half-time; full-time screen showing the final score and "Play again".
6. HUD scene: score, team names/colours, match clock, half indicator, and a "GOAL!" banner.
7. Every event (goal, half-time, etc.) also goes into a list of events in the state, so sounds and networking can react to them later.
8. Tests for goal detection, kickoff alternation, restarts and timer/half transitions.

Done when: I can play a full 2-half match against the AI with correct scoring, restarts, half-time, swapping ends and a full-time result.
Finally, mark T05 as [x] in the ROADMAP.md task queue, commit and push.
```

---

### T06 — Networking: PeerJS host/join lobby with room codes
**Model:** Opus 5.5

```text
You are working on a browser football game in C:\Projects\Game. Read ROADMAP.md first — follow the architecture and golden rules exactly. Networking code lives in net/. You are doing task T06.

Goal: two browsers in different places can connect by room code. (Syncing gameplay is T07 — this task is the connection and lobby only.)

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

### T07 — Netcode: input sending, snapshots, interpolation, disconnects
**Model:** Opus 5.5

```text
You are working on a browser football game in C:\Projects\Game. Read ROADMAP.md first — follow the architecture and golden rules exactly. T06 (PeerJS lobby) is done. You are doing task T07.

Goal: a smooth, fair online match using the host-authoritative model.

Design and implement:
1. Host: runs the only authoritative simulation at 60 Hz. Each tick it applies its own local input, the latest remote input for the away team's controlled player, and the AI inputs.
2. Client: sends its InputFrame to the host every tick (or on change plus a regular heartbeat), using sequence numbers. Choose and justify reliable vs unreliable PeerJS data channels for each message type.
3. Snapshots: the host broadcasts a compact snapshot 20–30 times a second (positions, velocities, ball, score, clock, phase, controlled players, recent events). Keep it small (round numbers, short keys or binary packing) — measure and report the bytes per snapshot.
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

### T08 — Real-world network test & TURN fallback
**Model:** Opus 5.5

```text
You are working on a browser football game in C:\Projects\Game. Read ROADMAP.md first. Online play (T06, T07) is done. You are doing task T08.

Goal: make sure online play works across real networks, including restrictive ones (like corporate networks), and fails clearly if not.

Do the following:
1. Add a connection diagnostics screen (reachable from the menu) that checks: whether the PeerJS broker is reachable, which ICE candidates are found (host/srflx/relay), and whether a direct or relayed connection was made. Show plain-English results.
2. Add TURN relay support configured in config.ts, using a free TURN option (e.g. Metered or Cloudflare free tier). Research the current free options and setup steps and tell me exactly what account/keys I need to create — do NOT sign up for anything or enter credentials yourself. Since this is a static site, explain the trade-offs of putting TURN credentials in client code and recommend the safest practical approach.
3. Make it fall back to the relay automatically when a direct connection fails, and show in the lobby whether the connection is "Direct" or "Relayed".
4. Write a short test checklist in docs/NETWORK_TESTING.md: same machine, same Wi-Fi, different networks (e.g. phone hotspot), corporate network.
5. If P2P turns out to be fundamentally unreliable for us, write up (do not build) what switching to a small Node.js/Socket.io relay server would involve, as a fallback option for the roadmap.

Done when: the diagnostics screen works, TURN is configured (once I've added keys), and I've been given a clear checklist to test with a friend.
Finally, mark T08 as [x] in the ROADMAP.md task queue (or [!] with a note if it's blocked on me creating an account), commit and push.
```

---

### T09 — Menus & game flow
**Model:** Sonnet 5.5

```text
You are working on a browser football game in C:\Projects\Game. Read ROADMAP.md first — follow the architecture. You are doing task T09.

Goal: a clean, complete flow through the game.

Do the following:
1. Title screen: game name, "Play vs AI", "Host online", "Join online", "Settings", "How to play".
2. Settings (saved to localStorage, wrapped in try/catch): match length, AI difficulty, sound volume, show controls overlay, and key rebinding for the main actions.
3. How-to-play screen with the controls table from ROADMAP.md.
4. Team picker before a match: team name and kit colour from a preset list (online: each player picks their own, and clashing colours are prevented).
5. Pause menu (offline: pauses the game; online: either player can call a short pause, or it just shows the menu without pausing — choose sensibly and explain). Includes "Resume", "Quit to menu".
6. Results screen: final score, simple stats (shots, possession %, goals with times), "Rematch" (online: both must accept) and "Menu".
7. Keyboard navigable throughout, plus mouse. Consistent, simple visual style.

Done when: I can go from the title screen through a full offline or online match and back again without refreshing the page.
Finally, mark T09 as [x] in the ROADMAP.md task queue, commit and push.
```

---

### T10 — Juice & audio
**Model:** Sonnet 5.5

```text
You are working on a browser football game in C:\Projects\Game. Read ROADMAP.md first — follow the architecture (render/audio react to state and events only and never change the sim). You are doing task T10.

Goal: make the game feel alive.

Do the following:
1. Sound effects: kick (soft/hard by power), bounce off a post, whistle (kickoff/half/full time), crowd ambience, a crowd roar on goals. Generate them with the Web Audio API or use free CC0 sounds — list the source and licence of each one in docs/CREDITS.md.
2. Audio starts after the first user interaction (browser autoplay rules), and respects the volume setting.
3. Visuals: a ball shadow and slight scaling for hard shots, kick dust particles, a net ripple when a goal goes in, a "GOAL!" celebration with a brief slow-motion or screen shake (kept light), player shirt numbers.
4. Camera: if the pitch is bigger than the screen, follow the ball smoothly with look-ahead; otherwise keep it static. Make it configurable.
5. Pitch: a striped grass pattern and nicer goal nets — still drawn with code, no sprites needed.
6. Make sure all of this works identically for the online client (driven by snapshots and events).

Done when: a match has satisfying sound and visual feedback and still runs at 60 fps.
Finally, mark T10 as [x] in the ROADMAP.md task queue, commit and push.
```

---

### T11 — Playtest & gameplay tuning
**Model:** Sonnet 5.5

```text
You are working on a browser football game in C:\Projects\Game. Read ROADMAP.md first. All core features exist. You are doing task T11.

Goal: make matches fun and balanced.

Do the following:
1. Run AI-vs-AI matches headlessly (a script using the pure sim/ code, no Phaser) for many matches at each difficulty, and report: average goals per match, shots, possession split, and how often the ball goes out of play or play gets stuck. Add this as an `npm run simulate` script.
2. Targets: about 3–6 goals per 6-minute match at normal difficulty, no stalemates (ball stuck against a wall or players), keepers save some but not all shots.
3. Tune config.ts values (speeds, friction, kick power, tackle cooldown, AI reaction) to hit the targets. Report the before/after numbers.
4. Fix any exploits you find (e.g. an unstoppable shot angle, tackle spam, the keeper getting stuck).
5. Write docs/PLAYTEST_NOTES.md: what you changed and why, plus a short list of things for me to feel-test by hand (e.g. "does a charged shot feel powerful enough?").

Done when: the simulation stats are within the targets and I have a list of things to feel-test.
Finally, mark T11 as [x] in the ROADMAP.md task queue, commit and push.
```

---

### T12 — Release: README, how-to-play, final deploy
**Model:** Haiku 5.5

```text
You are working on a browser football game in C:\Projects\Game. Read ROADMAP.md first. You are doing task T12, the release.

Do the following:
1. Write README.md: what the game is, the live GitHub Pages link, how to play with a friend (host → share link → join), controls, troubleshooting connection problems (link to docs/NETWORK_TESTING.md), and how to run it locally (npm install, npm run dev).
2. Add the page title, favicon and meta description/social preview tags in index.html.
3. Run `npm test` and `npm run build` and fix only trivial problems; report anything bigger instead of fixing it.
4. Check the GitHub Actions deploy succeeded and the live site loads.
5. Tag the release v1.0.0.

Done when: the live link works and the README explains everything a friend needs.
Finally, mark T12 as [x] in the ROADMAP.md task queue, commit, push and give me the link to share.
```

---

### T13 — Sticky dribbling & fix shooting
**Model:** Opus 5.5 (this change touches the core ball rules, the AI and the online guest's prediction all at once; Sonnet 5.5 would manage the offline part, but the online side needs Opus)

```text
You are working on a browser football game in C:\Projects\Game. Read ROADMAP.md first — follow the architecture and golden rules exactly (all game logic in pure TypeScript under src/sim/, tunables in src/config.ts). You are doing task T13, based on playtest feedback.

Feedback from the player:
- "Running with the ball is hard." Today, dribbling in src/sim/simulation.ts (interactWithBall) nudges the ball ahead every DRIBBLE_TOUCH_INTERVAL and lets it run free in between, so the ball keeps getting away.
- "When I was shooting it wasn't doing anything." Shots fire only on the frame the shoot key is released, and only if the ball is within KICK_REACH at that exact moment. The likely cause is that the free-running dribbled ball is often out of reach on release, so the shot is silently dropped and the charge resets. Confirm the real cause(s) before fixing: also check the keyboard input (src/input/keyboard.ts), focus/Space-key handling in menus/scenes, set-piece restarts, and the online guest path (net/client.ts prediction, net/host.ts input handling).

Do the following:
1. Sticky dribbling: when a player has the ball and is moving, the ball stays held a short, fixed distance in front of them (in their facing direction) and turns with them smoothly (no teleporting). The ball should still visibly roll a little so it doesn't look glued.
   - Possession is lost to: a successful tackle/slide, an opponent body-checking the ball carrier from the front, any kick (pass/shot), and very sharp turns at full speed (optional, configurable).
   - Gaining possession: a loose ball the player runs into at a reasonable relative speed is controlled automatically; very fast balls (hard shots) still bounce off unless they're a pass to a teammate.
   - Running with the ball is slightly slower than without it (configurable, e.g. 90%).
   - Make it all configurable in config.ts, including a DRIBBLE_MODE = 'sticky' | 'classic' switch so the old behaviour can be restored.
   - Store possession in GameState so it is serialisable (the network sends it).
2. Fix shooting so it always responds:
   - Show the charge bar while holding shoot even when not on the ball.
   - Kick buffer: if shoot is released (or pass pressed) while the ball is just out of reach, keep the kick queued for ~0.25 s and fire it as soon as the player gets the ball.
   - With sticky dribbling the ball is in reach while dribbling, so a shot from a dribble must always fire.
   - Shot direction: use the movement keys held at release (fall back to facing), so you can run one way and shoot another.
   - Add a short audio/visual cue for "kick queued" vs "kick fired", so it is never silent.
3. AI: update src/sim/ai.ts so AI players use the new possession model correctly (dribbling, shielding, tackling the carrier, passing/shooting from possession). Re-run `npm run simulate` and keep the T11 targets (about 3–6 goals per 6-minute match at normal difficulty, no stalemates). Re-tune if needed and report before/after numbers.
4. Online: make sure the guest sees the ball held by its own predicted player without lag or rubber-banding (the ball held by the guest's predicted player should be predicted with it), and the host's version always wins on disputes. Test with the simulated latency/loss settings from config.ts.
5. Tests (Vitest): ball stays attached while running and turning; a tackle wins the ball; pass and shot always fire from possession; the kick buffer fires when the ball arrives within the window and expires after it; possession survives snapshot encode/decode.
6. Update the How-to-play text if the controls change, and add a line to docs/PLAYTEST_NOTES.md listing what to feel-test by hand.

Done when: offline, I can run the length of the pitch with the ball under control, turn with it, and every shoot press produces a shot; AI matches still meet the T11 targets; online play with ~100 ms simulated latency feels the same for the guest. `npm test` and `npm run build` pass.
Finally, mark T13 as [x] in the ROADMAP.md task queue, add a change log entry, commit and push (this deploys to GitHub Pages).
```

---

### T14 — Throw-ins & touchlines: no walking the ball back out
**Model:** Sonnet 5.5 (a well-defined rules change in `sim/rules.ts` and `sim/simulation.ts` with clear tests; switch to Opus 5.5 if the online guest's prediction starts fighting the new rules)

```text
You are working on a browser football game in C:\Projects\Game. Read ROADMAP.md first — follow the architecture and golden rules exactly (all game logic in pure TypeScript under src/sim/, tunables in src/config.ts). You are doing task T14, based on playtest feedback.

Feedback from the players: "When it's a throw-in, half the time one of us walks it straight back off the pitch, so the other person gets a throw-in."
Likely cause: restarts (src/sim/rules.ts setRestart/updateRestart) place the ball only RESTART_INSET inside the touchline. Since T13's sticky dribbling, the taker — or whoever picks the ball up right after the restart is released — can carry the ball back over the line by holding a direction towards it. Confirm this (write a failing test first) before fixing.

Do the following:
1. Throw-ins are thrown, not dribbled: during a throw-in the taker can't move with the ball or pick it up with a dribble. They aim with the movement keys and press pass (short throw) or shoot (long throw, can charge). The throw always goes into the pitch: clamp the aim to the inward half-circle. Show an aim arrow for the human taker. Corners and goal kicks stay as kicks, but use the same "aim into the pitch" clamp.
2. Auto-throw: if a human taker does nothing for RESTART_AUTO_DELAY (raise it to ~3 s for a human taker; keep it short for the AI), throw it to the nearest unmarked teammate automatically.
3. The touchline holds the ball for the dribbler (arcade rule, configurable): while a player is dribbling (sticky possession), the ball can't be carried over a touchline or goal line. The dribbler slows down and slides along the line instead. The ball can only go out of play from a kick, a pass, a deflection, a tackle or a keeper parry. Add TOUCHLINE_HOLDS_DRIBBLE = true in config.ts.
4. Grace period: for ~1 s after any restart, if the ball goes back out without a touch from another player, the same team retakes it (instead of handing it to the opponent). Configurable.
5. The AI takes throw-ins with the same rules (aims to a teammate, never out of play).
6. Make sure all of this works for the online guest (predicted player and restarts must agree with the host; the host always wins). Test with the simulated latency settings.
7. Update How-to-play text for throw-ins.
8. Tests (Vitest): a dribbler holding a direction into the touchline can't take the ball out; a throw-in aimed outwards still goes into the pitch; auto-throw fires after the delay; the grace-period retake goes to the same team; a kicked ball can still go out normally.
9. Re-run `npm run simulate` and confirm there are no stalemates (e.g. ball stuck against the line with a dribbler) and the T11 targets still hold. Report the numbers.

Done when: in an offline and an online match, throw-ins always go into play, and nobody can walk the ball off the pitch. `npm test` and `npm run build` pass.
Finally, mark T14 as [x] in the ROADMAP.md task queue, add a change log entry, commit and push (this deploys to GitHub Pages).
```

---

### T15 — Make scoring easier: keepers, shooting & "Arcade" rules preset
**Model:** Opus 5.5 (balance work spanning the keeper AI in `sim/ai.ts`, the shooting mechanics and match settings, which must stay fair online; the trade-offs need judgment, not just number tweaking)

```text
You are working on a browser football game in C:\Projects\Game. Read ROADMAP.md first — follow the architecture and golden rules exactly. You are doing task T15, based on playtest feedback.

Feedback from the players: "In multiplayer nobody can score — it's too difficult. Even against the AI it's hard to score."
Things that may be making it hard (check and measure before changing anything): KEEPER_CATCH_SPEED (850 px/s) is close to SHOT_MAX_SPEED (1150) and above most shots taken under pressure; a full charge takes SHOT_MAX_CHARGE_TIME (0.8 s), which is hard to get under pressure; keepers are AI on both sides even in multiplayer, using AI_TEAMMATE_DIFFICULTY 'normal'; GOAL_WIDTH is 140 px; 2 AI pressers close the shooter down quickly.

Step 1 — measure. Extend `npm run simulate` (or add a separate script) with a "shooting test": thousands of scripted shots from typical positions (penalty spot, edge of the box, angled, with/without a defender nearby) at different charge levels, against each keeper difficulty. Report the % scored. Also report goals per match for AI vs AI at each difficulty. Save the before numbers.

Step 2 — implement these options, each switchable in config.ts and grouped into a match-rules preset:
1. Keeper balance: lower the catch speed so medium and hard shots are parried, not caught; keepers react slower to shots aimed at the far corners; keepers don't dive perfectly to the post; a slower keeper reaction on 'easy'/'normal'. Add a separate KEEPER_DIFFICULTY setting (independent of the outfield AI difficulty).
2. Easier shooting:
   - A faster charge (~0.5 s to full).
   - Mild aim assist: a shot aimed roughly at goal from inside shooting range bends its direction a little towards the nearer open corner, never fully onto target.
   - A "finesse" shot: holding pass + shoot (or a double-tap) gives a curled, placed shot that's slower but aimed near the post.
   - A visible aim line while charging, inside shooting range.
3. Optional chip shot (only if it fits cleanly into the 2D sim): a lofted ball with a simple height value that goes over a keeper who has come off their line. If it doesn't fit cleanly, write up how it could be done and skip it.
4. Defending eased slightly: one AI presser instead of two when a human is shooting, and AI defenders don't slide-tackle from behind inside the box.
5. Goal size setting: Normal (140) / Big (~180).
6. A "Match rules" setting in the Settings/team-picker screen with presets: **Arcade** (default for online multiplayer: bigger goals, easy keepers, aim assist, quick charge) and **Classic** (current behaviour). In online play the host's choice is used and shown to the guest in the lobby; send it in the existing protocol (bump the protocol version).

Step 3 — tune to targets and report before/after numbers:
- Arcade: ~5–9 goals per 6-minute AI-vs-AI match; a well-placed charged shot from the edge of the box scores ~40–60% of the time; a penalty-spot shot ~70%+.
- Classic: keep the T11 targets (~3–6 goals per match).
- Keepers must still make visible saves — scoring shouldn't feel free.

Also:
- Tests (Vitest): the presets apply the right values; aim assist never turns a wide shot into a perfectly placed one; the keeper parries (doesn't catch) shots above the new catch speed; the setting survives the network handshake.
- Update How-to-play and docs/PLAYTEST_NOTES.md with what changed and a short list of things to feel-test by hand online.

Done when: in an online Arcade match, both of us can score regularly with well-taken shots, but keepers still make saves; the shooting test and simulation numbers hit the targets; `npm test` and `npm run build` pass.
Finally, mark T15 as [x] in the ROADMAP.md task queue, add a change log entry, commit and push (this deploys to GitHub Pages).
```

---

## 6. Backlog (after v1)

| # | Idea | Suggested model |
|---|---|---|
| B01 | Pixel-art sprites & animations for players | Sonnet 5.5 |
| B02 | Gamepad support (browser Gamepad API) | Sonnet 5.5 |
| B03 | Mobile touch controls (virtual joystick) | Sonnet 5.5 |
| B04 | 2v2 humans online (more peers, more controlled players per team) | Opus 5.5 |
| B05 | Switch to a Node/Socket.io server if P2P is unreliable (plan: `docs/RELAY_SERVER_OPTION.md`) | Opus 5.5 |
| B06 | Penalty shoot-out after a draw | Sonnet 5.5 |
| B07 | Replays of goals (record snapshots) | Opus 5.5 |

---

## 7. Change log
- 2026-10-09 — Roadmap created. Decisions: online 1v1 with AI teammates, top-down, keyboard, GitHub Pages.
- 2026-10-12 — T04: role/state AI in `sim/ai.ts` (memory + seeded RNG live in `GameState.ai`); difficulty profiles and `AI_VS_AI` in `config.ts`. Sim tweaks: a tackle slides in the steered direction, a keeper's slide is a dive (blocks, doesn't knock the ball on), and players are processed in alternating order each tick so ball contests are fair between teams. `sim/rules.ts` has a **temporary** goal reset (ball in the net → kickoff positions after 1.2 s, no score) that T05 should replace.
- 2026-10-12 — T05: match flow in `sim/rules.ts` (phases `pre-kickoff | playing | goal-scored | half-time | full-time`, score, half, clock, `restart`, capped `events` list with increasing ids — consumers remember the last id they handled). The ball now uses `BALL_BOUNDARY` (nets and posts only, no touchline/end-line walls) so it can leave the pitch; players still use the closed `BOUNDARY`. Set pieces (throw-in, goal kick, corner, kickoff) place the ball and a taker, keep the opposition clear and auto-release after `RESTART_AUTO_DELAY`. `createMatchState()` starts a real match in pre-kickoff; `createInitialState()` is open play for tests. HUD in `render/HudScene.ts`; "Play again" calls `MatchScene.restartMatch()`.
- 2026-10-12 — T06: the game now opens on `MenuScene` (Play vs AI / Host / Join). Online: the host registers `browser-football-<code>` on the public PeerJS broker (codes like `PASS-4827`); the guest connects with one reliable JSON data channel, sends `hello` (protocol + game version from package.json — **bump `version` in package.json with each task**), and the host answers `welcome` or `reject`. The host owns `LobbyState` (teams, ready flags) and sends it on every change. `Link` pings every second and drops the connection after 8 s of silence. Start currently launches an independent offline match on each screen with the player's chosen team (`MatchOptions.humans`); the `Lobby` object is passed to `MatchScene` (`MatchSceneData.online`) for T07 to use. STUN/TURN config is in `config.ts` (`TURN_SERVERS` is empty, ready for T08).
- 2026-10-12 — T07: host-authoritative netcode (protocol 2, game 0.7.0). `HostMatch` (net/host.ts) runs the only sim — offline play is a `HostMatch` with no lobby — and `GuestMatch` (net/client.ts) draws the host's snapshots. Two channels on one PeerJS connection: the reliable JSON one (handshake, lobby, ping, events, rejoin) and an extra **unreliable, unordered** `RTCDataChannel` (negotiated id `NET_FAST_CHANNEL_ID`, `maxRetransmits: 0`) for binary snapshots (host → guest, 30/s, **143 bytes**; JSON would be ~1.8 KB) and inputs (guest → host, 60/s, each packet repeats the last 4 frames). PeerJS's own `reliable: false` still retransmits, hence the extra channel; it falls back to base64 over the reliable channel if it can't open. The guest renders `NET_INTERP_DELAY_MS` (100 ms) behind, predicts only its own player's movement (blending back to the host's position near the ball) and releases events when the drawn match reaches their tick. Disconnects: either side pauses after `NET_STALL_MS` of silence; a dropped guest auto-reconnects (token from `start`, `rejoin` message, missed events resent) within `NET_RECONNECT_WINDOW_MS` (30 s), else the match ends; `bye` (Esc, closing the tab) ends it straight away. "Play again" is offline only (online rematch is T09). Note: a browser pauses a hidden tab's game loop, so if the host switches tabs the match pauses for both.
- 2026-10-12 — T08 (game 0.8.0): **Test my connection** (menu → `DiagnosticsScene`, run by `net/diagnostics.ts`) checks the broker, gathers ICE candidates (host/srflx/relay, TURN errors explained, strict-NAT hint) and bounces data through the relay; the plain-English wording lives in pure `net/ice.ts` (tested). TURN comes from build-time env vars (`VITE_TURN_CREDENTIALS_URL`, or `VITE_TURN_URLS`/`_USERNAME`/`_CREDENTIAL`; GitHub secrets for the live site, `.env.local` locally) and `loadIceServers()` fetches/caches it. Fallback: ICE tries direct and relay together; if the attempt fails the guest retries once relay-only (`iceTransportPolicy: 'relay'`), the host lets a new attempt replace an unfinished one, and reconnects stay relayed. `Link.route` (from getStats) shows "Direct"/"Relayed" in the lobby and F3 overlay. Blocked only on TURN keys; server fallback written up in `docs/RELAY_SERVER_OPTION.md`. Note: the in-app preview pane doesn't fire requestAnimationFrame, so Phaser there must be stepped by hand (`__game.step`) for testing.
- 2026-10-12 — T09 (game 0.9.0, protocol 3): full menu flow, all keyboard- and mouse-navigable (`Focus` in `render/ui.ts`: arrows/WASD move, Enter/Space press, ←/→ change a value row). Title (Play vs AI / Host online / Join online / Settings / How to play / Test my connection) → `JoinScene` (code entry) → `TeamPickScene` (team name + kit colour from `teams.ts` presets; remembered) → lobby or match; invite links (`?room=`) go to the team picker first. **Settings** (`settings.ts`, localStorage, validated on load): match length (1/2/3/5 min halves, now `GameState.halfLength`), AI difficulty, sound volume, controls overlay on/off, and rebinding of move/pass/shoot/tackle/switch (two keys per action, duplicates and reserved keys refused). **Online teams**: each player's look travels in `LobbyState.looks`; the host resolves clashes (same kit colour or name) by moving the guest to the next free one, and lobby "Change kit/name" skip the other's. The match length is the host's (`start.half`). **Pause**: offline `Esc` freezes the match; online it only opens the menu and ignores your input while the match carries on (a shared freeze would let either player stall the other, and needs more protocol), saying so on the menu. **Results** (`ResultsScene`, ~1.2 s after full time): score, shots, possession %, goals with match time, Rematch / Menu. Stats are kept by the sim (`GameState.stats`: shoot-kick shots from the attacking end, possession = last team to touch the ball while in play, goal list) and sent to the guest once at full time (`stats` message). **Online rematch**: either player taps Rematch (`rematch` message, shown to the other as "wants a rematch"); when both have, the host starts a new match with a new seed (`restart` message) and the guest resets its state, ignoring the old match's last snapshots. Offline Rematch starts a new match with a fresh seed.
- 2026-10-12 — T10 (game 0.10.0): juice and audio, all render/audio-side and driven only by the drawn state, so offline, host and online guest behave identically. **Audio** (`audio/`): every sound is synthesised with the Web Audio API (kick soft→hard, post ring, net thud, whistles, crowd murmur that swells near a goal, goal roar; `docs/CREDITS.md`). The context is created on the first click/key press (`sound.attachUnlock()` in `main.ts`) and the settings volume is applied (squared) to a master gain. Sounds come from `state.events` (whistles, goal roar; ids are tracked per match, reset when the tick counter goes backwards) and from `BallCueDetector`, which spots kicks, post hits and net thuds as sudden velocity changes of the drawn ball (works on the guest's interpolated snapshots too, since it looks ~50 ms back). **Visuals** (`render/effects.ts`, `MatchScene`): ball shadow that detaches and ball that grows on hard shots (drawing only; the sim stays 2D), kick/slide dust, goal nets as a mesh that ripples on a goal or net hit, confetti, a light camera shake and zoom punch plus a pop-in GOAL! banner, shirt numbers on every player, striped grass, penalty spots/arcs and corner arcs. No real slow-motion: slowing the host's clock would slow the guest too. **Camera**: new setting (Auto / Whole pitch / Follow the ball). Follow zooms to `CAMERA_FOLLOW_ZOOM` and tracks the ball with velocity look-ahead and smoothing; Auto follows only when the canvas is drawn at under `CAMERA_AUTO_MIN_SCALE` of the pitch's size. On-screen text in MatchScene lives on a second fixed camera; the HUD is a separate scene and is unaffected.
- 2026-10-12 — T11 (game 0.11.0): `npm run simulate` (`scripts/simulate.ts`, bundled with rolldown, runs the pure sim headlessly) plays AI-vs-AI matches and reports goals, shots, saves, possession, restarts and stuck/dead-ball detection; `npm run probe` is a shot-vs-keeper exploit probe. Normal difficulty went from 3.07 to 3.88 goals a match (73% of matches in 3-6), saves ~64%, no stalemates. Mostly **bug fixes**: throw-in/corner takers stood on the pitch side facing the line, so every restart sent the ball straight out again (~630 throw-ins a match, now ~90; `setRestart` now puts the taker on the line side and the ball `RESTART_INSET` in); `lastTouch` was given to anyone within reach of a ball flying past (own goals, wrong-team restarts), now only real contacts or a near-rest ball count; a ball resting just outside a corner (not "wholly over" the line, unreachable) stalled play for 93 s, now a resting ball beyond a line is out (`OUT_REST_SPEED`); AI own goals (chasing from upfield, walking into the ball, goal-mouth scrambles) fixed with `routeAroundBall`, `AI_OWN_GOAL_DANGER` and a keeper-owned goal mouth. Exploits: missed slides now cost 1.3 s (`TACKLE_COOLDOWN`), connecting ones 0.5 s (`TACKLE_HIT_COOLDOWN`), keepers keep 0.9 s; Normal/Hard keepers react faster so placed half-charge corner shots no longer always score. Details, before/after tables and a hand-test list: `docs/PLAYTEST_NOTES.md`. Feel values in `config.ts` (speeds, friction, kick power) were deliberately not changed.
- 2026-10-12 — T12 (game 1.0.0): release. `README.md` covers what the game is, the live link, playing with a friend (host → invite link → join), controls, connection troubleshooting and running locally. `index.html` has a meta description, an inline SVG favicon and Open Graph / Twitter title and description tags (no social image yet). Version bumped to 1.0.0; tag `v1.0.0`.
- 2026-10-12 — T13 (game 1.1.0, protocol 4): **sticky dribbling and shots that always respond.** Causes found first: the free-running dribbled ball was usually out of `KICK_REACH` on the release frame, so the shot was dropped silently (main cause); the host's input merge kept `shoot` from the newer frame only, so a quick tap from a lagging guest vanished; a Space held over from a menu auto-repeated into a phantom press. New `sim/dribble.ts`: `GameState.possession` (carrier, hold angle, roll) — a slow enough loose ball is taken on contact (teammate passes up to 900 px/s), held in front, swung round with the facing, slightly slower running; lost to a slide, an opponent touching it from the front, any kick, or a full-speed U-turn. `DRIBBLE_MODE: 'classic'` restores T02. **Kick buffer** (`KICK_BUFFER_TIME` 0.25 s) for pass/shoot pressed out of reach; kicks are aimed by the move keys at release; queued/fired/expired cues (amber ring, white burst, tick/kick/swish). **Keepers catch** in the box (`KEEPER_CATCH_SPEED`) and can't be tackled while holding. AI uses possession (carry, staged turns, shielding, kick from possession, set pieces kicked, pressers step in goal-side). Re-tuned to the T11 targets: Normal 5.08 goals a match (65% in 3-6; seed 7: 4.97, 70%), no stalemates; all levels press with two and tackle more, keepers move faster. **Online:** snapshots carry possession and kick flags (146 bytes); the guest predicts the ball its own player carries, launches its own kicks at once and hands over to the host's ball without it ever going backwards; the host always wins (`tests/guestPrediction.test.ts`, 100 ms one way, 3% loss). Details and the hand-test list: `docs/PLAYTEST_NOTES.md` (T13 section).
- 2026-10-14 — T08 marked done: TURN keys and `VITE_TURN_CREDENTIALS_URL` set up by the user. Added T14 (throw-ins/touchlines) and T15 (easier scoring, Arcade/Classic rules presets) from playtest feedback.
- 2026-10-14 — T14 (game 1.2.0, protocol unchanged at 4): **throw-ins are thrown, and the ball can't be walked off the pitch.** Cause confirmed by failing tests first: the taker (or anyone) could walk onto the restart ball, pick it up with a sticky dribble and carry it back over the line, and nothing stopped a held ball crossing any line. New `sim/setpiece.ts`: during a throw-in the ball is held on its spot and nobody can take possession; the taker stands still, aims with the move keys and throws with pass (`THROW_SHORT_SPEED`) or a charged shoot (`THROW_LONG_*`); every restart's aim is clamped into the pitch (an outward aim is mirrored back in, then kept `THROW_AIM_EDGE` off the line), and a yellow arrow shows a human taker's aim (drawn from local keys, so the online guest sees it at once; the guest's copy of the restart now names the taker). Auto-play: a human taker gets `RESTART_AUTO_DELAY_HUMAN` (3 s), then it is thrown/passed to the nearest unmarked teammate (`THROW_MARKED_DISTANCE`); an AI throw-in goes within `RESTART_AUTO_DELAY` (1 s) and the AI only throws to a teammate it can reach. **Arcade touchline** (`TOUCHLINE_HOLDS_DRIBBLE`, on): a carried ball stays wholly inside the touchlines and goal lines (not the goal mouth: you can still walk it in); the carrier is held off the line and slides along it at `TOUCHLINE_HOLD_SPEED_FACTOR`. **Grace period** (`RESTART_GRACE_TIME` 1 s): a restart that goes straight back out before anyone but the taker touches it is retaken by the same team. Online: the guest's prediction runs the same touchline rule (`holdOffLines`, `heldBallSpot`); prediction stays off during set pieces, so the host decides every throw. Simulation (40 matches, seed 1): Normal 4.15 goals (was 5.08), 72.5% of matches in 3-6 (was 65%), Easy 4.25, Hard 4.42, 0 stuck or dead balls; holdout seed 7 (100 matches): Normal 4.72, 73% in 3-6, 0 stuck. Tests: `tests/throwins.test.ts`, two online cases in `tests/guestPrediction.test.ts` (100 ms one way, 3% loss). Details: `docs/PLAYTEST_NOTES.md` (T14 section).
- 2026-10-14 — T15 (game 1.3.0, protocol 5): **easier scoring, and Arcade / Classic match rules.** Measured first with a new shooting test (`npm run shoottest`: ~7,000 scripted shots per keeper level from 5 spots × charge × aim × with/without a defender). Main causes: keyboard aim has only 8 directions, so from central spots a human could only shoot at the keeper (penalty spot 0%, edge of the box 0-3% with key aims); keepers smothered a shooter standing within 110 px while the 0.8 s charge ran; a defender tackled every half/full charge; most shots under pressure were caught (850 px/s). New `GameState.rules` (`sim/matchRules.ts`, presets `MATCH_RULES` in `config.ts`), carried in `LobbyState.rules` and the `start` message (validated), so the guest plays the host's rules; Settings has Match rules and Keepers, the team picker and lobby show them (the host can switch in the lobby, which clears ready). **Classic** reproduces 1.2.0 exactly (simulate numbers identical). **Arcade** (default): 180 px goals (`GOAL_WIDTH_BIG`; boundaries per goal width, `boundaryFor`), easy keepers from their own `KEEPER_PROFILES` (`KEEPER_DIFFICULTY`) with flaws (slower on easy/normal, later to far-side shots, random reaction spread, short of the post, smother only within 70 px), catch speed 480 (parries → rebounds), 0.5 s charge, aim assist (`sim/shooting.ts`: bends towards the nearer open corner, never onto it), finesse shot (hold shoot + tap pass: 800 px/s, curled with a new `ball.spin`, placed by a post; keepers read the curl), a dotted aim line while charging in range, and eased AI defending against a human carrier (one presser, no slides from behind in the box). The guest predicts its own finesse/assisted kicks with the same functions. Chip shot skipped (needs a real ball height; write-up in the notes). Results: Arcade edge-of-box full-charge keyboard shot 60% (was 0-3%), penalty spot 95% (was 0%), keepers save 59% of shots; AI vs AI goals per match easy 4.55 / normal 6.72 / hard 6.90 (holdout seed 7: 4.97 / 5.87 / 6.52), 0 stuck; Classic 4.25 / 4.15 / 4.42 unchanged. Tests: `tests/matchRules.test.ts`. Details and the hand-test list: `docs/PLAYTEST_NOTES.md` (T15 section).


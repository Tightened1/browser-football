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
  teams.ts             T24: looks (club + kit indices), CIEDE2000 colour difference, kit-clash prevention, team drawing styles (pure)
  data/clubs.ts        T24: the 20 Premier League clubs: names, kits, 5-player squads. Pure data, easy to correct by hand (docs/UPDATING_SQUADS.md)
  matchStats.ts        Results-screen helpers: clock text, possession %, man of the match, stat lines (pure)
  social.ts            T21: player-name sanitising, quick-chat presets / rate limit / feed, series score (pure)
  sim/                 PURE TypeScript — no Phaser, no DOM, no network imports
    types.ts           GameState, PlayerState, BallState, InputFrame…
    physics.ts         Circle movement, friction, collisions, wall bounces
    simulation.ts      step(state, inputs, dt) -> state   (the whole game advances here)
    dribble.ts         Sticky dribbling: taking, carrying and losing the ball, the touchline holding it, standing tackles, shield and feint (shared with the guest's prediction)
    shooting.ts        Shot speed from charge, aim assist, finesse (curled) shot and curl (shared with the guest's prediction and the aim line)
    matchRules.ts      Match-rules presets (Arcade / Classic): building, validating (network) and reading them; GameState.rules
    setpiece.ts        Set pieces: throw-ins thrown, corners crossed, free kicks and penalties struck (not dribbled), aim clamped into the pitch (penalties left / centre / right), auto-throw / auto-cross, grace period
    playerStats.ts     T21: per-player goals, assists, saves, tackles won and shots, worked out from what changed each tick (pure)
    fouls.ts           The referee (T19): fouls on slides and late challenges, free-kick walls, sending off, penalty and shoot-out helpers (spots, takers, who has won)
    rules.ts           Goals, kickoff, out of play, fouls awarded (free kick / penalty, cards), timer, halves, golden goal, penalty shoot-out
    random.ts          The seeded PRNG (state lives in GameState.ai.rng): the AI's decisions, standing-tackle and shield rolls
    ai.ts              AI decisions -> produces InputFrames for AI-controlled players
  render/              Phaser scenes that DRAW a GameState (never change it)
    MatchScene.ts
    MenuScene.ts       Title screen
    SettingsScene.ts / HowToPlayScene.ts / JoinScene.ts / TeamPickScene.ts (club picker) / LobbyScene.ts / DiagnosticsScene.ts
    HudScene.ts / PauseScene.ts / ResultsScene.ts   (drawn over MatchScene)
    effects.ts         Dust/confetti particles, net ripple, fake ball height, camera aim (render maths, tested)
    teamStyle.ts       The club names, kit colours and players the current match is drawn with
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
    chat.ts            T21: QuickChat: sends the presets with a limit, receives the other player's (mute, limit)
    session.ts         T21: room code in the URL + sessionStorage, so a refreshed guest rejoins (try/catch everywhere)
    protocol.ts        Versioned message types (handshake, lobby, ping, events, rejoin) (pure)
    snapshot.ts        Binary snapshot and input packets (pure)
    interpolation.ts   Snapshot buffer, interpolation, render clock (pure)
    replay.ts          T23: replay ring buffer of encoded snapshots, goal / big-save clips, slow-motion timing, playback into a copy of the state (pure)
    stats.ts           Rate / packet-loss meters for the network overlay (pure)
    netsim.ts          Simulated latency / jitter / loss for testing
    match.ts           MatchDriver: what MatchScene advances and draws
    host.ts            HostLobby + HostMatch: runs the sim (also offline), broadcasts snapshots and events
    client.ts          GuestLobby + GuestMatch: sends inputs, interpolates snapshots, predicts own player
tests/                 Vitest tests for sim/ and net/ (incl. determinism, protocol round trips)
e2e/                   Playwright two-browser online smoke test (T18); scripts/simRanges.json = the sim regression ranges
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
| Tackle / slide (no ball); in goal facing a penalty: dive (with up / down) | `C` |
| Sprint (hold; uses stamina, bigger touches with the ball) | `Shift` |
| Shield the ball (hold, with the ball: slow, hard to tackle from behind/the side) | `V` |
| Feint / drag-back (with the ball) | double-tap a move key |
| Switch player (no ball) | `Z` |
| AI debug overlay (roles, intents, team modes, last touch) | `F2` / `` ` `` |
| Network debug overlay (ping, snapshots, buffer, loss) | `F3` / `N` |
| Online quick chat: Nice goal! / Unlucky / What a save! / Rematch? / 😂 / GG | `1`–`6` |
| Mute (or unmute) the other player's quick chat | `M` |
| Pause menu (offline: pauses; online: the match keeps running) / back | `Esc` |
| Skip a goal replay (online: for both players) or the full-time highlights | any other key |

With the ball (sticky dribbling) it stays at your feet; passes and shots go where the move keys point at release, and a kick pressed just before the ball arrives is held for 0.25 s and fires when it does.

Throw-ins are thrown: the taker stands still, aims with the move keys (yellow arrow) and presses pass (short throw) or holds and releases shoot (long throw); the aim is always clamped into the pitch, and after 3 s of nothing it goes to a free teammate. Corners (T16) are taken the same way but kicked: pass = low cross, shoot = hard cross (after 3 s, crossed into the box for you). Goal kicks are kicked, also clamped into the pitch. A dribbled ball can't be carried over a line (`TOUCHLINE_HOLDS_DRIBBLE`).

All of the movement and action keys can be rebound under **Settings** (two keys per action); the table shows the defaults. `Esc`, `Enter`, `Tab`, the F-keys, `` ` ``, `N`, `M` and `1`–`6` are reserved.

URL options: `?room=CODE` (invite link: joins that room), `?aivsai` (both teams AI, spectate), `?difficulty=easy|normal|hard`, and for testing online play on one machine `?lag=50&jitter=10&loss=0.03` (simulated network, per window) and `?predict=0|1` (guest prediction off/on).

Fouls and penalties (T19): a slide that hits the player before (instead of) the ball, or from behind, is a foul, and so is a clearly late standing challenge; the whistle goes at once (no advantage). Strictness is `MatchRules.fouls` (Off / Lenient / Strict, thresholds in `FOUL_PROFILES`; Arcade Lenient, Classic Strict), cards `MatchRules.cards` (a reckless slide is a yellow; two = sent off for the rest of the half, parked off the pitch at `SENT_OFF_POS`; Classic on, Arcade off) and draws `MatchRules.draws` (Off / Shoot-out / Golden goal, then penalties; Arcade shoot-out, Classic off); Settings can fix each. A foul gives a free kick on the spot (held like a corner: arrow, pass / charged shot; a 1-2 player AI wall within `FREE_KICK_WALL_RANGE`), or a penalty inside the box: the taker aims up / down / neither and passes (placed) or shoots (power); the keeper waits on its line and dives with up / down + tackle; a human facing one controls their keeper. Shoot-outs: best of 5, then sudden death, all at the right-hand goal. `npm run simulate` reports fouls, free kicks, penalties, cards and shoot-outs (`--fouls`, `--cards`, `--draws` override).

Defending and duels (T17): an AI slide at a human carrier is **telegraphed** (a short crouch and orange flash, committed to its direction: change direction to beat it); standing tackles (body checks from the front) can fail and then cool down (`STAND_TACKLE_COOLDOWN`). Against a human carrier the AI uses the **"AI defending vs humans"** profile (`AI_DEFENDING_VS_HUMAN`: Relaxed / Normal / Tough, in `GameState.rules.aiDefending`; Arcade = Relaxed, Classic = Normal, Settings can fix it); AI vs AI is unchanged (`AI_DEFENDING_VS_AI`). Humans (and, sparingly, the AI) can **sprint** (stamina in `PlayerState`/snapshots), **shield** and **feint**. `npm run simulate -- --human naive|skilled [--defending relaxed|normal|tough]` plays a scripted human dribbler (`scripts/humanBot.ts`) and reports AI tackle success on human vs AI carriers.

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
| T16 | Fix corners (awarded as goal kicks / throw-ins) | T15 | Sonnet 5.5 | [x] |
| T17 | Fairer AI defending + sprint & shield for humans | T16 | **Opus 5.5** | [x] |
| T18 | Automated tests in CI: sim regression + two-browser online smoke test | T16 | Sonnet 5.5 | [x] |
| T19 | Fouls, free kicks, penalties & penalty shoot-outs | T17 | **Opus 5.5** | [x] |
| T21 | Online extras: names, quick chat, series score, MVP | T16 | Sonnet 5.5 | [x] |
| T23 | Goal replays & highlights | T19 | **Opus 5.5** | [x] |
| T24 | Premier League clubs: names, home/away kits & real player names | T23 | Sonnet 5.5 | [x] |
| T20 | Xbox / PlayStation controller support | T24 | Sonnet 5.5 | [ ] |

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

### T16 — Fix corners (awarded as goal kicks / throw-ins)
**Model:** Sonnet 5.5 (a focused rules bug in pure, testable code; switch to Opus 5.5 if the cause still isn't found after the reproduction steps below)

```text
You are working on a browser football game in C:\Projects\Game. Read ROADMAP.md first — follow the architecture and golden rules exactly. You are doing task T16, a bug fix from playtesting.

Bug: "Corners aren't happening — when a defender puts the ball over their own goal line it turns into a goal kick, or a throw-in to the other team."

The decision is made in src/sim/rules.ts: checkBall() → goalLineOut() gives a corner when state.lastTouch.team is the defending team (defenderOf), otherwise a goal kick; the touchline check (throw-in) runs if the end-line check didn't fire. On a read-through, the corner logic itself looks right, so the cause is probably upstream. Suspects to check:
- Touches that don't update state.lastTouch: keeper dives/blocks while sliding, keeper parries (KEEPER_CLEAR_SPEED path), keeper catch/hold and release, body deflections off a defender, slide-tackle knocks, ball-held-by-the-line logic from T14, the T15 aim-assist/finesse paths, or the AI's own kick paths.
- A deflection near the corner flag being classified as over the touchline first (ball crossing both lines in one tick, or the "resting" rules).
- defenderOf() after teams swap ends at half-time.
- The T14 grace period (retake) or touchline-holds-dribble rule interfering.
- Online only: the guest's prediction or snapshot decode showing a different restart than the host.

Do the following:
1. Reproduce first with failing Vitest tests: a defender's touch (kick, body deflection, slide, keeper parry, keeper dive) sends the ball over their own goal line outside the posts → corner for the attackers, in both halves. Also: the ball crossing the end line near the corner flag → corner/goal kick, not a throw-in.
2. Add corner and goal-kick counts to `npm run simulate`. In AI-vs-AI matches there should be a reasonable number of corners (roughly 2–6 per match); report before and after.
3. Fix the root cause(s). Don't just patch symptoms.
4. Corners should be worth having: make sure the AI attacking team moves players into the box for a corner, and the human taker can aim the cross (same aim arrow as throw-ins) with pass = low cross, shoot = hard cross.
5. Add an optional debug overlay line (behind the existing debug toggle) showing the last-touch team/player, so this is easy to verify by eye.
6. Check it in an online match too (host and guest both see "CORNER").

Done when: defenders putting the ball behind gives a corner every time, the tests pass, and simulate shows corners happening. `npm test` and `npm run build` pass.
Finally, mark T16 as [x] in the ROADMAP.md task queue, add a change log entry, commit and push (this deploys to GitHub Pages).
```

---

### T17 — Fairer AI defending + sprint & shield for humans
**Model:** Opus 5.5 (AI behaviour and game balance across the AI, controls and online play; needs judgment so the AI stays useful)

```text
You are working on a browser football game in C:\Projects\Game. Read ROADMAP.md first — follow the architecture and golden rules exactly. You are doing task T17, based on playtest feedback.

Feedback: "The AI is a bit strong in a multiplayer match with the tackles. But if we lower them, they'll be useless."
Goal: the AI should still defend well (position, intercept, block shots, cover space), but tackling a human ball carrier should feel fair and beatable, and humans should get tools to beat a defender. Don't just lower numbers across the board.

Do the following:
1. Measure first: add to `npm run simulate` (or a scripted test) how often an AI tackle wins the ball from a carrier, split by "carrier is human-controlled" vs "AI". For humans, use a simple scripted human-like dribbler.
2. Telegraphed tackles: before an AI slide tackle there's a short, visible wind-up (~0.2–0.3 s, a small crouch/flash) the human can react to by changing direction. Standing tackles (poking the ball) have a short cooldown after a failed attempt.
3. Fair pressure on humans: when the ball carrier is human-controlled, the AI uses a separate tackle profile (lower tackleChance, slightly longer reaction, max one presser unless near its own goal). Keep the normal profile for AI vs AI. Add an "AI defending vs humans" setting: Relaxed / Normal / Tough (default Relaxed for Arcade, Normal for Classic).
4. Human tools to beat defenders:
   - Sprint (hold a key, e.g. Shift; rebind the current switch key if needed and update the defaults sensibly): faster running with a stamina bar that drains and recovers. Sprinting with the ball makes it slightly harder to control (bigger touches).
   - Shield: holding a key while standing or walking with the ball protects it — tackles from behind or the side are much less likely to win the ball, but you move slowly.
   - A quick feint/drag-back (double-tap a direction away from the defender) that shifts the ball sideways.
   - Give the AI the same tools sparingly, so it remains a fair contest.
5. Keep it all network-safe: new input bits in InputFrame, stamina in GameState/snapshots, bump the protocol version; the guest's prediction must handle sprint.
6. Update How-to-play, the controls table in ROADMAP.md, Settings rebinding and docs/PLAYTEST_NOTES.md.
7. Tests (Vitest): tackle wind-up delay; the human-carrier profile is used when the carrier is human; stamina drains/recovers; shield reduces tackle success from behind.
8. Re-run simulate: AI-vs-AI goals stay within the T11/T15 targets; report the human-carrier tackle success before/after (target: roughly halved on Relaxed).

Done when: in a multiplayer match the AI still defends well but we can beat a tackle with skill (sprint, shield, feint, reacting to the wind-up). `npm test` and `npm run build` pass.
Finally, mark T17 as [x] in the ROADMAP.md task queue, add a change log entry, commit and push (this deploys to GitHub Pages).
```

---

### T18 — Automated tests in CI: sim regression + two-browser online smoke test
**Model:** Sonnet 5.5 (standard test and CI tooling with a clear spec)

```text
You are working on a browser football game in C:\Projects\Game. Read ROADMAP.md first. You are doing task T18. The game changes a lot from task to task, and bugs like broken corners slip through, so we want automatic checks on every push.

Do the following:
1. GitHub Actions: run `npm test` and `npm run build` on every push and pull request. Deploy to Pages only if they pass (update the existing workflow).
2. Sim regression check: a fast version of `npm run simulate` (fixed seeds, a few AI-vs-AI matches with Arcade and Classic rules) that fails the build if key stats leave safe ranges: goals per match, corners, throw-ins, stalemates, shots. Keep the ranges in one config file so they're easy to adjust when we intentionally change balance.
3. Determinism check: the same seed and inputs give an identical final state (catches accidental Math.random/Date use in sim/).
4. Playwright smoke test (headless Chromium): start the Vite preview server, open two browser pages, host on one, join with the room code on the other, start a match, simulate a few seconds of key presses on both, and check that both pages show the same score/clock and no console errors. If the public PeerJS broker isn't reliable in CI, add a local PeerJS server for tests only (dev dependency, configured via an env var), and document it.
5. Snapshot/protocol round-trip tests for every message type.
6. Add `npm run test:e2e` and document all test commands in README.md.

Done when: a push runs all checks automatically, a deliberately broken rule (try one locally, then revert) makes CI fail, and the deploy only happens on green. Tell me how long the CI run takes.
Finally, mark T18 as [x] in the ROADMAP.md task queue, add a change log entry, commit and push.
```

---

### T19 — Fouls, free kicks, penalties & penalty shoot-outs
**Model:** Opus 5.5 (new rules plus AI and online sync; set pieces touch many systems)

```text
You are working on a browser football game in C:\Projects\Game. Read ROADMAP.md first — follow the architecture and golden rules exactly. You are doing task T19.

Goal: tackles carry risk, and set pieces add excitement. Keep it arcade, not a full rulebook.

Do the following:
1. Fouls: a slide tackle that hits the player before the ball, or from behind, is a foul. Mistimed standing tackles are fouls only if clearly late. Configurable strictness (Off / Lenient / Strict); Arcade = Lenient, Classic = Strict. "Off" keeps the current behaviour.
2. Free kick at the spot of the foul: the opposition is kept back (a wall of 1–2 AI players forms automatically if it's within shooting range). The taker aims with the arrow and uses pass/shoot like other set pieces (reuse the T14/T16 aim code).
3. Penalty for a foul inside the box: a penalty mode where the taker aims and shoots, and the defending human controls the keeper (dive left/centre/right with move + tackle key). The AI takes and saves penalties on difficulty-based odds.
4. Cards (optional, Lenient = none): a yellow card for a reckless slide, shown on the HUD and in results stats; two yellows = sent off for the rest of the half (team plays a player down). Make this a setting.
5. Penalty shoot-out for drawn matches (setting: Off / Shoot-out / Golden goal extra time). Best of 5 then sudden death, alternating takers, with a shoot-out scoreboard.
6. The AI: commits fewer slide tackles inside its own box (fear of penalties), and forms walls.
7. Network: new restart types, events and snapshot fields (protocol version bump); the guest controls its own penalty taker/keeper with prediction kept simple.
8. Results screen: fouls, cards, penalty results. Sounds: referee whistle for fouls.
9. Tests (Vitest): foul detection cases, free kick placement and wall distance, penalty → goal/save, shoot-out scoring and sudden death, card logic.
10. Re-run simulate and report fouls per match (target: ~2–5 on Lenient) and confirm goals stay in target.

Done when: in online and offline matches, reckless tackles give free kicks/penalties, penalties are playable by both humans, and a draw can go to a shoot-out. `npm test` and `npm run build` pass.
Finally, mark T19 as [x] in the ROADMAP.md task queue, add a change log entry, commit and push (this deploys to GitHub Pages).
```

---

### T21 — Online extras: names, quick chat, series score, MVP
**Model:** Sonnet 5.5 (UI and small protocol additions with a clear spec)

```text
You are working on a browser football game in C:\Projects\Game. Read ROADMAP.md first — follow the architecture exactly. You are doing task T21: making online sessions with a friend more social.

Do the following:
1. Player names: entered on the title screen (saved in localStorage, wrapped in try/catch), shown in the lobby, HUD and results, sent in the handshake. Limit the length and strip unsafe characters.
2. Quick chat / emotes: number keys 1–6 send preset messages ("Nice goal!", "Unlucky", "What a save!", "Rematch?", "😂", "GG"). Show them as a brief bubble above the sender's controlled player and in a small feed. Rate-limit them, and add a mute option. No free-text chat.
3. Series score: rematches in the same session keep a running series score (e.g. "Series 3–2") shown in the lobby and results screen, with a "reset series" button.
4. Results screen: man of the match (based on goals, assists, saves, tackles won), plus a per-player stat line for the human players.
5. Reconnect improvements: if the guest refreshes during the lobby or a match, it rejoins the same room automatically via the room code in the URL.
6. Protocol version bump; tests for the name sanitising, series counting and MVP scoring.

Done when: playing several matches online with a friend shows names, emotes, a running series score and an MVP. `npm test` and `npm run build` pass.
Finally, mark T21 as [x] in the ROADMAP.md task queue, add a change log entry, commit and push (this deploys to GitHub Pages).
```

---

### T23 — Goal replays & highlights
**Model:** Opus 5.5 (recording and playback of state, kept in sync for both players)

```text
You are working on a browser football game in C:\Projects\Game. Read ROADMAP.md first — follow the architecture exactly (rendering only reads GameState). You are doing task T23.

Do the following:
1. Keep a rolling buffer of the last ~6 seconds of game states/snapshots (memory-efficient: reuse the binary snapshot encoding). It works on the host, the guest and offline.
2. After a goal, offer an instant replay of the build-up (skippable by either player with any key; online, either player skipping ends it for both, or each sees it independently — choose and explain). Include slow motion for the last second and a camera that follows the ball.
3. Highlights: at full time, show a highlights reel of every goal from the match (and big saves if easy to detect), skippable.
4. The match clock doesn't run during replays; the next kickoff waits until the replay ends.
5. A "REPLAY" banner, and a setting to turn replays Off / Goals only / Goals + highlights.
6. Tests for the ring buffer and replay timing.

Done when: every goal can be watched again, online and offline, and the full-time highlights work. `npm test` and `npm run build` pass.
Finally, mark T23 as [x] in the ROADMAP.md task queue, add a change log entry, commit and push (this deploys to GitHub Pages).
```

---

### T24 — Premier League clubs: names, home/away kits & real player names
**Model:** Sonnet 5.5 (data research plus UI and protocol changes with a clear spec; it needs web search to get current squads right)

```text
You are working on a browser football game in C:\Projects\Game. Read ROADMAP.md first — follow the architecture and golden rules exactly. You are doing task T24.

Goal: replace the generic team names (Rovers, United…) and kit colour presets in src/teams.ts with the current Premier League clubs, their real home/away kit colours and a 5-a-side squad of real players per club.

Decisions already made (don't change them):
- Real club and player names, but NO crests, badges, logos or sponsor names anywhere — colours and text only. Add a short "Unofficial fan game, not affiliated with the Premier League or any club" note to the README and the title/about screen.
- Clubs are cosmetic only: every club plays identically (no ratings).
- Each club has a fixed squad of 5: 1 goalkeeper + 4 of its best-known outfield players (e.g. 2 defenders/midfielders + 2 attackers), each with their real current shirt number.
- Both players may pick the same club online; colours must never clash (see step 4).

Do the following:
1. Research (use web search; don't rely on memory) the 20 clubs in the Premier League for the CURRENT season as of today, their current home, away and third kit colours, and their current squads. Pick 5 players per club as above. Note the date and the sources you used in a comment at the top of the data file.
2. Put all of this in ONE pure data file, src/data/clubs.ts (no Phaser/DOM), so it's easy to correct by hand or swap to made-up names later. For each club: full name, short name (≤12 chars for the HUD), 3-letter code (e.g. ARS), kits (home/away/third: shirt colour, secondary/outline colour, number colour) and a goalkeeper kit; players: display name (surname, or the name they're known by), shirt number and role (GK/DEF/MID/FWD), mapped onto the game's existing formation slots/roles. Add docs/UPDATING_SQUADS.md explaining how to refresh the data for a new season or transfer window.
3. Club picker (replace the current team picker): browse the 20 clubs, see the 5 players with their numbers, and choose Home / Away / Third kit. Remember the last choice (localStorage, wrapped in try/catch; migrate or reset old saved looks safely). Offline, the AI opponent gets a random different club (or a "choose opponent" option).
4. Kit clash prevention: compute a perceptual colour difference (e.g. CIE76/CIEDE2000 on shirt colours, also checking goalkeeper kits against both outfield kits, and both against the grass green). If the two teams' chosen kits clash, the away team (online: the guest; offline: the AI) is automatically switched to its next non-clashing kit, and the picker shows why ("Kit changed to avoid a colour clash"). Online, the host is the authority; the lobby shows both final kits before the match. If somehow no kit works, fall back to a neutral bib colour.
5. Player names in the game:
   - During the match, players still show their kit number (now the real shirt number).
   - The controlled player's name shows briefly when you switch to them, and in the goal banner/feed ("GOAL! Saka 23'").
   - Stats, the results screen, man of the match, replays/highlights captions and penalty shoot-out takers use player names. The human players' own names (from T21) are still shown as the "manager" of each side.
6. HUD and scoreboard use the club short name/code and kit colours.
7. Network: send only small indices (club index + kit choice) in the protocol, validate them on receipt, and bump the protocol version. Include a hash/version of the clubs data in the handshake so mismatched builds give a clear "please refresh" message.
8. Update the tests (picker data validity: 20 clubs, 5 players each, exactly 1 GK, unique shirt numbers per club, valid colours; clash detection cases including same club home vs away; protocol round-trip), the T18 e2e test and the sim regression if team data is involved. Update How-to-play/README.

Done when: I can choose any current Premier League club and kit, see real player names in stats and man of the match, two players picking clashing colours (or the same club) always end up in clearly different kits, and `npm test`, `npm run build` and the CI e2e tests pass.
Finally, mark T24 as [x] in the ROADMAP.md task queue, add a change log entry, commit and push (this deploys to GitHub Pages).
```

---

### T20 — Xbox / PlayStation controller support
**Model:** Sonnet 5.5 (standard browser API work behind the existing InputFrame abstraction)

```text
You are working on a browser football game in C:\Projects\Game. Read ROADMAP.md first — follow the architecture exactly (input only produces InputFrames; menus read input through the existing scene code). You are doing task T20.

Goal: play everything with an Xbox or PlayStation controller, alongside the keyboard.

Do the following:
1. Read src/settings.ts and src/input/keyboard.ts to see every current action (move, pass, shoot, tackle, sprint, shield, switch, feint via double-tap, quick chat, pause, set-piece aiming, penalty keeper dives, skipping replays). Add src/input/gamepad.ts using the browser Gamepad API with the "standard" mapping. Suggested default layout (Xbox names / PlayStation names):
   - Left stick (and d-pad) = move / aim; flicking the stick twice quickly = feint
   - A / Cross = pass (short throw)
   - X / Square = shoot (hold to charge; long throw)
   - B / Circle = tackle (and keeper dive in penalties)
   - RT / R2 = sprint (analogue trigger: treat past ~30% as held)
   - LT / L2 = shield
   - LB / L1 = switch player
   - D-pad (while not moving with it) or RB / R1 + face button = quick chat
   - Start / Options = pause; any face button skips a replay
   Adjust if something conflicts, and explain your final layout.
2. Analogue movement: stick magnitude scales speed (walk → run) with a configurable dead zone; set-piece, shot and penalty aiming use the stick direction precisely.
3. Keyboard and controller both work at the same time. The most recently used device decides the on-screen prompts (e.g. "Press A" / "Press ✕" vs "Press X key"). Detect Xbox vs PlayStation from the gamepad id where possible; default to Xbox labels.
4. Menus, the club/kit picker, lobby, settings, pause and results screens are fully navigable with the d-pad/stick, A/Cross = confirm and B/Circle = back.
5. Online: the controller just produces InputFrames, so nothing changes in the protocol — confirm the guest's prediction works with analogue movement.
6. Optional rumble (vibration) on kicks, tackles, goals and saves where supported, with a setting to turn it off.
7. Settings: show "Controller connected" with its type, allow rebinding buttons (like the keyboard rebinding), and adjust the dead zone and trigger threshold. Handle a controller being unplugged mid-match (pause offline; online, fall back to the keyboard and show a notice).
8. Update How-to-play with a controller diagram/table and the README.
9. Tests (Vitest) for the pure gamepad → InputFrame mapping: dead zone, normalisation, trigger threshold, feint flick detection, rebinding.

Done when: I can play a full online and offline match, take set pieces and penalties, use quick chat and navigate every menu with an Xbox or PlayStation controller. `npm test`, `npm run build` and the CI tests pass.
Finally, mark T20 as [x] in the ROADMAP.md task queue, add a change log entry, commit and push (this deploys to GitHub Pages).
```

---

## 6. Backlog (after v1)

| # | Idea | Suggested model |
|---|---|---|
| B01 | Pixel-art sprites & animations for players | Sonnet 5.5 |
| B02 | ~~Gamepad support~~ → back in as T20 | — |
| B03 | Mobile touch controls (virtual joystick) | Sonnet 5.5 |
| B04 | 2v2 humans online (more peers, more controlled players per team) | Opus 5.5 |
| B05 | Switch to a Node/Socket.io server if P2P is unreliable (plan: `docs/RELAY_SERVER_OPTION.md`) | Opus 5.5 |
| B06 | ~~Penalty shoot-out after a draw~~ → moved to T19 | — |
| B07 | ~~Replays of goals~~ → moved to T23 | — |
| B08 | Team tactics: Defensive / Balanced / Attacking switch mid-match | Opus 5.5 |
| B09 | Pitch & weather variety (wet pitch = faster ball, night lighting) | Sonnet 5.5 |
| B10 | Mini tournament / league vs AI teams with saved progress | Sonnet 5.5 |

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

- 2026-10-15 — Playtest feedback: added T16 (fix corners), T17 (fairer AI defending, sprint and shield), T18 (CI tests), T19 (fouls, free kicks, penalties, shoot-outs), T20 (gamepad), T21 (online extras), T22 (training mode and tutorial), T23 (goal replays). Backlog B02, B06 and B07 moved into tasks; B08–B10 added.
- 2026-10-15 — Removed T20 (gamepad) and T22 (training mode and tutorial) at the user's request; gamepad dropped from the backlog.
- 2026-10-15 — T16 (game 1.3.1): **corners fixed.** Reproduced first (`tests/corners.test.ts`: kick, body deflection, slide, body check, keeper parry and dive, ball at rest by the line, corner flag — both halves; 17 failed on the old code). Causes: (1) `updateTouches` gave the last touch to whoever was merely *within reach* of a slow ball, so a defender's ball rolling out past an attacker became the attacker's (goal kick / throw-in the wrong way) — removed, only real contacts, kicks, slides, body checks and possession count (`TOUCH_MAX_RELATIVE_SPEED` gone); (2) a body check didn't credit the challenger; (3) every keeper touch was forced back out of the goal, so a save could never go behind — a parry heading behind more than `KEEPER_PARRY_WIDE_MARGIN` outside a post is now a corner; (4) by the corner flag a ball over both lines was called on the touchline — now out when no part is on the pitch, on the line it is heading over more directly. Corners are taken like throw-ins (`pendingHeldRestart`, `takeHeldRestart`): aim with the arrow, pass = low cross, shoot = hard cross (`CORNER_*_SPEED`), auto-cross into the box after 3 s (`cornerTarget`); the AI sends three runners to `AI_CORNER_SPOTS` and its taker waits for two in the box (`RESTART_AUTO_DELAY_CORNER`). F2 overlay: last-touch line (host), stats block moved bottom-left. `npm run simulate` reports corners (range, % in 2-6), goal kicks and goals within 8 s of a corner. AI vs AI corners/match before → after: Arcade 7.5/8.2/10.1 → 8.7/10.8/11.6, Classic 8.6/10.9/11.0 → 8.2/10.2/11.0 (already above the rough 2-6 before: the bug mostly hit humans; most AI corners are defenders chasing a ball to their own line — T17); goals Arcade normal 6.70 → 6.05, 0 stuck. Checked online (host + guest tabs): both show CORNER, the guest's arrow and cross work. Details: `docs/PLAYTEST_NOTES.md` (T16).
- 2026-10-15 — T17 (game 1.4.0, protocol 6): **fairer AI defending, and sprint / shield / feint.** Measured first: `npm run simulate` counts AI tackle duels split by AI vs human carrier, and `--human naive|skilled` plays a scripted human dribbler (`scripts/humanBot.ts`). Before: 97.7% of AI challenges on the human won the ball (172 dispossessions per minute carried) vs 75.5% on AI carriers — a standing body check always won, and slides came without warning. Now, against a human carrier the AI uses the **"AI defending vs humans"** profile (`AI_DEFENDING_VS_HUMAN`, `MatchRules.aiDefending`, Settings: Relaxed / Normal / Tough; Arcade Relaxed, Classic Normal): fewer slide decisions, a little slower, one presser except near its own goal, standing tackles that can fail (`standWin`, then `STAND_TACKLE_COOLDOWN`) and **telegraphed slides** (a 0.2–0.28 s crouch and orange flash, committed to its direction). AI vs AI keeps `AI_DEFENDING_VS_AI` (a wind-up on every slide was tried and took AI-vs-AI goals to ~10). Humans get **sprint** (Shift; stamina in `PlayerState` and snapshots, bigger touches with the ball; switch is now `Z`, saved keys migrated), **shield** (V; slow, ball kept away from the nearest opponent, slides from behind/side win 20%) and a **feint** (double-tap a move key: drag-back and side-step, wrong-foots AI defenders); the AI uses them sparingly, its runners sprint into the box for corners and the cross leads them. New `sim/random.ts` (the seeded PRNG, shared by the AI and the sim's tackle/shield rolls). Network: input bits sprint/shield/feint, snapshots 156 bytes, the guest predicts sprint, stamina, shield and feints. Results (Arcade Relaxed, naive bot): 61.8% of challenges win, 70 per minute carried (skilled bot: 54.8%, 58); AI vs AI goals Arcade 4.85 / 5.05 / 7.08, Classic 3.63 / 4.38 / 5.13, 0 stuck. Tests: `tests/defending.test.ts`. Details and hand-test list: `docs/PLAYTEST_NOTES.md` (T17).
- 2026-10-16 — T18 (game 1.4.1, protocol unchanged at 6): **automatic checks on every push.** `.github/workflows/deploy.yml` now runs on every push and pull request: job `test` (`npm test`, `npm run test:sim`, `npm run build`), job `e2e` (Playwright) and, only for a push to `main` when both are green, `deploy`. **Sim regression** (`npm run test:sim`): `scripts/simulate.ts --check` plays 8 fixed-seed AI-vs-AI matches each for Arcade and Classic and fails (exit 1) if goals, shots, corners, throw-ins, stuck/dead-ball episodes or the longest still spell leave the ranges in the one config file `scripts/simRanges.json`. **Determinism** (`tests/determinism.test.ts`): same seed + inputs give an identical final state, and a whole match runs with `Math.random`/`Date.now`/`performance.now` throwing. **Protocol** (`tests/protocol.test.ts`): a sample of every message type through the wire format (typed as a full `Record<MessageType, Message>`, so a new type needs a sample), plus snapshot/input packets through the base64 `fast` fallback and garbage rejection. **Online smoke test** (`npm run test:e2e`, `e2e/online.spec.ts`): headless Chromium, two contexts, host + join by room code + start + keys on both; checks equal score/half, clocks within 1 s, and no console errors. It uses a local PeerJS server (dev dependency `peer`, `scripts/peerServer.mjs`) because the public broker is shared; the test build (`vite build --mode e2e`, `.env.e2e`) sets `VITE_PEER_*` (broker), `VITE_STUN_URLS=` (no STUN) and `VITE_E2E=1` (`window.__game`); normal builds are unchanged. A deliberately broken rule (corners awarded as goal kicks) failed 26 unit tests and the sim check, then was reverted. Commands documented in README (Tests).
- 2026-10-16 — T19 (game 1.5.0, protocol 7): **fouls, free kicks, penalties and shoot-outs.** New `sim/fouls.ts` (the referee, walls, penalty and shoot-out helpers); `MatchRules` gains `fouls` (Off / Lenient / Strict; Arcade Lenient, Classic Strict, Off = the old game), `cards` (Arcade off, Classic on) and `draws` (Off / Shoot-out / Golden goal; Arcade shoot-out, Classic off), all overridable in Settings and sent with the rules. A slide that hits the player hard before (instead of) the ball, or from behind, is a foul, as is a clearly late challenge; measured first, "any contact before the ball" gave 44 fouls a match, so Lenient only calls clear misses on the player on the ball (`FOUL_PROFILES`), and the AI slides less in its own box and rarely from behind. Free kicks (on the spot, held like a corner, 1-2 player AI wall near goal) and penalties (taker aims left / centre / right, pass = placed, shoot = power; the keeper waits on its line and dives with move + tackle; a human team controls its keeper; the AI takes and saves on difficulty-based odds: a tell and a read chance). Cards: a reckless slide is a yellow, two = sent off for the rest of the half (parked off the pitch). Draws: golden-goal extra time and/or a best-of-5 shoot-out with sudden death and a HUD scoreboard. Network: new restart types, phase `shootout`, events (foul, cards, free kick, penalty, penalty-result, extra time, shoot-out), snapshot fields (shoot-out kicks, per-player cards; 176 bytes), richer stats message; the guest controls its own taker / keeper with no prediction at set pieces. HUD: FOUL! / card banner, cards by the team names, penalty hints and SCORED / SAVED / MISSED, shoot-out board; results: fouls, cards, penalties, shoot-out; a sharper foul whistle. Numbers (AI vs AI, normal): Arcade 3.4 fouls and 6.7 goals a match (holdout 3.2 / 5.5), Classic 10.1 fouls, 2.4 yellows, 5.2 goals. Tests: `tests/fouls.test.ts` (23), a second e2e test (an online penalty, guest taking, host in goal). Details and hand-test list: `docs/PLAYTEST_NOTES.md` (T19).
- 2026-10-16 — T21 (game 1.6.0, protocol 8): **online sessions are more social.** **Names:** typed on the title screen (saved in `settings.playerName`, localStorage in try/catch), cleaned by `sanitizeName` (letters of any script, digits, space, `_ - .`; max 16 characters; markup, quotes, controls and emoji are removed) on entry, in the handshake (`hello.name`, host cleans it and renames a guest who has the host's name) and again on receipt of any lobby; shown in the lobby cards, under the team names in the HUD and in the results. **Quick chat:** keys `1`–`6` send a preset index (`emote` message, never text; `Digit1-6` and `M` are now reserved keys); `net/chat.ts` rate-limits both ways (`EMOTE_MIN_GAP_MS` between messages, `EMOTE_MAX_PER_WINDOW` per `EMOTE_WINDOW_MS`, so a modified client can't flood), shows a bubble above the sender's controlled player (3 s) and a small feed bottom-left; `M` or Settings → Online quick chat mutes the other player's (yours still show to you). **Series:** `LobbyState.series` (host wins / guest wins / draws, by player, so swapping teams doesn't matter; a shoot-out winner counts) is updated by the host once at full time and sent to the guest; shown on the results screen and in the lobby, with **Reset series** (either player). New results button **Back to lobby** (either player; `lobby-back` message): the same connection returns to the lobby with names, kits and series kept and ready cleared, so several matches in a row don't need a new room. **Man of the match:** new `sim/playerStats.ts` watches each tick's changes (shot count up = shot; a keeper touch while an opponent's shot is live = save; the carrier's ball taken by an opponent = tackle won; a goal plus the previous toucher on the same side within `ASSIST_WINDOW` s = assist, never from own goals or penalties) into `stats.players` (per player) and `stats.humans` (per team's human, only while they controlled that player); points `MVP_POINTS` (goal 5, assist 3, save 2, tackle 1, shot 0.25; a tie goes to the winning side, then the lower id). The results screen shows the MVP with their stat line and one line per named human. **Reconnect:** the guest puts `?room=CODE` in the URL and the code and match token in sessionStorage; on a refresh the title screen sees them (under `SESSION_REJOIN_MS`) and goes straight to the lobby scene, which rejoins (retrying a few times, as the host may not have seen the old connection close); in a match it sends `rejoin` with the token and the host puts it back into the running match (the page closing in a match no longer sends `bye`, so the host holds the match for `NET_RECONNECT_WINDOW_MS` — closing the tab for good is noticed after the silence timeout instead of at once). Tests: `tests/social.test.ts` (29: name sanitising, limiter, series counting, MVP, the stat tracker incl. a whole simulated match), protocol round trips for the new messages, and `e2e/social.spec.ts` (two browsers: names, chat bubbles/feed/mute, two matches with series 1–0 then 1–1, MVP and stat lines, back to lobby, reset series, and a guest refresh in the lobby and in a match).
- 2026-10-16 — T23 (game 1.7.0, protocol 9): **goal replays and full-time highlights.** New pure `net/replay.ts`: `ReplayRing` keeps the last `REPLAY_BUFFER_SECONDS` (6.5 s) of **encoded binary snapshots** (the T07 wire format, one every `NET_SNAPSHOT_INTERVAL_TICKS`) in one preallocated slab (~34 KB for 5-a-side; frames copied out on read, out-of-order ticks refused); `Replays` cuts a clip around each goal (5 s build-up, 1 s after) and each **big save** (new sim event `save`: a keeper save of a shot at `BIG_SAVE_SPEED`+, pushed by `trackStats`), and plays one into a `structuredClone` of the match state with no events (so nothing fires twice). The live `GameState` is never touched: MatchScene just draws the replay's state while it runs. Timing (`replayTiming`/`replayTickAt`): normal speed, then the last `REPLAY_SLOWMO_SECONDS` before the goal and 0.3 s after it at `REPLAY_SLOWMO_SPEED` (0.35×); a clip starts after the previous dead-ball spell, so a quick goal doesn't replay the last one. The host records the snapshots it encodes (offline too), the guest the ones it receives (same clips from its own buffer, no extra bandwidth). **Flow:** the replay starts as the 2 s goal pause ends; `HostMatch` doesn't step the sim while it plays, so the clock is still and the kickoff waits; snapshots keep flowing at the frozen tick, as in a pause. **Online, one shared replay:** the host sends `replay {on, moment}` (reliable), the guest plays the same goal and holds its live view, and either player pressing a key ends it for both (`replay-skip`); a guest with replays Off skips at once. Chosen because the kickoff has to wait for the replay anyway: watching independently would leave one player staring at a frozen pitch while the other watches, or one player's skip would restart play under the other's replay. Full-time **highlights** (every goal, plus big saves not already in a goal's build-up, in match order, capped at `REPLAY_MAX_CLIPS`) run per player after the final whistle, before the results; a key skips the reel. The camera follows the ball at `REPLAY_CAMERA_ZOOM` whatever the camera setting; HUD: a red REPLAY / HIGHLIGHTS n/m tag, SLOW MOTION, what and when ("GOAL — Rovers · 1st half 00:43"), a progress bar and the skip hint, with the live match's banners hidden meanwhile. New setting **Replays**: Off / Goals only / Goals + full-time highlights (default). A guest that rejoins mid-replay is told about it. Tests: `tests/replay.test.ts` (17: ring buffer order, wrap, copies, growth and size; timing and slow motion; clip trimming; highlight reel; the offline host holding the clock and kickoff, skip, replays off, highlights; a guest's lossy, out-of-order recording), protocol samples, and `e2e/replay.spec.ts` (two browsers: the replay on both, host held, the guest skips for both, a replay that plays out, full-time highlights of both goals skipped separately, then the results).
- 2026-10-16 — Added T24 (Premier League clubs, home/away/third kits with clash prevention, real player names; no crests or logos; clubs cosmetic only; fixed 5-player squads; same club allowed in home vs away) and brought back T20 (Xbox/PlayStation controller support, covering sprint, shield, quick chat, set pieces and penalties). Run T24 first.
- 2026-10-16 — T24 (game 1.8.0, protocol 10): **Premier League clubs, kits and real players.** New pure data file `src/data/clubs.ts`: the 20 clubs of 2026-27 (researched 2026-10-16: squads from Wikipedia club/season pages and club announcements, kits from footyheadlines, footballfashion, goal.com and club launch pages; the sources and the caveats are in the file's header comment). Each club: full name, short name (≤12 chars), code, home/away/third kit (shirt, trim, number colour), a goalkeeper kit and a fixed squad of 5 in the formation slots (GK, two DEF/MID in the back slots, two FWD in the front slots) with real shirt numbers. **All colour values are estimates** (no source gave exact hex values) and several third and goalkeeper kits are leaks or stand-ins; the data is meant to be corrected by hand (`docs/UPDATING_SQUADS.md`). Clubs are cosmetic (the sim is untouched: the sim's `number` is still slot+1 and the renderer maps slot -> real player, so the sim regression and snapshots did not change). No crests, badges, logos or sponsors; "Unofficial fan game, not affiliated with the Premier League or any club" is on the title screen, the picker, How to play and the README. **Look** is now `{club, kit}` (kit 0/1/2 = home/away/third, 3-5 plain bibs as the last resort); old saved `{name, kit}` looks fail validation and reset to the default. **Clash prevention** (`teams.ts`): CIEDE2000 on shirt colours (`KIT_CLASH_DELTA_E` 22, grass `KIT_GRASS_DELTA_E` 16, in `config.ts`); the host's kit stays (unless it vanishes into the grass: Everton's green third), the guest (offline: the AI) moves to its next non-clashing kit, same club included; goalkeepers are checked against both outfield shirts, each other and the grass and fall back to a neutral shirt colour; an exhaustive test covers all 3,600 club/kit pairings (no bibs were needed). The host keeps what each player asked for (`guestWanted`) so a clash that goes away moves the guest back; `LobbyState.changed` tells both lobbies, which show both final kits and "Kit changed to avoid a colour clash". **Club picker** replaces the team picker: club and kit rows with the squad line-up (names and numbers) in the kit; offline an opponent row (random club, or choose). **Names in the game:** real shirt numbers on the pitch, the controlled player's name for `SWITCH_NAME_SECONDS` after a switch, "Saka 23' · Arsenal" in the goal banner (the football minute stretches the halves over 90), replay captions, card banners, penalty takers and results, man of the match and goals list; the T21 human names are shown as "Manager …". HUD/scoreboard/lobby use the club short name and kit colours. **Network:** protocol 10; the lobby/`look` messages carry only club and kit indices, validated on receipt (range, integer); the hash of the clubs data (`clubsHash()`) goes in `hello` (optional field, so `hello` keeps its shape) and `welcome`, and a mismatch (also a new `clubs` reject reason) gives a "please refresh" message. Tests: `tests/clubs.test.ts` (data validity, colour maths, clash cases incl. same club home v home, protocol), updated menus/net/protocol tests; the e2e tests now have both players pick the same club and kit and check the lobbies agree on the settled kits.

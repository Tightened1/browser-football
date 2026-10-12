# Network testing & TURN relay set-up

Online play is peer-to-peer (WebRTC via PeerJS). The PeerJS broker only introduces the two browsers. After that, game data goes **directly** between them, or through a **TURN relay** when a direct route is blocked (strict work/school networks, some mobile data).

- **Menu → Test my connection** checks this network. Each player should run it. **Copy report** gives a text version to send to each other (it leaves out IP addresses).
- **In the lobby**, the other player's card shows `Connection: Direct (…)` or `Connection: Relayed (…)`.
- **In a match**, press **F3** for the network overlay, including `route`.

---

## 1. Set up the TURN relay (one-off, you do this)

Without a relay, players behind strict networks can't connect. The test screen warns "No relay server is configured".

### Recommended: Metered (free plan, no server needed)

1. Sign up at <https://dashboard.metered.ca/signup?tool=turnserver> (email only).
2. Note your **app name**: your dashboard lives at `https://<app>.metered.live`.
3. Go to **TURN Server → Credentials**, create a credential and copy its **API key**.
   - This is the *credential* API key. **Do not** use the account **Secret Key** anywhere in the game.
4. Your credentials URL is:
   ```
   https://<app>.metered.live/api/v1/turn/credentials?apiKey=<that API key>
   ```
   Open it in a browser. It should return a JSON list containing `turn:` URLs.
5. In the dashboard, set the usage/quota action to **block** (not pay for overage), if offered.

Free allowance: Metered's pricing page lists the free plan as **500 MB/month**, but their Open Relay page says **20 GB/month**. Check the dashboard for your figure. A fully relayed match uses roughly 10–20 KB/s, about 36–72 MB per hour, and most games connect directly and use none of it.

### Alternative: Cloudflare Realtime TURN (1,000 GB/month free, needs a tiny Worker)

Cloudflare's API token must never be in the game's code, so a free **Cloudflare Worker** has to hand out short-lived credentials:

1. In the Cloudflare dashboard, go to **Realtime → TURN Server → Create**. Copy the **TURN Key ID** and **API Token**.
2. Create a Worker. Add the two values as secrets named `TURN_KEY_ID` and `TURN_KEY_API_TOKEN`. The Worker's code is sketched below; it is not tested.
   ```js
   export default {
     async fetch(req, env) {
       const origin = req.headers.get('Origin') ?? '';
       const allowed = origin === 'https://tightened1.github.io' || origin.startsWith('http://localhost');
       if (!allowed) return new Response('forbidden', { status: 403 });
       const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
         method: 'POST',
         headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
         body: JSON.stringify({ ttl: 3600 }),
       });
       return new Response(await r.text(), { status: r.status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin } });
     },
   };
   ```
3. Your credentials URL is the Worker's address, e.g. `https://turn-creds.<you>.workers.dev`.

### Put the URL into the game

The game reads it at **build time**, so it never goes into git:

- **Live site:** on GitHub, go to the repo → **Settings → Secrets and variables → Actions → New repository secret**.
  - Name: `VITE_TURN_CREDENTIALS_URL`. Value: the URL from above.
  - Then re-run the deploy: push, or **Actions → Deploy → Run workflow**.
- **Local dev:** copy `.env.example` to `.env.local` (git-ignored), fill in the same line, and restart `npm run dev`.

Fixed username/password credentials also work: set `VITE_TURN_URLS`, `VITE_TURN_USERNAME` and `VITE_TURN_CREDENTIAL` instead. See `.env.example` and the comment in `src/config.ts`.

**Check it worked:** on **Test my connection**, the "Relay address" and "Relay test" rows should both be green.

### Credentials in a static site: the trade-off

Anything a static site uses ends up in the JavaScript that every visitor downloads. A GitHub secret keeps the key out of the **repo**, but not out of the **published page**. So assume anyone can find your relay credentials.

| Approach | Risk | Verdict |
|---|---|---|
| Account secret key / Cloudflare API token in the page | Full control of your account, or unlimited credential minting | **Never** |
| Fixed TURN username/password in the page | Anyone can relay through your quota indefinitely. Rotating means rebuilding. | OK for testing only |
| **Metered credential API key in the page** (recommended) | Someone could use up your free quota. They can't touch your account. Metered documents this key as safe for front-end use. | **Best practical option for us**: no server, no card, worst case the relay stops until next month |
| Your own Worker minting 1-hour credentials | Stolen credentials expire quickly. Someone could still call the Worker itself (Origin checks only stop casual reuse). | Safest, but adds a server to maintain |

If abuse ever happens, delete that credential in the Metered dashboard, create a new one, and update the secret.

---

## 2. How the fallback works

1. Both browsers gather routes: local (`host`), public via STUN (`srflx`), and relay via TURN (`relay`).
2. WebRTC tries them all at once and **prefers direct**. If direct routes fail, the relay usually takes over within that same attempt.
3. If the whole attempt still fails (after `NET_DIRECT_ATTEMPT_TIMEOUT_MS`, 10 s), the guest **retries once, relay only**. The lobby shows "No direct route to the host — retrying through the relay server…". The host accepts the retry in place of the failed attempt, and mid-match reconnects also stay on the relay.
4. If that fails too, the error says so plainly: "Couldn't connect to the host, not even through the relay server."

With no relay configured, step 3 is skipped and the usual "Couldn't connect" error appears, with a pointer to the test screen.

---

## 3. Test checklist (do these with a friend)

For each row: both run **Test my connection** first, then host/join, play a minute, and note what the lobby's `Connection:` line says. Press F3 in the match to see ping and route.

| # | Setup | Expected | ✔ / notes |
|---|---|---|---|
| 1 | **Same machine**, two browser windows (`npm run dev` or the live site) | Connects in a few seconds · `Direct (same network, UDP)` · ping < 5 ms | |
| 2 | **Same Wi-Fi**, two devices | `Direct (same network…)` · ping < 20 ms | |
| 3 | **Different networks**: you on home broadband, friend on a **phone hotspot** | `Direct (over the internet…)` in most cases; `Relayed` is fine too · ping roughly 30–120 ms | |
| 4 | **Corporate / school network** on one side | Test screen: matchmaking server ✔, public address probably ✖ or ! · lobby: `Relayed (…TCP/TLS)` | |
| 5 | **Corporate network, no relay configured** (remove the secret, or test before adding it) | Test screen says online play is unlikely · joining fails with a clear "Couldn't connect" message and the hint | |
| 6 | **Drop and recover**: in a match, turn the guest's Wi-Fi off for ~5 s, then on | Both pause, then "Resuming in 2…"; same route as before (relayed stays relayed) | |
| 7 | **Leave**: the host closes the tab mid-match | Guest sees "The host left" straight away | |

What to send back if something fails: both players' **Copy report** text, which row failed, and a screenshot of the lobby/error.

**Reading the test screen:**

- ✖ Matchmaking server: the PeerJS broker is blocked. No P2P option helps here. See `docs/RELAY_SERVER_OPTION.md`.
- ✖ Public address and no relay: direct is impossible from that network. Add TURN.
- ✖ Relay address with "wrong or expired": the keys are bad. Recreate the credential and update the secret.
- ✖ Relay address with "could not be reached": the network blocks even TURN over TCP/TLS on port 443. Rare, and only the server option would help.

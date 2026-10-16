# Updating the clubs and squads (new season / transfer window)

All club, kit and player data lives in **one pure file**: [`src/data/clubs.ts`](../src/data/clubs.ts) (no Phaser, no DOM). Nothing else needs editing for a normal refresh. Clubs are cosmetic (every club plays identically), and there are **no crests, badges, logos or sponsor names** anywhere: only colours and text. Keep it that way.

## What is in a club

```ts
{ name: 'Arsenal', short: 'Arsenal', code: 'ARS',
  kits: [home, away, third],            // k(shirt, trim, number) as 0xRRGGBB
  gk: k(...),                           // goalkeeper kit
  players: [GK, back, back, front, front] }  // p(role, 'Name', shirtNumber)
```

- `short` is shown in the HUD: at most 12 characters. `code` is three capital letters.
- `players` has exactly 5 entries in the game's formation slots: `[0]` the goalkeeper, `[1]` and `[2]` the back line (role `DEF` or `MID`), `[3]` and `[4]` the front line (`FWD`). Use the surname, or the name the player is known by, and their **current shirt number** (unique within the club).
- Colours are estimates from the kit descriptions; nothing needs to be exact, but a kit should read as the right colour on the pitch (shirt) with a contrasting trim and number colour.

## Refreshing for a new season

1. **Clubs.** Look up the Premier League clubs for the season (promotion and relegation changes three). Replace the relegated clubs' entries with the promoted ones; the array should stay at 20 clubs, in any order (alphabetical is tidy). The order is the club's index on the network, so **both players must run the same build** (the game checks this: a hash of this file goes in the handshake and a mismatch asks the player to refresh).
2. **Kits.** Check each club's home, away and third kit for the season (club sites, the Premier League site, kit-launch articles such as footyheadlines.com) and set shirt / trim / number colours. Goalkeeper kits are rarely announced early: a plausible colour is fine (the game picks a different keeper shirt on the fly if it would clash).
3. **Squads.** Check the first-team squad pages (the club's site, Wikipedia, Transfermarkt) after the window closes: the first-choice keeper, two defenders or midfielders and two forwards, with their current numbers. Remember numbers change in the summer.
4. **Header comment.** Update the date and the sources at the top of `clubs.ts` (`CLUBS_SEASON`, `CLUBS_RESEARCHED`).
5. **Check it.** Run `npm test`: `tests/clubs.test.ts` verifies 20 clubs, 5 players each with exactly one goalkeeper, unique shirt numbers per club, valid colours and that every pair of clubs and kits ends up clearly different (it also checks the goalkeepers and the grass). If a new kit makes a club unusable against everything else, the test names it.
6. Bump the version in `package.json` (a changed file means a changed network protocol view: players on an old build get a "please refresh" message).

## After a transfer window only

Just edit the affected `players` entries (name and number). No other file changes.

## Using made-up names instead

To make the game fully fictional, replace `name`, `short`, `code` and the player names in `clubs.ts` (keep the structure and the tests will still pass). The rest of the game only reads this file.

## How kit clashes are decided

`src/teams.ts` compares shirt colours with CIEDE2000 (`deltaE2000`). Two shirts closer than `KIT_CLASH_DELTA_E`, or a shirt closer than `KIT_GRASS_DELTA_E` to the pitch green, count as a clash (both in `src/config.ts`). The host's kit stays; the guest (offline: the AI) is moved to its next non-clashing kit (home, away, third, then a plain bib as a last resort). Goalkeepers are checked against both outfield kits, the other keeper and the grass, and use a fallback colour when their club's own would clash.

# Playtest notes (T11, game 0.11.0)

How the match was measured, what was wrong, what changed, and what to feel-test by hand.

## 1. How to measure

```bash
npm run simulate                                   # 40 AI-vs-AI matches at easy, normal and hard
npm run simulate -- --matches 100 --seed 7         # more matches / another seed
npm run simulate -- --difficulty normal --half 180 # one difficulty (a half is 180 s = a 6-minute match)
npm run probe                                      # keeper exploit probe (see section 4)
```

`scripts/simulate.ts` plays whole matches with the pure `sim/` code (no Phaser, no DOM): it is bundled with rolldown
(already installed by Vite) and run by Node, ~1.5 s per match. Same seed = same result. It reports goals, shots, keeper
saves, possession, out-of-play counts and two stalemate detectors:

* **stuck ball**: in open play the ball stays within 45 px of one spot for 6 s;
* **dead ball**: the ball moves slower than 12 px/s for 3 s with no set piece pending.

A seed that gets stuck is printed, so it can be replayed.

## 2. Before and after

Same script, same seeds (60 matches per row, seed 1, 2 x 3 minutes, both teams the same difficulty). "Before" is the
code at commit `fd97af9` run through the new script.

| Normal difficulty | Before | After | Target |
|---|---|---|---|
| Goals per match | 3.07 | **3.88** | 3-6 |
| Matches with 3-6 goals | 52% | **73%** | |
| Goalless matches | 6.7% | 1.7% | few |
| Shots per match (shoot-button kicks at goal) | 9.0 | 22.3 | |
| Keeper saves per match / save rate | 2.9 / 49% | 6.8 / 64% | some, not all |
| Goals that are own goals | 2.25 per match (73% of goals!) | 1.15 (30%) | |
| Home possession | 49.9% | 50.1% | about 50% |
| Throw-ins per match | **632** | 91 | |
| Balls out of play per match (throw-ins + goal kicks + corners) | **736** | 125 | |
| Stuck ball | none seen (hidden by the throw-in loop) | none | none |

| Per difficulty (after) | Goals / match | Saves / match | Save rate | Own goals | Stuck |
|---|---|---|---|---|---|
| Easy | 2.47 | 4.7 | 65% | 0.60 | 0 / 60 |
| Normal | 3.88 | 6.8 | 64% | 1.15 | 0 / 60 |
| Hard | 3.53 | 6.3 | 64% | 0.87 | 0 / 60 |

A second, untouched seed (seed 7, 100 matches, none of it used while tuning) gave Normal 3.58 goals, 65% of matches
in 3-6, 63% saves, 0 stuck; Easy 2.62; Hard 3.76. So the result is not tuned to one seed. Hard scoring about as much
as Normal is expected: Hard has better attackers *and* better keepers and defenders.

Targets met: goals 3-6 at Normal, no stalemates, the keepers save most but not all shots.

## 3. What was wrong and what changed

These were bugs, not balance, and they were the biggest effect on the numbers.

1. **Throw-in / corner loop (the big one).** The taker was placed on the pitch side of the ball facing the touchline, so
   the first touch kicked the ball straight back out and every throw-in started another one: ~630 throw-ins in a
   6-minute AI match, and a human taker had to turn round first. Now the ball is spotted 40 px in (`RESTART_INSET`) and
   the taker stands on the line side of it, facing into the pitch (`rules.ts setRestart`). Corners the same.
2. **"Last touch" was far too generous** (`control.ts updateTouches`): anyone within reach of a ball *flying past* got
   the touch. That made keepers and defenders "touch" shots they never reached, so goals were scored as own goals,
   *throw-ins and corners went to the wrong team*, and possession was off. Now a touch needs a real contact (or kick,
   or a ball nearly at rest next to you, `TOUCH_MAX_RELATIVE_SPEED`).
3. **Stalemate in the corner pocket.** A ball rolling to rest just outside the pitch corner (centre less than a ball
   radius over both lines) counted as neither out of play nor reachable (players are kept inside the lines): it sat
   there for 93 s. A ball at rest with its centre beyond a line is now out (`OUT_REST_SPEED`).
4. **AI own goals.** Defenders ran straight at a loose ball between them and their own goal and nudged it in; the AI
   walked into the ball when lining up behind it; a keeper's walk onto a held ball punched it away. Now: chasers near
   their own goal swing round to the goal side (`AI_OWN_GOAL_DANGER`), lining up behind the ball routes around it
   (`routeAroundBall`), a ball in the goal mouth is the keeper's and upfield defenders don't chase it
   (`AI_GOAL_MOUTH_DEPTH`), and the keeper stops next to a ball instead of walking into it. Own goals went from 73% of
   goals to about 30%; the rest are real deflections.
5. **Tackle spam.** Slides had one 0.9 s cooldown whether or not they won the ball, so holding a rhythm of slides
   was almost free. Now a slide that misses costs `TACKLE_COOLDOWN` = 1.3 s, one that connects with the ball is
   forgiven down to `TACKLE_HIT_COOLDOWN` = 0.5 s, and the keeper's dive keeps its own 0.9 s (`KEEPER_DIVE_COOLDOWN`).
6. **Unsaveable corner shots.** The shot probe (section 4) showed that from the edge of the box a placed shot into
   either top/bottom corner scored 100% even at half charge. Normal keepers now react in 0.10 s (was 0.15) and
   misjudge the line by up to 28 px (was 20); Hard reacts in 0.07 s (was 0.10). Half-charge corner shots from the box
   edge now score about half the time (45-50%); full-charge ones into the corner still always score (a telegraphed 0.8 s
   charge from 150 px is faster than any keeper can move, which is fair).
7. **Keeper rebounds.** After touching a ball the keeper pushes it away at `KEEPER_CLEAR_SPEED` 240 (was 140), so a
   save is less likely to dribble back into the net or to a defender in front of goal.

Everything else in `config.ts` (speeds, friction, kick power, AI reaction) was left alone: once the bugs were out the
targets were met, and changing feel values that a hand-test hasn't asked for just adds risk.

Tests added or updated: restart placement, corner-pocket restart, last-touch rule, tackle cooldown, goal-mouth AI,
chaser approach, keeper tests that assumed the old slow rebound.

### Known and left alone

* Balls still go out about every 3 s at Normal (~90 throw-ins, 19 goal kicks, 15 corners a match). Restarts take under
  a second (the AI takes them at once), so ~351 of 360 s is open play, but it is a stop-start game. It is mostly
  pressers squeezing carriers against the touchline. Poking those balls inwards made no measurable difference, so
  I reverted it. If it feels fiddly, the lever is a wider `AI_EDGE_MARGIN` for passes or a longer `RESTART_INSET`.
* About 0.5 goals a match are scored within 8 s of a kick-off. That is a quick counter, not a kick-off exploit (the
  opposition is held out of the centre circle until the ball is played).

## 4. Shot probe (exploit check)

`npm run probe` (`scripts/shotprobe.ts`): one human shooter vs the AI keeper only, 20 seeds, from six spots at the top
corner, centre and low corner, full and half charge. Findings after the changes:

* A shot straight down the middle from the centre spot is always saved; from 25% out the keeper misjudges the line
  now and then (about 40% of full-power centre shots score there, 25-50% of corner shots).
* From the box edge, full-charge corner shots always score; half-charge ones score about half the time (was 100%).
* From the wide box position and tight angles nothing scores at all. Not an exploit, but see the feel-test list.
* On the byline, a full-power low-corner shot scores about half the time: the only odd spot, worth a hand check.

Try a tuning without editing files: `node .sim/shotprobe.mjs normal <keeperReaction> <keeperSpeed> <keeperError>`.

## 5. Please feel-test these by hand

Each is something the simulation can't judge. Rough pass/fail in brackets.

**Shooting and passing**
1. Does a fully charged shot (hold 0.8 s) feel powerful enough? It leaves at 1150 px/s. Is the charge time right, and is
   the power bar easy to read? [`SHOT_MAX_SPEED`, `SHOT_MAX_CHARGE_TIME`]
2. Does a tap-pass reach a teammate 300-400 px away without feeling floaty or too weak? [`PASS_SPEED` 450]
3. Can you score a placed shot into the corner from just outside the box, and do you sometimes get saved? (Half-charge
   shots from the box edge score about half the time.) Does it feel fair rather than random? [`AI_PROFILES.normal.keeperReaction/keeperError`]
4. Is it too hard to score from tight angles near the byline?

**Dribbling and tackling**
5. Does running with the ball feel controllable (not glued, not lost every second touch)? [`DRIBBLE_BOOST`,
   `DRIBBLE_TOUCH_INTERVAL`]
6. Slide tackle: a miss now costs 1.3 s before you can slide again, a hit only 0.5 s. Does a miss feel like a fair
   penalty, or is it frustrating? Does a slide ever feel useless against the AI? [`TACKLE_COOLDOWN`,
   `TACKLE_HIT_COOLDOWN`]
7. Can you still win the ball by running into the carrier (no slide), or is sliding the only way?

**Set pieces**
8. Throw-ins and corners: the ball is now 40 px inside the line with you on the line side facing in. Does the taker
   stand where you expect, and is a tap-pass straight into play? Does the 1 s auto-release feel too fast or slow?
   [`RESTART_INSET`, `RESTART_AUTO_DELAY`]
9. Goal kicks: does the keeper's goal kick go somewhere useful?

**Keepers**
10. Does the keeper block shots at the body but sometimes get beaten at the corners? Do rebounds feel natural (they now
    leave at least 240 px/s)? [`KEEPER_CLEAR_SPEED`]
11. Does the keeper ever stand still next to a loose ball in front of goal, or leave it for you? (The AI keeper now
    rushes anything in the goal mouth.)

**AI and flow**
12. Do the AI teammates pass to you and run into space, or do they bunch? Do they clear the ball from their own goal
    sensibly?
13. Easy, Normal and Hard: is the step between them noticeable? (By the numbers Easy scores ~2.5 a match, Normal ~3.7,
    Hard similar to Normal but with a tighter defence and keeper.)
14. Is there too much stop-start? ~90 throw-ins per 6 minutes in AI-vs-AI.
15. Online: is the host's tackle / shot response the same as offline? (Nothing netcode-side changed; the sim is the
    host's, so rules, AI and cooldowns reach the guest automatically, but the guest's slide feels one round trip late.)

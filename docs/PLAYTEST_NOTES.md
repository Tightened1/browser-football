# Playtest notes (T11, game 0.11.0; T13, game 1.1.0 at the end)

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

---

# T13: sticky dribbling and shooting (game 1.1.0)

## 1. Why shots "did nothing"

Checked before changing anything. In order of how much they mattered:

1. **The dribbled ball was out of reach on release (the main cause).** A shot fired only on the frame shoot was
   released and only if the ball was within `KICK_REACH` (8 px) right then. The classic dribble pushes the ball up to
   ~50 px ahead between touches, so most releases mid-run found it out of reach: the shot was silently dropped and the
   charge reset.
2. **Online: a quick shoot tap could vanish on the host.** When guest inputs back up, the host merges queued frames
   (`mergeInputs`). Pass, tackle and switch were kept from either frame, but shoot came from the newer frame only, so a
   one-frame tap lost its press *and* its release. Fixed: shoot is merged too (the release then comes one frame later).
   On top of that the guest's inputs reach the host ~RTT/2 late, by which time the free-running ball had usually moved.
3. **A Space held over from a menu.** `Focus` presses a button on keydown; if Space was still held when the match
   started, its auto-repeat was taken as a new press, so letting go was a stray kick attempt. Auto-repeats of a key the
   match never saw go down are now ignored (`input/keyboard.ts`).
4. Checked and fine: set pieces put the taker in reach (2 px gap); the charge bar already showed off the ball (it still
   does); the pause and results screens blank the input on purpose.

## 2. What changed

* **Sticky dribbling** (`sim/dribble.ts`, `DRIBBLE_MODE = 'sticky'`; `'classic'` restores T02). A player who touches a
  loose ball slowly enough (`DRIBBLE_CONTROL_SPEED` 280 px/s relative, `DRIBBLE_PASS_CONTROL_SPEED` 900 for a
  teammate's pass) takes it: `GameState.possession` = carrier, angle, roll. The ball sits `DRIBBLE_HOLD_GAP` in front,
  swings round with the facing at `DRIBBLE_TURN_RATE` (no teleport) and rolls `DRIBBLE_ROLL_AMPLITUDE` out and back
  every `DRIBBLE_ROLL_PERIOD` px run. Carriers run at `DRIBBLE_SPEED_FACTOR` (90%). It is lost to a slide that reaches
  it, an opponent touching it from the front (`DRIBBLE_CHECK_REACH` / `DRIBBLE_CHECK_CONE`; from behind the body
  shields it), any kick, and a U-turn at full speed (`DRIBBLE_SHARP_TURN_*`, can be switched off). Control follows the
  ball to whichever teammate carries it.
* **Kick buffer** (`KICK_BUFFER_TIME` 0.25 s): a pass press or shot release that can't kick yet is queued and fires the
  moment the player can. From possession a kick always fires. Kicks go where the move keys point at release (else the
  facing), and the ball passes through the kicker's own body for `KICK_FLASH_TIME`, so a kick behind you works.
* **Cues:** amber ring + arrow and a soft tick while a kick is queued, a white burst and the kick sound when it fires,
  a dull swish if it expires (`audio/cues.ts KickCueWatcher`).
* **Keepers catch** in their box (`KEEPER_CATCH_SPEED` 850): they hold catchable shots, can't be tackled while holding,
  and distribute; harder shots are still parried. Without this, attackers trapped every rebound and a third of all shots
  came within a second of a save.
* **AI** (`sim/ai.ts`): carriers just run (turns are staged so they never lose the ball on a U-turn), shield by steering
  the ball away from opponents, kick from possession without lining up, strike quickly under pressure
  (`AI_QUICK_SHOT_CHARGE`), and kick set pieces rather than carry them. Pressers step in to the ball when goal-side and
  close (`AI_PRESS_ENGAGE`); a ball held by a keeper is left alone.
* **Online:** the snapshot carries possession and the queued/kicked flags (146 bytes, protocol 4). The guest predicts the
  ball its own player carries (same rules as the host, replayed from the host's possession), launches its own kicks at
  once and hands them over to the host's ball by winding the prediction lead down at half speed (never backwards).
  Whatever the host says wins: the drawn ball eases to the host's (`NET_BALL_CORRECTION_SNAP`). Tested headlessly in
  `tests/guestPrediction.test.ts` with 100 ms one way and 3% snapshot loss.

## 3. Before and after (AI vs AI, 40 matches each, seed 1, 2 x 3 min)

| | Before (1.0.0) | Sticky, old tuning (20 matches) | **After (1.1.0)** | Target |
|---|---|---|---|---|
| Normal: goals per match | 3.55 | 11.35 | **5.08** | 3-6 |
| Normal: matches with 3-6 goals | 75% | 5% | **65%** | |
| Normal: shots / saves / save rate | 22.6 / 6.5 / 65% | 51 / 22 / 66% | 35 / 18.6 / 79% | |
| Easy goals | 2.83 | | 4.67 | |
| Hard goals | 3.73 | | 5.63 | |
| Stuck or dead ball, any level | 0 | 0 | **0** | none |

Holdout (seed 7, not used while tuning): Normal 4.97 goals, 70% of matches in 3-6, 0 stuck.

Tuning that got there, biggest effect first: keepers catch; two pressers on every level (Easy/Normal were one) with
higher tackle chances (Easy 0.55, Normal 0.7, Hard 0.8); lower loose-ball control speed (430 -> 280, so rebounds and
deflections aren't trapped); keepers move a little faster to a shot (Easy 0.6, Normal 0.75, Hard 0.85). Easy now scores
more than before: its attackers can finally keep the ball. Normal sits at the top half of the target range; if hand
tests say it's too open, `AI_PROFILES.normal.keeperSpeed` and `tackleChance` are the levers.

The shot probe (`npm run probe`) is unchanged from the box edge (full-power corner shots always score, half-charge
about half); from the centre spot full-power shots now score 15-20% (40-45% with the old keeper speed), because keepers get across faster.

## 4. Please feel-test these by hand (T13)

1. Run the length of the pitch with the ball, weave and do 90° turns: does it feel in control, and does the ball look
   like it rolls rather than being glued? [`DRIBBLE_HOLD_GAP`, `DRIBBLE_ROLL_*`, `DRIBBLE_TURN_RATE`]
2. Every shoot release and pass press should do something: a kick, the amber "waiting" ring then a kick, or the swish.
   Is there ever a silent press?
3. Run right, hold up, release shoot: does the ball go up as you expect? [aim from the move keys]
4. Is 90% running speed with the ball noticeable but fair? [`DRIBBLE_SPEED_FACTOR`]
5. Does losing the ball on a full-speed U-turn feel fair, or annoying? Turn it off with `DRIBBLE_SHARP_TURN_LOSS`.
6. Can you win the ball by running into the carrier from the front, and does it feel unfair when the AI does it to
   you? Can you shield it by turning your back? [`DRIBBLE_CHECK_REACH`, `DRIBBLE_CHECK_CONE`]
7. Receiving: do teammates' passes stick, and do hard shots bounce off you? [`DRIBBLE_CONTROL_SPEED`, `DRIBBLE_PASS_CONTROL_SPEED`]
8. Keepers now catch most shots below ~850 px/s: still possible to score with placed half-power shots? [`KEEPER_CATCH_SPEED`]
9. Online, as the guest with `?lag=50` (100 ms ping) and `?lag=100&loss=0.03`: does dribbling feel like offline, does a
   shot leave your foot immediately, and when you're tackled does the ball move to the host's version smoothly?

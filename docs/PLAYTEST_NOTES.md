# Playtest notes (T11, game 0.11.0; T13, game 1.1.0; T14, game 1.2.0; T15, game 1.3.0 at the end)

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

# T14: throw-ins and touchlines (game 1.2.0)

Feedback: "When it's a throw-in, half the time one of us walks it straight back off the pitch, so the other person gets
a throw-in."

## 1. Cause (confirmed with failing tests first)

* Nothing stopped a ball held by a sticky dribbler from crossing a line: holding a direction into the touchline carried
  the ball (sitting ~27 px in front of the player) wholly over it while the player was still on the pitch.
* At a throw-in the taker could simply walk onto the ball, take possession and carry it anywhere, including back out.

## 2. What changed

* **Throw-ins are thrown** (`sim/setpiece.ts`). The ball stays on its spot until thrown; nobody can take possession of
  it. The taker stands still, aims with the move keys and presses pass (short, `THROW_SHORT_SPEED` 380) or holds and
  releases shoot (long, `THROW_LONG_MIN_SPEED`..`THROW_LONG_MAX_SPEED`, 460-720). The aim is clamped into the pitch: an
  outward aim is mirrored back in, then kept at least `THROW_AIM_EDGE` (0.2 rad) off the line. A yellow arrow shows a
  human taker's aim and grows with the charge. Corners and goal kicks are kicked as before, clamped the same way.
* **Auto-throw:** a human taker gets `RESTART_AUTO_DELAY_HUMAN` (3 s); if they do nothing, it is thrown (or a kicked
  restart passed) to the nearest unmarked teammate (no opponent within `THROW_MARKED_DISTANCE`, 60 px). If they are
  charging a long throw, it is released. AI takers keep `RESTART_AUTO_DELAY` (1 s); an AI's corner or goal kick is
  still just released then, as before.
* **The touchline holds the dribbled ball** (`TOUCHLINE_HOLDS_DRIBBLE`, default on). The held ball stays wholly inside
  the touchlines and goal lines (the goal mouth excepted: you can still walk it into the net). Pushing into a line,
  the carrier is held off it (at most `TOUCHLINE_HOLD_MAX_PUSH`, 6 px a tick) and slides along it at
  `TOUCHLINE_HOLD_SPEED_FACTOR` (60%) of carrying speed. The ball only goes out from a kick, pass, deflection, tackle,
  body check or keeper parry.
* **Grace period** (`RESTART_GRACE_TIME`, 1 s): a restart that goes straight back out before anyone but the taker has
  touched it is retaken by the same team from the same spot. Goals still count.
* **AI:** a throw-in taker only considers passes it can reach with a throw, into the pitch; if nobody is open it throws
  to the same target the auto-throw would pick.
* **Online:** the guest predicts its own carried ball with the same touchline rule (`holdOffLines` / `heldBallSpot` in
  `sim/dribble.ts`), so prediction and host agree at the line. Prediction stays off during set pieces, so the host
  decides every throw; the guest draws its aim arrow from its own keys straight away. Game version 1.2.0 (both players
  must match); the wire format is unchanged (protocol 4).

## 3. Numbers (AI vs AI, 40 matches each, seed 1, 2 x 3 min)

| | Before (1.1.0) | **After (1.2.0)** | Target |
|---|---|---|---|
| Normal: goals per match | 5.08 | **4.15** | 3-6 |
| Normal: matches with 3-6 goals | 65% | **72.5%** | |
| Normal: shots / saves / save rate | 35.3 / 18.6 / 79% | 28.2 / 15.9 / 79% | |
| Normal: throw-ins / goal kicks / corners | 105 / 17 / 12 | 108 / 15 / 11 | |
| Easy goals | 4.67 | 4.25 | |
| Hard goals | 5.63 | 4.42 | |
| Stuck or dead ball, any level | 0 | **0** (longest still spell 1.7 s) | none |

Holdout (seed 7, 100 matches): Normal 4.72 goals, 73% of matches in 3-6, 0 stuck. Goals dropped by about one a match
(fewer shots, and a little less open play because throw-ins now take up to a second); still inside the T11 target.

## 4. Please feel-test these by hand (T14)

1. Offline and online (guest with `?lag=50` and `?lag=100&loss=0.03`): take throw-ins aiming every way, including
   straight out. Does the arrow match where it goes? Is a short throw (pass) a useful length? [`THROW_SHORT_SPEED`]
2. Long throws: is a full charge too strong or too weak? [`THROW_LONG_MIN_SPEED`, `THROW_LONG_MAX_SPEED`]
3. Wait without pressing anything: does the 3 s auto-throw feel fair, and go to someone sensible? [`RESTART_AUTO_DELAY_HUMAN`]
4. Dribble into the touchline and along it: does sliding at 60% speed feel natural, or sticky? Can you still beat a
   player down the wing? [`TOUCHLINE_HOLD_SPEED_FACTOR`; `TOUCHLINE_HOLDS_DRIBBLE = false` restores the old rule]
5. Kick the ball out on purpose: it must still go out and give the other team the throw.
6. Kick a corner along the goal line: is the clamp (0.2 rad off the line) too restrictive? [`THROW_AIM_EDGE`]

# T15: easier scoring, and the Arcade / Classic match rules (game 1.3.0, protocol 5)

Feedback: "In multiplayer nobody can score — it's too difficult. Even against the AI it's hard to score."

## 1. Measured first (`npm run shoottest`, new)

`scripts/shoottest.ts` fires scripted shots at the AI keeper: 5 spots (penalty spot, edge of the box spread ±80 px
along it, edge angled, box angled, long range) × 3 charge levels (15% / 50% / 100% of the rules' full charge, plus the
finesse shot under Arcade) × 3 aims × with/without a defender closing in from the side, 60 seeds each, against each
keeper level: 5,400-7,200 shots per level. Aims: **placed** = exactly at a corner (18 px inside the post); **keys** =
the best of the 8 directions a keyboard can aim (what a human can actually do); **centre** = at the keeper.

What it showed (before = Classic, which the code still reproduces exactly):

* **Keyboard aim is the big one.** Keys give 8 directions only, so from a central spot a human's only on-target shot is
  straight at the keeper, and a diagonal from the penalty spot goes wide. Classic, keys aim: penalty spot **0%** at every
  keeper level, edge of the box full charge **0-3%**.
* **Keepers smother a standing shooter** within 110 px of the line: from the penalty spot even a perfectly placed
  half/full charge scored 0% (the keeper arrives before the 0.4-0.8 s charge ends).
* **The charge is too slow under pressure:** with a defender 60 px away, half and full charges were tackled every time
  (0%). Only quick (15%) shots got off, and those are slow enough to be caught.
* **Catching:** `KEEPER_CATCH_SPEED` 850 is above any shot under ~70% charge, so most shots under pressure were held
  (no rebound).
* A precise corner shot from the middle of the edge of the box at full power already scored 78-100% in Classic (first
  version of the test): no keeper can react in the ~0.13 s it takes. So keepers weren't the main problem at that range;
  getting a good shot away was.
* A keeper's reaction (easy 0.22 s, normal 0.1 s) is longer than a shot's flight from inside the box, so making the
  existing keepers "react slower" would only change long shots. Arcade keepers instead get their own, faster profile
  with deliberate flaws, tuned so they save the imprecise shots and not the precise ones.

## 2. What changed (each switchable in `config.ts`; grouped in `MATCH_RULES`)

The rules are part of the match state (`GameState.rules`, `sim/matchRules.ts`). **Classic** = exactly the T14 game.
**Arcade** (the default, offline and online):

| Option (`MatchRules` field) | Classic | Arcade |
|---|---|---|
| Goal width (`goalWidth`) | `GOAL_WIDTH` 140 | `GOAL_WIDTH_BIG` 180 |
| Keepers' skill (`keeperDifficulty`, Settings → Keepers) | same as the team's AI | `KEEPER_DIFFICULTY` easy, from `KEEPER_PROFILES` |
| Catch speed (`keeperCatchSpeed`) | 850 | `KEEPER_CATCH_SPEED_ARCADE` 480: medium and hard shots are parried (rebounds) |
| Keeper flaws (`keeperFlaws`) | off | on (below) |
| Full charge (`shotChargeTime`) | 0.8 s | `SHOT_QUICK_CHARGE_TIME` 0.5 s |
| Aim assist (`aimAssist`) | off | on |
| Finesse shot (`finesse`) | off | on |
| Aim line (`aimLine`) | off | on |
| Eased defending (`easedDefending`) | off | on |

* **Keeper flaws:** extra reaction per level (`KEEPER_SLOW_REACTION`: easy 0.02 s, normal 0.01 s), plus up to
  `KEEPER_CORNER_REACTION` (0.03 s) for a shot heading across the goal, ±40% random spread per shot
  (`KEEPER_REACTION_SPREAD`, from the seeded RNG); it falls short of a ball going in by the post by up to
  `KEEPER_POST_SHORTFALL` (16 px); it only smothers a carrier within `KEEPER_FLAW_SMOTHER_RANGE` (70 px, not 110).
  Keepers given their own level use `KEEPER_PROFILES` (easy 0.02 s / 18 px error, normal 0.015 s / 12 px,
  hard 0.012 s / 9 px).
* **Aim assist** (`sim/shooting.ts`, `assistAim`): a shot from within `AIM_ASSIST_RANGE` (420 px) aimed at the goal or
  within `AIM_ASSIST_CONE` (0.25 rad) of it bends `AIM_ASSIST_STRENGTH` (75%) of the way towards the nearer corner
  (`AIM_ASSIST_CORNER_INSET`, 24 px inside the post), at most `AIM_ASSIST_MAX_BEND` (0.22 rad) when pulling a near miss
  in, and only `AIM_ASSIST_MAX_BEND_OUT` (0.08 rad) when pushing a shot at the keeper out. Never fully onto the corner
  (tested). A shot between the corners goes for the open one if the keeper blocks the nearer. The AI's shots get it too
  (it plays by the same rules).
* **Finesse shot:** hold shoot, tap pass. `FINESSE_SPEED` 800 (a full shot is 1150), aimed `FINESSE_POST_INSET` (14 px)
  inside the post on the side the keys point to (straight on: the keeper's far side), launched wide and curled in
  (`FINESSE_SPIN`, fading at `FINESSE_SPIN_DECAY`). The ball now has a `spin` (curl) that any touch or bounce ends;
  keepers read the curve (`curledCrossing`). Out of range it just curls. It needs no charge, so it gets off under
  pressure.
* **Aim line:** a dotted line from the ball to where the shot crosses the goal line (keys + assist), while you charge
  with the ball inside shooting range. Drawn from your own keys, so the online guest sees it without lag.
* **Eased defending:** a human on the ball is pressed by one AI player, never two; AI players don't slide in from
  behind a carrier inside their own box.
* **Match rules setting:** Settings (Match rules, Keepers), the team picker (offline and hosting) and the lobby (the
  host can change it there; the guest sees "Match rules: … · chosen by the host"; a change clears both ready flags).
  Protocol 5: `LobbyState.rules` and `start.rules` carry the whole, validated rules object, and the guest builds its
  match (goal size, prediction of its own kicks) from it.
* Tools: `npm run simulate -- --rules arcade|classic`, `npm run shoottest -- --rules … --levels … --seeds …`.

**Chip shot: skipped.** It doesn't fit cleanly: the sim is 2D and the ball collides with every player and post in every
substep. Doing it properly needs a `z`/`vz` on the ball with gravity; no player (or keeper, above its reach) collisions
while `z` is high; a bounce on landing; a rule for a high ball crossing the goal line (over the bar = goal kick);
`z` in snapshots (+2 bytes) and in the guest's prediction of its own kick; and drawing it (the T10 lift fake would
become real). A trigger could be shoot + tackle, or a double tap of shoot, and the AI keeper would need to judge a
dropping ball. A good next task once Arcade has been feel-tested.

## 3. Numbers

**Shooting test** (60 seeds per cell, % scored, no defender unless said):

| | Classic easy (before) | Classic normal (before) | **Arcade (easy keepers)** | Arcade target |
|---|---|---|---|---|
| Edge of the box, full charge, keys aim | 3% | 0% | **60%** | ~40-60% |
| Edge of the box, full charge, aimed exactly at a corner | 25% | 0% | 100% | |
| Penalty spot, half/full charge, keys aim | 0% | 0% | **95%** | ~70%+ |
| Edge of the box, finesse shot | – | – | 47-50% | |
| Edge of the box, quick (15%) charge | 0-15% | 0-12% | 0% (caught or saved) | |
| All shots: goals / **saved** / tackled before the shot | 6% / 49% / 42% | 4% / 50% / 43% | 22% / **59%** / 18% | keepers still save |

With Keepers set to Normal (Arcade): edge 47%, penalty 91%; Hard: 12% and 62%.

**AI vs AI** (40 matches, seed 1, 2 × 3 min):

| | Before (1.2.0) | Classic (1.3.0) | **Arcade (1.3.0)** |
|---|---|---|---|
| Easy: goals per match | 4.25 | 4.25 | **4.55** (5.17 at catch 560) |
| Normal: goals per match | 4.15 (72.5% in 3-6) | 4.15 (72.5% in 3-6) | **6.72** (55% in 5-9) |
| Hard: goals per match | 4.42 | 4.42 | **6.90** (70% in 5-9) |
| Normal: keeper saves / save rate | 15.9 / 79% | 15.9 / 79% | 21.3 / 76% |
| Stuck or dead ball | 0 | 0 | 0 (longest still spell 1.8 s) |

Holdout (seed 7, 100 matches, Arcade): easy 4.97, normal 5.87 (70% in 5-9), hard 6.52 (67% in 5-9), 0 stuck. Easy sits right at the bottom of the target (4.55-5.17 across seeds and catch
speeds): its AI shooters are poor, and the keepers are the same easy keepers at every level. Classic is unchanged to the last digit,
so the T11 target (3-6) still holds.

## 4. Please feel-test these by hand online (T15)

1. Arcade, both players: can you score from the edge of the box by lining up and shooting straight? Does the keeper
   still save often enough that it doesn't feel free? [`KEEPER_PROFILES`, `KEEPER_SLOW_REACTION`, `GOAL_WIDTH_BIG`]
2. Does the aim assist ever feel as if the game took the shot for you — or not enough? Watch the aim line.
   [`AIM_ASSIST_STRENGTH`, `AIM_ASSIST_MAX_BEND`, `AIM_ASSIST_MAX_BEND_OUT`]
3. Finesse (hold Space, tap X): is the curl visible and satisfying, and does it go where you expect? As the guest
   (`?lag=100`), does it curve smoothly, with no jump when the host's ball takes over? [`FINESSE_SPEED`, `FINESSE_SPIN`]
4. Is a 0.5 s full charge right, or do all shots now feel the same? [`SHOT_QUICK_CHARGE_TIME`]
5. Keepers now parry most shots: fun scrambles, or too many cheap tap-ins? [`KEEPER_CATCH_SPEED_ARCADE`]
6. Lobby: the host switches Classic/Arcade; the guest's line updates and both have to press Ready again.
7. Do the bigger goals look right (nets, posts, a ball going in off the post)?

# T16: corners (game 1.3.1)

Bug: "Corners aren't happening — when a defender puts the ball over their own goal line it turns into a goal kick, or a
throw-in to the other team."

## 1. Causes (reproduced first: `tests/corners.test.ts` failed 17 of its cases on the old code)

1. **Ghost touches** (main cause). `updateTouches` (sim/control.ts, from T11) gave the last touch to whoever was
   closest *within reach* of a slow ball, without any contact. A defender's clearance rolling out past an attacker (or
   an attacker chasing it, or standing by the line where it stopped) became the attacker's touch: a goal kick instead of
   a corner, a throw-in to the defenders instead of the attackers. In AI-vs-AI matches this flipped the last-touch team
   ~34 times a match. Removed: only contacts, kicks, slides, body checks and possession are touches now
   (`TOUCH_MAX_RELATIVE_SPEED` is gone).
2. **Body checks weren't credited** (sim/dribble.ts). A defender knocking the ball off a carrier left the carrier as the
   last toucher, so an attacker driving at the byline and dispossessed there got a goal kick against them.
3. **Saves could never go behind.** Every keeper touch forced the ball out of the goal at `KEEPER_CLEAR_SPEED`, so a
   shot turned round the post came back into play. Now a parry/dive heading behind more than `KEEPER_PARRY_WIDE_MARGIN`
   outside a post is left alone: a corner. (Anything heading for the goal mouth is still pushed out, as before.)
4. **By the corner flag** a ball over both lines was called on the touchline first (y was only checked "whole ball").
   Now: the ball is out when no part of it is on the pitch (distance to the pitch rectangle), and in the corner region
   the line is the one it is heading over more directly (a ball at rest there: the end line).

Ruled out: `defenderOf()` after half-time (tests run in both halves), the grace period, the snapshot (corner restarts
and events round-trip; the guest's label comes from the restart type).

## 2. Corners worth having

- Corners are taken like throw-ins (`pendingHeldRestart`): the taker stands over the ball, aims with the yellow arrow,
  pass = low cross (`CORNER_LOW_SPEED`), hold/release shoot = hard cross (`CORNER_HARD_MIN/MAX_SPEED`). Idle for 3 s: it
  is crossed into the box for you (`cornerTarget`). Nobody can dribble a corner any more.
- AI: the attacking team's outfield players run to `AI_CORNER_SPOTS` (near post, far post, penalty spot); the AI taker
  waits (up to `RESTART_AUTO_DELAY_CORNER`) for `AI_CORNER_MIN_RUNNERS` in the box, then crosses to the most open one.
- F2 overlay: a "last touch: Team #n (GK)   restart: …" line (host only; the guest isn't sent the last touch). The
  team-stats block moved to the bottom-left, out from under the score bar.

## 3. Numbers (AI vs AI, 40 matches, seed 1, 2 x 3 min; corners per match)

| | before | after |
|---|---|---|
| Arcade easy / normal / hard | 7.5 / 8.2 / 10.1 | 8.7 / 10.8 / 11.6 |
| Classic easy / normal / hard | 8.6 / 10.9 / 11.0 | 8.2 / 10.2 / 11.0 |
| Arcade goals per match | 4.67 / 6.70 / 6.88 | 4.88 / 6.05 / 6.60 |
| Classic goals per match | 4.25 / 4.15 / 4.42 | 4.65 / 4.65 / 4.47 |
| Arcade goals within 8 s of a corner | 1.25 / 1.23 / 1.30 | 1.13 / 1.60 / 1.88 |

AI-vs-AI already had plenty of corners before (the AI rarely stands idle next to a rolling ball, so the ghost touch hit
humans hardest) — above the rough 2–6 target both before and after. Most AI corners now come from a defender chasing a
ball towards its own line and knocking it behind (~6 of ~11 a match on Arcade normal); keepers turning it round the post
~1.8. Fewer AI corners is a defending-AI question for T17 (approach a ball running to the line from the goal side).
All stuck/dead-ball checks stay at 0.

## 4. Please feel-test by hand (T16)

1. Defend: clear or deflect the ball behind your own line — the AI gets a corner every time (F2 shows the last touch).
2. Attack: get dispossessed by the byline, or have a shot parried wide — your corner.
3. Take a corner: does the arrow + low/hard cross feel right? Is the hard cross too fast to control?
   [`CORNER_LOW_SPEED`, `CORNER_HARD_MAX_SPEED`]
4. Do the AI runners get there in time without the wait feeling long? [`RESTART_AUTO_DELAY_CORNER`, `AI_CORNER_SPOTS`]

// Shooting test (T15): thousands of scripted shots against the AI keeper, from typical spots, at different charge
// levels, with and without a defender closing the shooter down. Reports the % scored per keeper difficulty.
// Pure sim, no Phaser. Run with `npm run shoottest` (options: --rules arcade|classic|both --seeds 40 --json).
import { BALL_RADIUS, PITCH_BOTTOM, PITCH_RIGHT, PITCH_TOP, SIM_DT } from '../src/config';
import { createAiState } from '../src/sim/ai';
import { rulesFor } from '../src/sim/matchRules';
import { createInitialState, step } from '../src/sim/simulation';
import type { Difficulty, GameState, InputFrame, MatchRules, PlayerState, RulesPreset } from '../src/sim/types';

const args = process.argv.slice(2);
function opt(name: string, fallback: string): string {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}
const SEEDS = Number(opt('seeds', '40'));
const which = opt('rules', 'both');
const presets: RulesPreset[] = which === 'both' ? ['classic', 'arcade'] : [which as RulesPreset];
const json = args.includes('--json');
const levels = opt('levels', 'easy,normal,hard').split(',') as Difficulty[];

const MID_Y = (PITCH_TOP + PITCH_BOTTOM) / 2;
const GOAL_X = PITCH_RIGHT;

type Outcome = 'goal' | 'saved' | 'wide' | 'blocked';

/** Small deterministic RNG for the spot jitter (separate from the sim's). */
function rng(seed: number): () => number {
  let t = seed | 0;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const input = (mx: number, my: number, shoot: boolean, pass = false): InputFrame => ({ seq: 0, moveX: mx, moveY: my, pass, shoot, tackle: false, switchPlayer: false });

/**
 * One shot: the shooter (home, human) has the ball at (px, py) and aims at (GOAL_X, ty), charging for `charge` s (a
 * finesse shot instead: shoot held, pass tapped). The keeper -- and the defender, if any -- play at `level`.
 */
function shoot(rules: MatchRules, level: Difficulty, px: number, py: number, ty: number, charge: number, finesse: boolean, defender: boolean, seed: number, keys = false): Outcome {
  let s: GameState = createInitialState({ humans: [true, false], difficulty: [level, level], seed, rules });
  const shooter = s.players.find((p) => p.team === 0 && p.slot === 4)!;
  const keeper = s.players.find((p) => p.team === 1 && p.role === 'keeper')!;
  const def = s.players.find((p) => p.team === 1 && p.slot === 1)!;
  const keep: PlayerState[] = [shooter, keeper, ...(defender ? [def] : [])];
  keep.forEach((p, i) => (p.id = i));
  s.players = keep;
  s.controlled = [0, -1];
  s.ai = createAiState(s.players, s.controlled, [level, level], seed);
  const aim = keys ? keyAim(px, py, ty) : Math.atan2(ty - py, GOAL_X - px);
  shooter.pos = { x: px, y: py };
  shooter.facing = aim;
  const reach = shooter.radius + BALL_RADIUS + 2;
  s.ball.pos = { x: px + Math.cos(aim) * reach, y: py + Math.sin(aim) * reach };
  s.ball.vel = { x: 0, y: 0 };
  s.possession = { player: 0, angle: aim, roll: 0 };
  s.lastTouch = { team: 0, player: 0 };
  if (defender) {
    // A defender closing down from the side, level with the shooter (not standing in the shot's path).
    const side = py > MID_Y ? 1 : py < MID_Y ? -1 : seed % 2 === 0 ? 1 : -1;
    def.pos = { x: px + 10, y: py + side * 60 };
    def.facing = side > 0 ? -Math.PI / 2 : Math.PI / 2;
  }
  const mx = Math.cos(aim) * 0.05;
  const my = Math.sin(aim) * 0.05;
  const chargeTicks = finesse ? 3 : Math.max(1, Math.round(charge / SIM_DT));
  let struck = false;
  for (let i = 0; i < 300; i++) {
    const holding = i < chargeTicks;
    const before = s.possession?.player === 0;
    const touch = s.lastTouch?.player; // (a restart hands lastTouch to its taker, so judge by the touch before it)
    s = step(s, [input(mx, my, holding, finesse && i === chargeTicks - 1), undefined], SIM_DT);
    if (!struck) {
      if (finesse ? i >= chargeTicks - 1 : !holding && i >= chargeTicks) struck = true;
      else if (before && s.possession?.player !== 0) return 'blocked'; // tackled or knocked off the ball before the shot
    }
    if (s.phase === 'goal-scored') return s.score[0] > 0 ? 'goal' : 'blocked';
    if (s.restart && s.restart.type !== 'kickoff') return touch === 1 ? 'saved' : touch === 0 ? 'wide' : 'blocked';

    if (struck && s.lastTouch && s.lastTouch.player !== 0) return s.lastTouch.player === 1 ? 'saved' : 'blocked';
  }
  return 'saved';
}

/**
 * `spread`: the shooter stands anywhere up to this far off-centre (uniformly), aiming at the corner on that side --
 * shots from the edge of the box come from all along it in a match. Otherwise within 8 px of the spot.
 */
const SPOTS = [
  { name: 'penalty spot', x: GOAL_X - 105, y: MID_Y, spread: 0 },
  { name: 'edge of box', x: GOAL_X - 155, y: MID_Y, spread: 80 },
  { name: 'edge, angled', x: GOAL_X - 150, y: MID_Y - 110, spread: 0 },
  { name: 'box, angled', x: GOAL_X - 95, y: MID_Y + 120, spread: 0 },
  { name: 'long range', x: GOAL_X - 260, y: MID_Y - 40, spread: 0 },
];
/** Fractions of the rules' full charge; 'finesse' is the finesse shot (Arcade only). */
const CHARGES = [
  { name: 'quick', f: 0.15 },
  { name: 'half', f: 0.5 },
  { name: 'full', f: 1 },
  { name: 'finesse', f: 0 },
];
/**
 * "placed" = exactly at a corner, 18 px inside the post (the skilled shot: line up and shoot); "keys" = what a keyboard
 * player can do from the spot: the one of the 8 key directions that lands nearest that corner; "centre" = straight at
 * the middle of the goal (where the keeper stands).
 */
const AIMS = [
  { name: 'placed', off: 1, keys: false },
  { name: 'keys', off: 1, keys: true },
  { name: 'centre', off: 0, keys: false },
];

/** The 8-direction key aim from (px, py) that crosses the goal line nearest `ty`. */
function keyAim(px: number, py: number, ty: number): number {
  let best = 0;
  let bestErr = Infinity;
  for (let k = -2; k <= 2; k++) {
    const a = (k * Math.PI) / 4;
    if (Math.cos(a) <= 1e-6) continue;
    const y = py + Math.tan(a) * (GOAL_X - px);
    if (Math.abs(y - ty) < bestErr) {
      bestErr = Math.abs(y - ty);
      best = a;
    }
  }
  return best;
}

const f0 = (n: number): string => n.toFixed(0);
const f1 = (n: number): string => n.toFixed(1);
const report: Record<string, unknown> = {};
for (const preset of presets) {
  for (const level of levels) {
    const rules = rulesFor(preset, level);
    const charges = CHARGES.filter((c) => c.name !== 'finesse' || rules.finesse);
    const rows: Record<string, number> = {};
    const totals: Record<Outcome, number> = { goal: 0, saved: 0, wide: 0, blocked: 0 };
    for (const sp of SPOTS) {
      for (const ch of charges) {
        for (const aim of AIMS) {
          for (const defender of [false, true]) {
            let goals = 0;
            for (let k = 0; k < SEEDS; k++) {
              const seed = 1000 * (SPOTS.indexOf(sp) + 1) + k;
              const r = rng(seed);
              const px = sp.x + (r() * 2 - 1) * 8;
              const off = sp.spread ? (r() * 2 - 1) * sp.spread : (r() * 2 - 1) * 8;
              const py = sp.y + off;
              // Placed shots go for the corner on the shooter's side (spread spots), else alternate corners.
              const side = sp.spread ? (off < 0 ? -1 : 1) : k % 2 === 0 ? -1 : 1;
              const ty = MID_Y + side * aim.off * (rules.goalWidth / 2 - 18) + (r() * 2 - 1) * 4;
              const out = shoot(rules, level, px, py, ty, ch.f * rules.shotChargeTime, ch.name === 'finesse', defender, seed, aim.keys);
              totals[out]++;
              if (out === 'goal') goals++;
            }
            rows[`${sp.name}|${ch.name}|${aim.name}|${defender ? 'defender' : 'free'}`] = (100 * goals) / SEEDS;
          }
        }
      }
    }
    const n = totals.goal + totals.saved + totals.wide + totals.blocked;
    const key = (sp: string, ch: string, aim: string, d = 'free'): number => rows[`${sp}|${ch}|${aim}|${d}`];
    const penalty = (key('penalty spot', 'half', 'placed') + key('penalty spot', 'full', 'placed')) / 2;
    const penaltyKeys = (key('penalty spot', 'half', 'keys') + key('penalty spot', 'full', 'keys')) / 2;
    const edge = key('edge of box', 'full', 'placed');
    const edgeKeys = key('edge of box', 'full', 'keys');

    report[`${preset}/${level}`] = { rows, totals, shots: n, goalPct: (100 * totals.goal) / n, penaltyPlaced: penalty, penaltyKeys, edgePlacedFull: edge, edgeKeysFull: edgeKeys };
    if (json) continue;
    console.log(`\n=== ${preset.toUpperCase()} rules, keeper ${level.toUpperCase()}  (${n} shots: ${f1((100 * totals.goal) / n)}% goals, ${f1((100 * totals.saved) / n)}% saved, ${f1((100 * totals.wide) / n)}% wide, ${f1((100 * totals.blocked) / n)}% blocked/tackled) ===`);
    console.log(`penalty spot (half/full charge, at a corner): ${f0(penalty)}% placed, ${f0(penaltyKeys)}% keys    edge of the box (full charge, at a corner): ${f0(edge)}% placed, ${f0(edgeKeys)}% keys`);

    console.log(''.padEnd(14) + charges.flatMap((c) => AIMS.map((a) => `${c.name}/${a.name}`.padStart(15))).join('') + '   (free | with defender)');
    for (const sp of SPOTS) {
      for (const d of ['free', 'defender']) {
        const cells = charges.flatMap((c) => AIMS.map((a) => `${f0(key(sp.name, c.name, a.name, d))}%`.padStart(15)));

        console.log((d === 'free' ? sp.name : '  + defender').padEnd(14) + cells.join(''));
      }
    }
  }
}
if (json) console.log(JSON.stringify(report, null, 2));

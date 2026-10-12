// Exploit probe: a lone human shooter (full-power charged shot) against the AI keeper, from a grid of positions
// at each corner of the goal. Reports the goal rate per spot, so an unstoppable angle/position stands out.
//   node .sim/shotprobe.mjs   (build: npx rolldown scripts/shotprobe.ts --format esm --platform node --file .sim/shotprobe.mjs)
import { AI_PROFILES, PITCH_BOTTOM, PITCH_LEFT, PITCH_RIGHT, PITCH_TOP, SIM_DT, GOAL_WIDTH, BALL_RADIUS } from '../src/config';
import { createInitialState, step } from '../src/sim/simulation';
import type { Difficulty, InputFrame } from '../src/sim/types';

const MID_Y = (PITCH_TOP + PITCH_BOTTOM) / 2;
const GOAL_X = PITCH_RIGHT;
const difficulty = (process.argv[2] ?? 'normal') as Difficulty;
// Optional overrides to try tunings: node .sim/shotprobe.mjs normal <keeperReaction> <keeperSpeed> <keeperError>
if (process.argv[3]) AI_PROFILES[difficulty].keeperReaction = Number(process.argv[3]);
if (process.argv[4]) AI_PROFILES[difficulty].keeperSpeed = Number(process.argv[4]);
if (process.argv[5]) AI_PROFILES[difficulty].keeperError = Number(process.argv[5]);
const input = (mx: number, my: number, shoot: boolean): InputFrame => ({ seq: 0, moveX: mx, moveY: my, pass: false, shoot, tackle: false, switchPlayer: false });

function shoot(px: number, py: number, ty: number, seed: number, charge: number): 'goal' | 'saved' | 'wide' {
  let s = createInitialState({ humans: [true, false], difficulty: [difficulty, difficulty], seed });
  // Only the shooter and the keeper of the goal being attacked: isolates the keeper's ability to save.
  s.players = s.players.filter((p) => p.id === 9 || p.id === 5 || p.id === 4);
  // ids must match indices; remap
  s.players.forEach((p, i) => (p.id = i));
  const shooter = s.players.find((p) => p.team === 0)!;
  s.controlled = [shooter.id, -1];
  s.ai.players = s.ai.players.slice(0, s.players.length);
  shooter.pos = { x: px, y: py };
  const aim = Math.atan2(ty - py, GOAL_X - px);
  shooter.facing = aim;
  s.ball.pos = { x: px + Math.cos(aim) * (shooter.radius + BALL_RADIUS + 1), y: py + Math.sin(aim) * (shooter.radius + BALL_RADIUS + 1) };
  s.ball.vel = { x: 0, y: 0 };
  const mx = Math.cos(aim) * 0.05;
  const my = Math.sin(aim) * 0.05;
  const chargeTicks = Math.round(charge / SIM_DT);
  for (let i = 0; i < 240; i++) {
    const holding = i < chargeTicks;
    s = step(s, [input(mx, my, holding), undefined], SIM_DT);
    if (s.score[0] > 0 || s.phase === 'goal-scored') return 'goal';
    if (s.restart && s.restart.type !== 'kickoff') return s.restart.type === 'goal-kick' ? 'wide' : 'saved';
  }
  return 'saved';
}

const spots = [
  { name: 'centre spot', x: (PITCH_LEFT + PITCH_RIGHT) / 2, y: MID_Y },
  { name: '25% out', x: GOAL_X - 260, y: MID_Y },
  { name: 'edge of box', x: GOAL_X - 150, y: MID_Y },
  { name: 'box, wide', x: GOAL_X - 110, y: MID_Y - 130 },
  { name: 'tight angle', x: GOAL_X - 60, y: MID_Y + 150 },
  { name: 'on the line', x: GOAL_X - 30, y: MID_Y + 90 },
];
const halfMouth = GOAL_WIDTH / 2;
console.log(`Shooter vs AI keeper (${difficulty}); goal % over 20 seeds, per target`);
for (const sp of spots) {
  const row: string[] = [];
  for (const [label, ty] of [['top corner', MID_Y - halfMouth + 14], ['centre', MID_Y], ['low corner', MID_Y + halfMouth - 14]] as const) {
    for (const [cl, charge] of [['full', 0.8], ['half', 0.3]] as const) {
      let goals = 0;
      const n = 20;
      for (let seed = 1; seed <= n; seed++) if (shoot(sp.x, sp.y, ty, seed, charge) === 'goal') goals++;
      row.push(`${label}/${cl} ${String(Math.round((100 * goals) / n)).padStart(3)}%`);
    }
  }
  console.log(sp.name.padEnd(12), row.join('  '));
}

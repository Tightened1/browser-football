// Headless AI-vs-AI matches on the pure sim (no Phaser, no DOM). Run with `npm run simulate`.
//   npm run simulate -- --matches 60 --difficulty normal --seed 1
// Reports goals, shots, saves, possession, restarts and stalemates per difficulty.
import { SIM_DT } from '../src/config';
import { createMatchState, step } from '../src/sim/simulation';
import type { Difficulty, GameState } from '../src/sim/types';

const args = process.argv.slice(2);
function opt(name: string, fallback: string): string {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}
const MATCHES = Number(opt('matches', '40'));
const SEED = Number(opt('seed', '1'));
const HALF = Number(opt('half', '180'));
const which = opt('difficulty', 'all');
const difficulties: Difficulty[] = which === 'all' ? ['easy', 'normal', 'hard'] : [which as Difficulty];
const json = args.includes('--json');

/** The ball counts as stuck when, in open play, it stays within STUCK_RADIUS of one spot for this long (s). */
const STUCK_RADIUS = 45;
const STUCK_SECONDS = 6;
/** ...or when it is barely moving (and no set piece is pending) for this long. */
const DEAD_SPEED = 12;
const DEAD_SECONDS = 3;

interface MatchResult {
  seed: number;
  goals: [number, number];
  shots: [number, number];
  aiShots: [number, number];
  saves: [number, number];
  possession: [number, number];
  throwIns: number;
  goalKicks: number;
  corners: number;
  stuckEpisodes: number;
  deadEpisodes: number;
  longestStill: number;
  tackles: number;
  passes: number;
  ownGoals: number;
  /** Seconds of the match spent in open play. */
  playSeconds: number;
  /** Goals scored within 8 s of a kickoff (cheap-goal check). */
  quickGoals: number;
}

function playMatch(difficulty: Difficulty, seed: number): MatchResult {
  let s: GameState = createMatchState({
    aiVsAi: true,
    difficulty: [difficulty, difficulty],
    seed,
    kickoffTeam: (seed % 2) as 0 | 1,
    halfLength: HALF,
  });
  let anchor = { ...s.ball.pos };
  let stillFor = 0;
  let deadFor = 0;
  let stuck = 0;
  let dead = 0;
  let longestStill = 0;
  let play = 0;
  let sinceKick = 99;
  let quick = 0;
  let lastGoals = 0;
  let lastId = 0;
  const counts: Record<string, number> = {};
  const maxTicks = Math.ceil((HALF * 2 + 30) / SIM_DT) * 3;
  for (let i = 0; i < maxTicks && s.phase !== 'full-time'; i++) {
    s = step(s, [undefined, undefined], SIM_DT);
    // The event list is capped, so count events as they appear (ids increase).
    for (const e of s.events) {
      if (e.id > lastId) {
        counts[e.type] = (counts[e.type] ?? 0) + 1;
        lastId = e.id;
      }
    }
    const goals = s.score[0] + s.score[1];
    if (goals > lastGoals) {
      if (sinceKick < 8) quick++;
      lastGoals = goals;
    }
    if (s.phase === 'playing' && !s.restart) {
      play += SIM_DT;
      sinceKick += SIM_DT;
      const d = Math.hypot(s.ball.pos.x - anchor.x, s.ball.pos.y - anchor.y);
      if (d > STUCK_RADIUS) {
        anchor = { ...s.ball.pos };
        stillFor = 0;
      } else {
        stillFor += SIM_DT;
        if (stillFor > longestStill) longestStill = stillFor;
        if (stillFor >= STUCK_SECONDS && stillFor - SIM_DT < STUCK_SECONDS) stuck++;
      }
      if (Math.hypot(s.ball.vel.x, s.ball.vel.y) < DEAD_SPEED) {
        deadFor += SIM_DT;
        if (deadFor >= DEAD_SECONDS && deadFor - SIM_DT < DEAD_SECONDS) dead++;
      } else deadFor = 0;
    } else {
      anchor = { ...s.ball.pos };
      stillFor = 0;
      deadFor = 0;
      if (s.phase === 'goal-scored' || s.phase === 'pre-kickoff') sinceKick = 0;
    }
  }
  const [a, b] = s.ai.teams;
  return {
    seed,
    goals: [s.score[0], s.score[1]],
    shots: [s.stats.shots[0], s.stats.shots[1]],
    aiShots: [a.shots, b.shots],
    saves: [a.saves, b.saves],
    possession: [s.stats.possession[0], s.stats.possession[1]],
    throwIns: counts['throw-in'] ?? 0,
    goalKicks: counts['goal-kick'] ?? 0,
    corners: counts['corner'] ?? 0,
    stuckEpisodes: stuck,
    deadEpisodes: dead,
    longestStill: longestStill,
    tackles: a.tackles + b.tackles,
    passes: a.passes + b.passes,
    ownGoals: s.stats.goals.filter((g) => g.ownGoal).length,
    playSeconds: play,
    quickGoals: quick,
  };
}

const sum = (xs: number[]) => xs.reduce((x, y) => x + y, 0);
const avg = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);
const f1 = (n: number) => n.toFixed(1);
const f2 = (n: number) => n.toFixed(2);

const report: Record<string, unknown> = {};
for (const d of difficulties) {
  const t0 = Date.now();
  const rs: MatchResult[] = [];
  for (let m = 0; m < MATCHES; m++) rs.push(playMatch(d, SEED * 1000 + m));
  const goals = rs.map((r) => r.goals[0] + r.goals[1]);
  const aiShots = rs.map((r) => r.aiShots[0] + r.aiShots[1]);
  const saves = rs.map((r) => r.saves[0] + r.saves[1]);
  const possHome = rs.map((r) => r.possession[0] / (r.possession[0] + r.possession[1] || 1));
  const gap = rs.map((r) => Math.abs(r.possession[0] - r.possession[1]) / (r.possession[0] + r.possession[1] || 1));
  const onGoal = sum(saves) + sum(goals);
  const out = {
    difficulty: d,
    matches: MATCHES,
    goalsPerMatch: avg(goals),
    goalsMin: Math.min(...goals),
    goalsMax: Math.max(...goals),
    pctMatches3to6: (100 * goals.filter((g) => g >= 3 && g <= 6).length) / MATCHES,
    pctGoalless: (100 * goals.filter((g) => g === 0).length) / MATCHES,
    shotsPerMatch: avg(rs.map((r) => r.shots[0] + r.shots[1])),
    aiShotsPerMatch: avg(aiShots),
    savesPerMatch: avg(saves),
    saveRate: onGoal ? sum(saves) / onGoal : 0,
    conversion: sum(aiShots) ? sum(goals) / sum(aiShots) : 0,
    homePossession: avg(possHome),
    possessionGap: avg(gap),
    outOfPlayPerMatch: avg(rs.map((r) => r.throwIns + r.goalKicks + r.corners)),
    throwIns: avg(rs.map((r) => r.throwIns)),
    goalKicks: avg(rs.map((r) => r.goalKicks)),
    corners: avg(rs.map((r) => r.corners)),
    tacklesPerMatch: avg(rs.map((r) => r.tackles)),
    passesPerMatch: avg(rs.map((r) => r.passes)),
    ownGoalsPerMatch: avg(rs.map((r) => r.ownGoals)),
    stuckEpisodesPerMatch: avg(rs.map((r) => r.stuckEpisodes)),
    matchesWithStuck: rs.filter((r) => r.stuckEpisodes > 0).length,
    deadBallPerMatch: avg(rs.map((r) => r.deadEpisodes)),
    longestStillSeconds: Math.max(...rs.map((r) => r.longestStill)),
    quickGoalsPerMatch: avg(rs.map((r) => r.quickGoals)),
    playSecondsPerMatch: avg(rs.map((r) => r.playSeconds)),
    wallSeconds: (Date.now() - t0) / 1000,
  };
  report[d] = out;
  if (json) continue;
  console.log(`\n=== ${d.toUpperCase()}  (${MATCHES} matches, 2 x ${HALF}s) ===`);
  console.log(`goals/match        ${f2(out.goalsPerMatch)}   (min ${out.goalsMin}, max ${out.goalsMax}; ${f1(out.pctMatches3to6)}% of matches in 3-6, ${f1(out.pctGoalless)}% goalless)`);
  console.log(`shots/match        ${f1(out.shotsPerMatch)} (stat shots)   ${f1(out.aiShotsPerMatch)} (AI shot decisions)`);
  console.log(`keeper saves       ${f1(out.savesPerMatch)}/match   save rate ${f1(out.saveRate * 100)}%   goals per shot decision ${f1(out.conversion * 100)}%`);
  console.log(`possession         home ${f1(out.homePossession * 100)}%   avg gap ${f1(out.possessionGap * 100)} pts`);
  console.log(`out of play        ${f1(out.outOfPlayPerMatch)}/match (throw-ins ${f1(out.throwIns)}, goal kicks ${f1(out.goalKicks)}, corners ${f1(out.corners)})`);
  console.log(`passes / tackles   ${f1(out.passesPerMatch)} / ${f1(out.tacklesPerMatch)}   own goals ${f2(out.ownGoalsPerMatch)}`);
  console.log(`stuck ball (>${STUCK_SECONDS}s within ${STUCK_RADIUS}px)  ${f2(out.stuckEpisodesPerMatch)}/match, ${out.matchesWithStuck}/${MATCHES} matches affected, longest ${f1(out.longestStillSeconds)}s`);
  const bad = rs.filter((r) => r.stuckEpisodes > 0);
  if (bad.length) console.log(`  stuck in seeds: ${bad.map((r) => `${r.seed} (${f1(r.longestStill)}s)`).join(', ')}  -- reproduce with --seed ${SEED} --matches ${MATCHES}`);
  console.log(`dead ball (<${DEAD_SPEED}px/s for ${DEAD_SECONDS}s)  ${f2(out.deadBallPerMatch)}/match`);
  console.log(`goals within 8s of a kickoff ${f2(out.quickGoalsPerMatch)}/match   open play ${f1(out.playSecondsPerMatch)}s/match   (${f1(out.wallSeconds)}s to simulate)`);
}
if (json) console.log(JSON.stringify(report, null, 2));

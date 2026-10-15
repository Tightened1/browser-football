// Headless AI-vs-AI matches on the pure sim (no Phaser, no DOM). Run with `npm run simulate`.
//   npm run simulate -- --matches 60 --difficulty normal --seed 1 --rules classic|arcade
// Reports goals, shots, saves, possession, restarts and stalemates per difficulty (with the match rules' own keepers).
//   --human naive|skilled   team 0's controlled player is a scripted human-like dribbler (scripts/humanBot.ts) instead of
//                           the AI, to measure how the AI defends against a person (T17); --defending relaxed|normal|tough
//                           overrides the rules' "AI defending vs humans" setting.
// Always reports AI tackle duels: how often an AI challenge on a carrier wins the ball, for AI and human carriers.
import { SIM_DT } from '../src/config';
import { botInput, createBotMemory, type BotSkill } from './humanBot';
import { rulesFor } from '../src/sim/matchRules';
import { createMatchState, step } from '../src/sim/simulation';
import type { Difficulty, GameState, RulesPreset } from '../src/sim/types';

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
const PRESET = opt('rules', 'classic') as RulesPreset;
const RULES = rulesFor(PRESET);
const HUMAN = opt('human', '') as BotSkill | '';
const DEFENDING = opt('defending', '');
if (DEFENDING) (RULES as unknown as Record<string, unknown>).aiDefending = DEFENDING;
/** Goals-per-match target range for the rules (T11 for Classic, T15 for Arcade). */
const TARGET: [number, number] = PRESET === 'arcade' ? [5, 9] : [3, 6];
/** Corners-per-match target range (T16). */
const CORNER_TARGET: [number, number] = [2, 6];

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
  /** Goals scored within 8 s of a corner being taken. */
  cornerGoals: number;
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
  /** AI challenges on carriers and those that won the ball: [on AI carriers, on the human carrier]. */
  duelTries: [number, number];
  duelWins: [number, number];
  /** Seconds the ball was carried by AI outfield players / by the human. */
  carrySeconds: [number, number];
  /** Separate carries by the human. */
  humanCarries: number;
}

function playMatch(difficulty: Difficulty, seed: number): MatchResult {
  let s: GameState = createMatchState({
    aiVsAi: !HUMAN,
    humans: HUMAN ? [true, false] : undefined,
    difficulty: [difficulty, difficulty],
    seed,
    kickoffTeam: (seed % 2) as 0 | 1,
    halfLength: HALF,
    rules: RULES,
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
  let sinceCorner = 99;
  let cornerGoals = 0;
  let lastId = 0;
  const counts: Record<string, number> = {};
  const bot = createBotMemory(seed);
  const carry: [number, number] = [0, 0];
  let humanCarries = 0;
  let wasHumanCarrying = false;
  const maxTicks = Math.ceil((HALF * 2 + 30) / SIM_DT) * 3;
  for (let i = 0; i < maxTicks && s.phase !== 'full-time'; i++) {
    s = step(s, [HUMAN ? botInput(s, 0, bot, i, HUMAN) : undefined, undefined], SIM_DT);
    const carrier = s.possession && s.phase === 'playing' ? s.players[s.possession.player] : null;
    const humanCarrying = !!HUMAN && !!carrier && carrier.id === s.controlled[0];
    if (carrier && carrier.role !== 'keeper') carry[humanCarrying ? 1 : 0] += SIM_DT;
    if (humanCarrying && !wasHumanCarrying) humanCarries++;
    wasHumanCarrying = humanCarrying;
    // The event list is capped, so count events as they appear (ids increase).
    for (const e of s.events) {
      if (e.id > lastId) {
        counts[e.type] = (counts[e.type] ?? 0) + 1;
        lastId = e.id;
      }
    }
    const goals = s.score[0] + s.score[1];
    if (s.restart?.type === 'corner') sinceCorner = 0;
    else sinceCorner += SIM_DT;
    if (goals > lastGoals) {
      if (sinceKick < 8) quick++;
      if (sinceCorner < 8) cornerGoals++;
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
    cornerGoals,
    stuckEpisodes: stuck,
    deadEpisodes: dead,
    longestStill: longestStill,
    tackles: a.tackles + b.tackles,
    passes: a.passes + b.passes,
    ownGoals: s.stats.goals.filter((g) => g.ownGoal).length,
    playSeconds: play,
    quickGoals: quick,
    duelTries: [a.duelTries + b.duelTries, a.duelTriesHuman + b.duelTriesHuman],
    duelWins: [a.duelWins + b.duelWins, a.duelWinsHuman + b.duelWinsHuman],
    carrySeconds: carry,
    humanCarries,
  };
}

const sum = (xs: number[]) => xs.reduce((x, y) => x + y, 0);
const avg = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);
const f1 = (n: number) => n.toFixed(1);
const f2 = (n: number) => n.toFixed(2);

const s0 = (): GameState => createMatchState({ rules: RULES });
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
    pctMatchesInTarget: (100 * goals.filter((g) => g >= TARGET[0] && g <= TARGET[1]).length) / MATCHES,
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
    cornersMin: Math.min(...rs.map((r) => r.corners)),
    cornersMax: Math.max(...rs.map((r) => r.corners)),
    pctCornersInTarget: (100 * rs.filter((r) => r.corners >= CORNER_TARGET[0] && r.corners <= CORNER_TARGET[1]).length) / MATCHES,
    goalsFromCorners: avg(rs.map((r) => r.cornerGoals)),
    tacklesPerMatch: avg(rs.map((r) => r.tackles)),
    passesPerMatch: avg(rs.map((r) => r.passes)),
    ownGoalsPerMatch: avg(rs.map((r) => r.ownGoals)),
    stuckEpisodesPerMatch: avg(rs.map((r) => r.stuckEpisodes)),
    matchesWithStuck: rs.filter((r) => r.stuckEpisodes > 0).length,
    deadBallPerMatch: avg(rs.map((r) => r.deadEpisodes)),
    longestStillSeconds: Math.max(...rs.map((r) => r.longestStill)),
    quickGoalsPerMatch: avg(rs.map((r) => r.quickGoals)),
    playSecondsPerMatch: avg(rs.map((r) => r.playSeconds)),
    homeGoalsPerMatch: avg(rs.map((r) => r.goals[0])),
    awayGoalsPerMatch: avg(rs.map((r) => r.goals[1])),
    duels: [0, 1].map((k) => {
      const tries = sum(rs.map((r) => r.duelTries[k]));
      const wins = sum(rs.map((r) => r.duelWins[k]));
      const carryMin = sum(rs.map((r) => r.carrySeconds[k])) / 60;
      const carries = sum(rs.map((r) => r.humanCarries));
      return { carrier: k ? 'human' : 'AI', triesPerMatch: tries / MATCHES, winsPerMatch: wins / MATCHES, winRate: tries ? wins / tries : 0, winsPerCarryMinute: carryMin ? wins / carryMin : 0, carryMinutesPerMatch: carryMin / MATCHES, pctCarriesTackled: k && carries ? wins / carries : null };
    }),
    wallSeconds: (Date.now() - t0) / 1000,
  };
  report[d] = out;
  if (json) continue;
  console.log(`\n=== ${d.toUpperCase()}  (${PRESET} rules, ${MATCHES} matches, 2 x ${HALF}s) ===`);

  console.log(`goals/match        ${f2(out.goalsPerMatch)}   (min ${out.goalsMin}, max ${out.goalsMax}; ${f1(out.pctMatchesInTarget)}% of matches in ${TARGET[0]}-${TARGET[1]}, ${f1(out.pctGoalless)}% goalless)`);

  console.log(`shots/match        ${f1(out.shotsPerMatch)} (stat shots)   ${f1(out.aiShotsPerMatch)} (AI shot decisions)`);
  console.log(`keeper saves       ${f1(out.savesPerMatch)}/match   save rate ${f1(out.saveRate * 100)}%   goals per shot decision ${f1(out.conversion * 100)}%`);
  console.log(`possession         home ${f1(out.homePossession * 100)}%   avg gap ${f1(out.possessionGap * 100)} pts`);
  console.log(`out of play        ${f1(out.outOfPlayPerMatch)}/match (throw-ins ${f1(out.throwIns)}, goal kicks ${f1(out.goalKicks)}, corners ${f1(out.corners)})`);
  console.log(`corners            ${f1(out.corners)}/match (min ${out.cornersMin}, max ${out.cornersMax}; ${f1(out.pctCornersInTarget)}% of matches in ${CORNER_TARGET[0]}-${CORNER_TARGET[1]})   goal kicks ${f1(out.goalKicks)}/match   goals within 8 s of a corner ${f2(out.goalsFromCorners)}/match`);
  console.log(`passes / tackles   ${f1(out.passesPerMatch)} / ${f1(out.tacklesPerMatch)}   own goals ${f2(out.ownGoalsPerMatch)}`);
  console.log(`stuck ball (>${STUCK_SECONDS}s within ${STUCK_RADIUS}px)  ${f2(out.stuckEpisodesPerMatch)}/match, ${out.matchesWithStuck}/${MATCHES} matches affected, longest ${f1(out.longestStillSeconds)}s`);
  const bad = rs.filter((r) => r.stuckEpisodes > 0);
  if (bad.length) console.log(`  stuck in seeds: ${bad.map((r) => `${r.seed} (${f1(r.longestStill)}s)`).join(', ')}  -- reproduce with --seed ${SEED} --matches ${MATCHES}`);
  console.log(`dead ball (<${DEAD_SPEED}px/s for ${DEAD_SECONDS}s)  ${f2(out.deadBallPerMatch)}/match`);
  if (HUMAN) console.log(`human team         scores ${f2(out.homeGoalsPerMatch)}/match, concedes ${f2(out.awayGoalsPerMatch)}/match`);
  for (const du of out.duels) {
    if (!du.triesPerMatch && !du.winsPerMatch) continue;
    const pc = du.pctCarriesTackled === null ? '' : `   ${f1(du.pctCarriesTackled * 100)}% of the human's carries ended by an AI tackle`;
    console.log(`AI tackles on ${du.carrier.padEnd(5)}  ${f1(du.winsPerMatch)} won of ${f1(du.triesPerMatch)} tries/match (${f1(du.winRate * 100)}%)   ${f2(du.winsPerCarryMinute)} won per minute carried (${f2(du.carryMinutesPerMatch)} min/match)${pc}`);
  }
  console.log(`goals within 8s of a kickoff ${f2(out.quickGoalsPerMatch)}/match   open play ${f1(out.playSecondsPerMatch)}s/match   (${f1(out.wallSeconds)}s to simulate)`);
}
if (json) console.log(JSON.stringify(report, null, 2));

// Match-rules presets (T15): building them, checking them (they arrive over the network) and reading them. Pure.
import { AI_PROFILES, GOAL_WIDTH, GOAL_WIDTH_BIG, KEEPER_PROFILES, MATCH_RULES, SHOT_MAX_CHARGE_TIME, type AiProfile } from '../config';
import type { Difficulty, GameState, KeeperLevel, MatchRules, RulesPreset, TeamId } from './types';

export const RULES_PRESETS: readonly RulesPreset[] = ['arcade', 'classic'];
export const KEEPER_LEVELS: readonly KeeperLevel[] = ['team', 'easy', 'normal', 'hard'];

/** A preset's rules, optionally with the keepers' skill overridden (Settings → Keepers; 'rules' = the preset's own). */
export function rulesFor(preset: RulesPreset, keepers: KeeperLevel | 'rules' = 'rules'): MatchRules {
  const r = { ...MATCH_RULES[preset] };
  if (keepers !== 'rules') r.keeperDifficulty = keepers;
  return r;
}

/** The game as it was before T15 (the sim's default, so older tests and tools are unchanged). */
export const CLASSIC_RULES: MatchRules = MATCH_RULES.classic;

const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isNum = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

/** Is `v` a well-formed, sensible MatchRules (e.g. received from the host)? */
export function isMatchRules(v: unknown): v is MatchRules {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;
  return (
    RULES_PRESETS.includes(r.preset as RulesPreset) &&
    isNum(r.goalWidth, GOAL_WIDTH * 0.5, GOAL_WIDTH_BIG * 1.5) &&
    KEEPER_LEVELS.includes(r.keeperDifficulty as KeeperLevel) &&
    isNum(r.keeperCatchSpeed, 0, 5000) &&
    isBool(r.keeperFlaws) &&
    isNum(r.shotChargeTime, 0.1, SHOT_MAX_CHARGE_TIME) &&
    isBool(r.aimAssist) &&
    isBool(r.finesse) &&
    isBool(r.aimLine) &&
    isBool(r.easedDefending)
  );
}

/** Just the MatchRules fields of `r` (drops anything extra a message carried). */
export function copyRules(r: MatchRules): MatchRules {
  return {
    preset: r.preset,
    goalWidth: r.goalWidth,
    keeperDifficulty: r.keeperDifficulty,
    keeperCatchSpeed: r.keeperCatchSpeed,
    keeperFlaws: r.keeperFlaws,
    shotChargeTime: r.shotChargeTime,
    aimAssist: r.aimAssist,
    finesse: r.finesse,
    aimLine: r.aimLine,
    easedDefending: r.easedDefending,
  };
}

/** The difficulty `team`'s keeper plays at: the rules' keeper level, or the team's own AI difficulty. */
export function keeperDifficulty(state: GameState, team: TeamId): Difficulty {
  const k = state.rules.keeperDifficulty;
  return k === 'team' ? state.ai.difficulty[team] : k;
}

/** That keeper's shot-stopping: its team's AI profile, or the keeper table for a keeper given its own level. */
export function keeperProfile(state: GameState, team: TeamId): Pick<AiProfile, 'keeperReaction' | 'keeperError' | 'keeperSpeed'> {
  const k = state.rules.keeperDifficulty;
  return k === 'team' ? AI_PROFILES[state.ai.difficulty[team]] : KEEPER_PROFILES[k];
}

/** Short names for menus and the lobby. */
export function rulesLabel(preset: RulesPreset): string {
  return preset === 'arcade' ? 'Arcade' : 'Classic';
}

/** One line saying what the rules mean, for the lobby and settings. */
export function rulesSummary(r: MatchRules): string {
  const parts = [
    r.goalWidth > GOAL_WIDTH ? 'big goals' : 'normal goals',
    `${r.keeperDifficulty === 'team' ? 'keepers as AI level' : `${r.keeperDifficulty} keepers`}`,
  ];
  if (r.aimAssist) parts.push('aim assist');
  if (r.shotChargeTime < SHOT_MAX_CHARGE_TIME) parts.push('quick charge');
  if (r.finesse) parts.push('finesse shots');
  return parts.join(', ');
}

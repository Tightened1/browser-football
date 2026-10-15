// The sim's seeded random numbers. Pure: the generator's state lives in GameState (state.ai.rng), so a match is
// deterministic. Never use Math.random in the sim.
import type { AiState } from './types';

/** Seeded PRNG (mulberry32) stored in the state: returns [0, 1) and advances ai.rng. */
export function nextRandom(ai: AiState): number {
  let t = (ai.rng = (ai.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

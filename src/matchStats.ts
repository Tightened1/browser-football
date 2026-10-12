// Presentation helpers for the results screen. Pure.

export function formatTime(seconds: number): string {
  const s = Math.floor(seconds);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Possession as whole percentages that add up to 100 (50 / 50 if the ball was never touched). */
export function possessionPercent(possession: readonly [number, number]): [number, number] {
  const total = possession[0] + possession[1];
  if (total <= 0) return [50, 50];
  const home = Math.round((possession[0] / total) * 100);
  return [home, 100 - home];
}

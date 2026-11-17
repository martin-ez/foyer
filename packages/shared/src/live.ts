/** How many times a second a device may send where it's pointing, at most. */
export const pointsPerSecond = 4;

/** When the household's daily limit for positions lifts, after it was reached at `now`: the next
 *  midnight UTC, when the free plan's count of daily requests starts again. */
export function liveLimitLiftsAt(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

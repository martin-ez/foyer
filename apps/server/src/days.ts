/** The day a time falls on, by UTC, as `YYYY-MM-DD`: the day the free plan's daily limits count
 *  by. */
export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

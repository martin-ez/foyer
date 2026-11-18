/** The ISO 8601 date `days` days after `date`, or before it when `days` is negative. */
export function addDays(date: string, days: number): string {
  const [year, month, day] = partsOf(date);
  const moved = new Date(0);
  moved.setUTCFullYear(year, month - 1, day + days);
  return isoDate(moved.getUTCFullYear(), moved.getUTCMonth() + 1, moved.getUTCDate());
}

/** How many days `to` is after `from`, both ISO 8601 dates, or before it when negative. */
export function daysBetween(from: string, to: string): number {
  return Math.round((utcOf(to) - utcOf(from)) / (24 * 60 * 60 * 1000));
}

/** The month a day falls in, as an ISO 8601 month such as "2026-11". */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** The ISO 8601 date `months` months after `date`, or before it when `months` is negative, on the
 *  same day of the month, or on the month's last day when it's shorter. */
export function addMonths(date: string, months: number): string {
  const [year, month, day] = partsOf(date);
  const first = new Date(0);
  first.setUTCFullYear(year, month - 1 + months, 1);
  const [movedYear, movedMonth] = [first.getUTCFullYear(), first.getUTCMonth() + 1];
  return isoDate(movedYear, movedMonth, Math.min(day, daysInMonth(movedYear, movedMonth)));
}

/** How many days a month has, from the month as "2026-11". */
export function daysIn(month: string): number {
  const [year, number] = partsOf(month);
  return daysInMonth(year, number);
}

function daysInMonth(year: number, month: number): number {
  const last = new Date(0);
  last.setUTCFullYear(year, month, 0);
  return last.getUTCDate();
}

function utcOf(date: string): number {
  const [year, month, day] = partsOf(date);
  const utc = new Date(0);
  utc.setUTCFullYear(year, month - 1, day);
  return utc.getTime();
}

function partsOf(date: string): [number, number, number] {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  return [year, month, day];
}

function isoDate(year: number, month: number, day: number): string {
  const pad = (value: number, length: number) => String(value).padStart(length, "0");
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

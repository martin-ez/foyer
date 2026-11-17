/** Today's date by the device's clock and time zone, as an ISO 8601 date such as "2026-11-17". */
export function localToday(now = new Date()): string {
  return isoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** The ISO 8601 date `days` days after `date`, or before it when `days` is negative. */
export function addDays(date: string, days: number): string {
  const [year, month, day] = partsOf(date);
  const moved = new Date(0);
  moved.setUTCFullYear(year, month - 1, day + days);
  return isoDate(moved.getUTCFullYear(), moved.getUTCMonth() + 1, moved.getUTCDate());
}

/** A day as people read it, such as "Tuesday, November 17, 2026", in the device's language unless
 *  `locale` says otherwise. */
export function describeDay(date: string, locale?: string): string {
  const [year, month, day] = partsOf(date);
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

function partsOf(date: string): [number, number, number] {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  return [year, month, day];
}

function isoDate(year: number, month: number, day: number): string {
  const pad = (value: number, length: number) => String(value).padStart(length, "0");
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

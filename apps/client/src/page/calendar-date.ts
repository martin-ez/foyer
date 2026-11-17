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

/** A month as people read it, such as "November 2026". */
export function describeMonth(month: string, locale?: string): string {
  const [year, number] = partsOf(month);
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(
    new Date(year, number - 1, 1),
  );
}

/** A week as people read it, from its Monday to its Sunday, such as
 *  "November 16, 2026 – November 22, 2026". */
export function describeWeek(monday: string, locale?: string): string {
  return `${describeDate(monday, locale)} – ${describeDate(addDays(monday, 6), locale)}`;
}

/** The name of a day's weekday, such as "Tuesday". */
export function weekdayOf(date: string, locale?: string): string {
  const [year, month, day] = partsOf(date);
  return new Intl.DateTimeFormat(locale, { weekday: "long" }).format(
    new Date(year, month - 1, day),
  );
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

function describeDate(date: string, locale?: string): string {
  const [year, month, day] = partsOf(date);
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" }).format(
    new Date(year, month - 1, day),
  );
}

function daysInMonth(year: number, month: number): number {
  const last = new Date(0);
  last.setUTCFullYear(year, month, 0);
  return last.getUTCDate();
}

function partsOf(date: string): [number, number, number] {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  return [year, month, day];
}

function isoDate(year: number, month: number, day: number): string {
  const pad = (value: number, length: number) => String(value).padStart(length, "0");
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

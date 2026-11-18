import { addDays } from "@foyer/shared";

export { addDays, addMonths, daysIn, monthOf } from "@foyer/shared";

/** Today's date by the device's clock and time zone, as an ISO 8601 date such as "2026-11-17". */
export function localToday(now = new Date()): string {
  return isoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
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

function partsOf(date: string): [number, number, number] {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  return [year, month, day];
}

function isoDate(year: number, month: number, day: number): string {
  const pad = (value: number, length: number) => String(value).padStart(length, "0");
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

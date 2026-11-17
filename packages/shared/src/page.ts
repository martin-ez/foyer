/** A page's width and height, in points (1/72 of an inch). */
export type PageSize = { width: number; height: number };

/** An A4 sheet held upright: 210 × 297 mm. */
export const a4Portrait: PageSize = { width: 595.28, height: 841.89 };

/** An A2 sheet turned on its side, like a wall planner: 594 × 420 mm. */
export const a2Landscape: PageSize = { width: 1683.78, height: 1190.55 };

/** What a page belongs to: a month, week or day of the household's calendar, a space, or an item. */
export type PageKindName = "month" | "week" | "day" | "space" | "item";

/** The size a new page of a kind gets: A2 landscape for month and week pages, and A4 portrait for
 *  every other page. A page keeps the size it was made with. */
export function pageSizeFor(kind: PageKindName): PageSize {
  return kind === "month" || kind === "week" ? a2Landscape : a4Portrait;
}

/** The id of a month's page, such as "month:2026-11", from the month as "2026-11". */
export function monthPageId(month: string): string {
  return `month:${month}`;
}

/** The id of a week's page, such as "week:2026-11-16", named by the week's Monday. */
export function weekPageId(monday: string): string {
  return `week:${monday}`;
}

/** The Monday of the week a day falls in, as an ISO 8601 date: weeks start on Monday. */
export function firstDayOfWeek(date: string): string {
  const day = utcDateOf(date);
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return isoDateOf(day);
}

/** Whether a value is an ISO 8601 date of a Monday, the day a week's page is named by. */
export function isWeekStart(value: string): boolean {
  return isIsoDate(value) && firstDayOfWeek(value) === value;
}

/** The id of a day's page, such as "day:2026-11-14", from the day as an ISO 8601 date. */
export function dayPageId(date: string): string {
  return `day:${date}`;
}

/** The id of one of a space's pages, such as "space:<space id>:1", numbered from 1. */
export function spacePageId(spaceId: string, number: number): string {
  return `space:${spaceId}:${number}`;
}

/** The id of a task's or an event's body page, such as "item:<item id>", named by its item. */
export function itemPageId(itemId: string): string {
  return `item:${itemId}`;
}

/** Whether a value is a plain ISO 8601 date, such as "2026-11-14", of a day that exists. */
export function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number) as [number, number, number];
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function utcDateOf(date: string): Date {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  const utc = new Date(0);
  utc.setUTCFullYear(year, month - 1, day);
  return utc;
}

function isoDateOf(utc: Date): string {
  const pad = (value: number, length: number) => String(value).padStart(length, "0");
  return `${pad(utc.getUTCFullYear(), 4)}-${pad(utc.getUTCMonth() + 1, 2)}-${pad(utc.getUTCDate(), 2)}`;
}

/** Whether a value is an ISO 8601 month, such as "2026-11". */
export function isIsoMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

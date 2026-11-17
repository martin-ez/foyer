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

/** The id of a week's page, such as "week:2026-11-09", named by the week's first day. */
export function weekPageId(firstDay: string): string {
  return `week:${firstDay}`;
}

/** The id of a day's page, such as "day:2026-11-14", from the day as an ISO 8601 date. */
export function dayPageId(date: string): string {
  return `day:${date}`;
}

/** The id of one of a space's pages, such as "space:<space id>:1", numbered from 1. */
export function spacePageId(spaceId: string, number: number): string {
  return `space:${spaceId}:${number}`;
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

/** Whether a value is an ISO 8601 month, such as "2026-11". */
export function isIsoMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

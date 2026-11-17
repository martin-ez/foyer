import type { Page } from "@playwright/test";

/** The day `days` days from today, by the browser's clock and time zone, as the app describes it,
 *  such as "Tuesday, November 17, 2026" in American English. */
export function describeDayInBrowser(page: Page, days: number): Promise<string> {
  return page.evaluate((offset) => {
    const now = new Date();
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const format = { weekday: "long", day: "numeric", month: "long", year: "numeric" } as const;
    return new Intl.DateTimeFormat(undefined, format).format(day);
  }, days);
}

/** The month `months` months from this one, by the browser's clock and time zone, as the app
 *  describes it, such as "November 2026" in American English. */
export function describeMonthInBrowser(page: Page, months: number): Promise<string> {
  return page.evaluate((offset) => {
    const now = new Date();
    const month = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(month);
  }, months);
}

/** The week `weeks` weeks from this one, from its Monday to its Sunday, by the browser's clock and
 *  time zone, as the app describes it, such as "November 16, 2026 – November 22, 2026". */
export function describeWeekInBrowser(page: Page, weeks: number): Promise<string> {
  return page.evaluate((offset) => {
    const now = new Date();
    const fromMonday = (now.getDay() + 6) % 7;
    const monday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - fromMonday + 7 * offset,
    );
    const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
    const format = new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    return `${format.format(monday)} – ${format.format(sunday)}`;
  }, weeks);
}

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

import type { Locator, Page } from "@playwright/test";
import { boxOf } from "./tasks";

/** Shows the Calendar's day, week or month page. */
export function show(page: Page, span: "Day" | "Week" | "Month") {
  return page.getByRole("radio", { name: span }).click();
}

/** Opens the week page `weeks` weeks from this one. */
export async function openWeek(page: Page, weeks: number) {
  await show(page, "Week");
  await page.getByRole("button", { name: "Today" }).click();
  for (let step = 0; step < weeks; step += 1) {
    await page.getByRole("button", { name: "Next week" }).click();
  }
}

/** A weekday of the week `weeks` weeks from this one, counted from Monday as 0, as the app
 *  describes it, such as "Wednesday, December 9, 2026". */
export function describeWeekday(page: Page, weeks: number, weekday: number): Promise<string> {
  return page.evaluate(
    ([ahead, day]) => {
      const now = new Date();
      const monday = now.getDate() - ((now.getDay() + 6) % 7);
      const date = new Date(now.getFullYear(), now.getMonth(), monday + 7 * ahead + day);
      const format = { weekday: "long", day: "numeric", month: "long", year: "numeric" } as const;
      return new Intl.DateTimeFormat(undefined, format).format(date);
    },
    [weeks, weekday] as const,
  );
}

/** A day's column on a week page: the button with its name and number at the top of it. */
export function dayLabel(page: Page, day: string): Locator {
  return page.getByRole("button", { name: `Open ${day}` });
}

/** Taps an empty spot in a day's column on a week page, `down` times its label's height below
 *  its label: up to about 12 stays on the page. */
export async function tapInDay(page: Page, day: string, down: number) {
  const label = await boxOf(dayLabel(page, day));
  await page.mouse.click(label.x + label.width / 3, label.y + label.height * (1 + down));
}

/** Whether a sticker sits in a day's column on a week page. */
export async function isInColumn(page: Page, sticker: Locator, day: string): Promise<boolean> {
  const label = await boxOf(dayLabel(page, day));
  const box = await boxOf(sticker);
  const middle = box.x + box.width / 2;
  return middle > label.x && middle < label.x + label.width;
}

/** Opens the page of a weekday of the week `weeks` weeks from this one, counted from Monday as 0,
 *  and returns the day as the app describes it. */
export async function openDayInWeek(page: Page, weeks: number, weekday: number): Promise<string> {
  await openWeek(page, weeks);
  const day = await describeWeekday(page, weeks, weekday);
  await dayLabel(page, day).click();
  return day;
}

/** A day of the month `months` months from this one, by the browser's clock and time zone, as the
 *  app describes it, such as "Monday, November 15, 2027". */
export function describeDayOfMonth(page: Page, months: number, day: number): Promise<string> {
  return page.evaluate(
    ([ahead, of]) => {
      const now = new Date();
      const date = new Date(now.getFullYear(), now.getMonth() + ahead, of);
      const format = { weekday: "long", day: "numeric", month: "long", year: "numeric" } as const;
      return new Intl.DateTimeFormat(undefined, format).format(date);
    },
    [months, day] as const,
  );
}

/** Opens the page of a day of the month `months` months from this one, through the month pages,
 *  and returns the day as the app describes it. */
export async function openDayInMonth(page: Page, months: number, day: number): Promise<string> {
  await show(page, "Month");
  await page.getByRole("button", { name: "Today" }).click();
  for (let step = 0; step < months; step += 1) {
    await page.getByRole("button", { name: "Next month" }).click();
  }
  const name = await describeDayOfMonth(page, months, day);
  await page.getByRole("button", { name: `Open ${name}` }).click();
  return name;
}

/** The open day page, which holds what's on it. */
export function dayPage(page: Page, day: string): Locator {
  return page.getByLabel(day, { exact: true });
}

/** A time of day, in minutes after midnight, as the app prints it, such as "9:00 AM" in American
 *  English. */
export function describeTimeInBrowser(page: Page, minutes: number): Promise<string> {
  return page.evaluate((after) => {
    const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
    return clock.format(new Date(2000, 0, 1, 0, after));
  }, minutes);
}

/** Where a whole hour, in minutes after midnight, is printed beside a day page's timeline. */
export async function hourOnTimeline(page: Page, day: string, minutes: number) {
  const name = await describeTimeInBrowser(page, minutes);
  return boxOf(dayPage(page, day).getByText(name, { exact: true }));
}

/** Taps an empty spot on a day page's timeline at a whole hour, right of the hours. */
export async function tapOnTimeline(page: Page, day: string, minutes: number) {
  const hour = await hourOnTimeline(page, day, minutes);
  await page.mouse.click(hour.x + hour.width + 40, hour.y + hour.height / 2);
}

/** How far down the screen a sticker has to move for its top to reach a whole hour's line on a day
 *  page's timeline. */
export async function toHour(page: Page, day: string, sticker: Locator, minutes: number) {
  const hour = await hourOnTimeline(page, day, minutes);
  return hour.y + hour.height / 2 - (await boxOf(sticker)).y;
}

/** How far down the screen a sticker has to move for its middle to reach a day page's strip of
 *  things without a time, where it's named. */
export async function toStrip(page: Page, day: string, sticker: Locator) {
  const strip = await boxOf(dayPage(page, day).getByText("No time", { exact: true }));
  const box = await boxOf(sticker);
  return strip.y + strip.height / 2 - (box.y + box.height / 2);
}

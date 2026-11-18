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

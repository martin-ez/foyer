import { expect, type Page, test } from "@playwright/test";
import { describeWeekday, isInColumn, openWeek } from "./calendar-pages";
import { connectAtFakeGoogle, memberOfItsOwn } from "./google-calendar";
import { describeWeekInBrowser } from "./pages";
import { saveScreenshot } from "./screenshot";
import { repeatingEventMembers, signIn } from "./sign-in";
import { bundleBuildTimeout } from "./tasks";

/** A weekday of the week `weeks` weeks from this one, counted from Monday as 0, as an ISO 8601 date
 *  in the browser's time zone. */
function weekdayInBrowser(page: Page, weeks: number, weekday: number): Promise<string> {
  return page.evaluate(
    ([ahead, day]) => {
      const now = new Date();
      const monday = now.getDate() - ((now.getDay() + 6) % 7);
      const date = new Date(now.getFullYear(), now.getMonth(), monday + 7 * ahead + day);
      const two = (value: number) => String(value).padStart(2, "0");
      return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
    },
    [weeks, weekday] as const,
  );
}

test("shows each occurrence of a series added in Google on its day, and changes one on its own", async ({
  page,
}, testInfo) => {
  test.setTimeout(bundleBuildTimeout + 120_000);
  const email = memberOfItsOwn(repeatingEventMembers, testInfo);
  const title = `Choir ${Date.now()}`;
  await signIn(page, email);
  await expect(page.getByText("Up to date")).toBeVisible({ timeout: bundleBuildTimeout });
  await connectAtFakeGoogle(page, /^Continue as /);
  const firstDay = await weekdayInBrowser(page, 1, 2);
  const nextDay = await weekdayInBrowser(page, 1, 3);

  const google = await page.context().newPage();
  const calendar = google.getByRole("region", { name: `Foyer · Personal (dev:${email})` });
  await expect(async () => {
    await google.goto("/auth/dev/google/calendar");
    await expect(calendar).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  await calendar.getByLabel("Title", { exact: true }).fill(title);
  await calendar.getByLabel("Starts").fill(firstDay);
  await calendar.getByLabel("Ends").fill(nextDay);
  await calendar.getByLabel("Repeats").fill("FREQ=WEEKLY;COUNT=4");
  await calendar.getByRole("button", { name: "Add event" }).click();
  await expect(calendar).toContainText("repeating RRULE:FREQ=WEEKLY;COUNT=4");

  await page.getByRole("tab", { name: "Calendar" }).click();
  const upcoming = page.getByRole("list", { name: "Upcoming events" });
  const occurrences = upcoming.getByRole("button", { name: `Event: ${title}`, exact: true });
  await expect(occurrences).toHaveCount(4, { timeout: 90_000 });
  await expect(occurrences.first()).toContainText("repeats");
  await saveScreenshot(page, testInfo, "repeating-events-upcoming");

  const weeks = 2;
  await openWeek(page, weeks);
  const wednesday = await describeWeekday(page, weeks, 2);
  const onItsDay = page
    .getByLabel(await describeWeekInBrowser(page, weeks), { exact: true })
    .getByRole("button", { name: `Event: ${title}`, exact: true });
  await expect(onItsDay).toBeVisible();
  expect(await isInColumn(page, onItsDay, wednesday)).toBe(true);
  await saveScreenshot(page, testInfo, "repeating-event-on-its-day");

  await onItsDay.click();
  await expect(page.getByText("Repeats. Changes here are to this day only")).toBeVisible();
  await expect(
    page.getByText("A repeating event moves with its series, in Google Calendar."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Move to / })).toHaveCount(0);
  await page.getByLabel("Title").fill(`${title}, at Ana's`);
  await saveScreenshot(page, testInfo, "repeating-event-editor");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: "Close" }).click();

  await expect(upcoming.getByRole("button", { name: `Event: ${title}, at Ana's` })).toHaveCount(1);
  await expect(occurrences).toHaveCount(3);
  await expect(async () => {
    await google.reload();
    await expect(calendar).toContainText(`${title}, at Ana's`, { timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  await expect(calendar).toContainText("one occurrence changed in its series");
  await google.close();
});

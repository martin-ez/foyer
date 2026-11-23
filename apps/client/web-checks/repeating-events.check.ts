import { expect, type Page, test } from "@playwright/test";
import { describeWeekday, isInColumn, openWeek } from "./calendar-pages";
import { connectAtFakeGoogle, memberOfItsOwn } from "./google-calendar";
import { describeWeekInBrowser } from "./pages";
import { saveScreenshot } from "./screenshot";
import { repeatingEventMembers, signIn } from "./sign-in";
import { addTask, bundleBuildTimeout, createSpaceOfItsOwn, openSpace } from "./tasks";

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

test("lists each series added in Google once, shows each occurrence on its day, and changes one on its own", async ({
  page,
}, testInfo) => {
  test.setTimeout(bundleBuildTimeout + 120_000);
  const email = memberOfItsOwn(repeatingEventMembers, testInfo);
  const stamp = Date.now();
  const title = `Choir ${stamp}`;
  const daily = `Walk ${stamp}`;
  await signIn(page, email);
  await expect(page.getByText("Up to date")).toBeVisible({ timeout: bundleBuildTimeout });
  await connectAtFakeGoogle(page, /^Continue as /);
  const otherSpace = await createSpaceOfItsOwn(page);
  await openSpace(page, otherSpace);
  const elsewhere = await addTask(page, `${title} sheet music`);
  await openSpace(page, "Personal");
  const sameSpace = await addTask(page, `${title} practice`);
  const firstDay = await weekdayInBrowser(page, 1, 2);
  const nextDay = await weekdayInBrowser(page, 1, 3);

  const google = await page.context().newPage();
  const calendar = google.getByRole("region", { name: `Foyer · Personal (dev:${email})` });
  await expect(async () => {
    await google.goto("/auth/dev/google/calendar");
    await expect(calendar).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  for (const [name, rule] of [
    [title, "FREQ=WEEKLY;COUNT=4"],
    [daily, "FREQ=DAILY;COUNT=10"],
  ] as const) {
    await calendar.getByLabel("Title", { exact: true }).fill(name);
    await calendar.getByLabel("Starts").fill(firstDay);
    await calendar.getByLabel("Ends").fill(nextDay);
    await calendar.getByLabel("Repeats").fill(rule);
    await calendar.getByRole("button", { name: "Add event" }).click();
    await expect(calendar).toContainText(`repeating RRULE:${rule}`);
  }

  await page.getByRole("tab", { name: "Calendar" }).click();
  const weeks = 2;
  await openWeek(page, weeks);
  const wednesday = await describeWeekday(page, weeks, 2);
  const week = page.getByLabel(await describeWeekInBrowser(page, weeks), { exact: true });
  const onItsDay = week.getByRole("button", { name: `Event: ${title}`, exact: true });
  const walks = week.getByRole("button", { name: `Event: ${daily}`, exact: true });
  await expect(onItsDay).toBeVisible({ timeout: 90_000 });
  expect(await isInColumn(page, onItsDay, wednesday)).toBe(true);
  await expect(walks).toHaveCount(5);
  await saveScreenshot(page, testInfo, "repeating-event-on-its-day");

  const upcoming = page.getByRole("list", { name: "Upcoming events" });
  const nextChoir = upcoming.getByRole("button", { name: `Event: ${title}`, exact: true });
  const nextWalk = upcoming.getByRole("button", { name: `Event: ${daily}`, exact: true });
  await expect(nextChoir).toHaveCount(1);
  await expect(nextWalk).toHaveCount(1);
  await expect(nextChoir).toContainText(await describeWeekday(page, 1, 2));
  await expect(nextChoir).toContainText("repeats");
  await expect(nextWalk).toContainText("repeats");
  await saveScreenshot(page, testInfo, "repeating-events-upcoming");

  await onItsDay.click();
  await expect(page.getByText("Repeats. Changes here are to this day only")).toBeVisible();
  await expect(
    page.getByText("A repeating event moves with its series, in Google Calendar."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Move to / })).toHaveCount(0);
  await page.getByLabel("Put it under a task").fill(title);
  await expect(page.getByRole("button", { name: `Put under “${sameSpace}”` })).toBeVisible();
  await expect(
    page.getByRole("button", { name: `Put under “${elsewhere}” in ${otherSpace}` }),
  ).toHaveCount(0);
  await page.getByLabel("Put it under a task").fill("");
  await page.getByLabel("Title").fill(`${title}, at Ana's`);
  await saveScreenshot(page, testInfo, "repeating-event-editor");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: "Close" }).click();

  await expect(week.getByRole("button", { name: `Event: ${title}, at Ana's` })).toBeVisible();
  await expect(upcoming.getByRole("button", { name: `Event: ${title}, at Ana's` })).toHaveCount(0);
  await expect(nextChoir).toHaveCount(1);
  await expect(async () => {
    await google.reload();
    await expect(calendar).toContainText(`${title}, at Ana's`, { timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  await expect(calendar).toContainText("one occurrence changed in its series");
  await google.close();
});

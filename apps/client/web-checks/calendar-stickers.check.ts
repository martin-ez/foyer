import { expect, type Locator, type Page, type TestInfo, test } from "@playwright/test";
import { saveScreenshot } from "./screenshot";
import { householdMembers, signIn } from "./sign-in";
import { boxOf, bundleBuildTimeout, drag, pageTitle, stickerOf } from "./tasks";

test.beforeEach(() => {
  test.setTimeout(bundleBuildTimeout + 90_000);
});

/** The checks for the iPad's viewport and the phone's run at once as the same member, so each
 *  works on a week of its own, ahead of today, where nothing else puts tasks. */
function weeksAhead(testInfo: TestInfo): number {
  return testInfo.project.name === "ipad" ? 3 : 4;
}

async function openCalendar(page: Page, email?: string) {
  await signIn(page, email);
  await expect(page.getByText("Up to date")).toBeVisible({ timeout: bundleBuildTimeout });
  await page.getByRole("tab", { name: "Calendar" }).click();
}

function show(page: Page, span: "Day" | "Week" | "Month") {
  return page.getByRole("radio", { name: span }).click();
}

/** Opens the week page `weeks` weeks from this one. */
async function openWeek(page: Page, weeks: number) {
  await show(page, "Week");
  await page.getByRole("button", { name: "Today" }).click();
  for (let step = 0; step < weeks; step += 1) {
    await page.getByRole("button", { name: "Next week" }).click();
  }
}

/** A weekday of the week `weeks` weeks from this one, counted from Monday as 0, as the app
 *  describes it, such as "Wednesday, December 9, 2026". */
function describeWeekday(page: Page, weeks: number, weekday: number): Promise<string> {
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
function dayLabel(page: Page, day: string): Locator {
  return page.getByRole("button", { name: `Open ${day}` });
}

/** Taps an empty spot in a day's column on a week page, `down` times its label's height below
 *  its label. */
async function tapInDay(page: Page, day: string, down: number) {
  const label = await boxOf(dayLabel(page, day));
  await page.mouse.click(label.x + label.width / 3, label.y + label.height * (1 + down));
}

/** Whether a sticker sits in a day's column on a week page. */
async function isInColumn(page: Page, sticker: Locator, day: string): Promise<boolean> {
  const label = await boxOf(dayLabel(page, day));
  const box = await boxOf(sticker);
  const middle = box.x + box.width / 2;
  return middle > label.x && middle < label.x + label.width;
}

/** Adds a task to a day of the open week page, by tapping an empty spot in it, and returns its
 *  title once it's saved. */
async function addTaskToDay(
  page: Page,
  day: string,
  down: number,
  space = "Inbox",
): Promise<string> {
  const title = `Pick up the parcel ${Date.now()}`;
  await tapInDay(page, day, down);
  await expect(page.getByText(`Add to ${day}`)).toBeVisible();
  await page.getByLabel("Title").fill(title);
  await page.getByRole("checkbox", { name: `In ${space}` }).click();
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(stickerOf(page, title)).toBeVisible();
  await expect(page.getByText(/not saved yet/)).toBeHidden();
  return title;
}

async function deleteTask(page: Page, title: string) {
  await stickerOf(page, title).click();
  await page.getByRole("button", { name: "Delete task" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(stickerOf(page, title)).toBeHidden();
}

test("adds a task to a day where it was tapped, which shows on its month, week and day pages on another device", async ({
  page,
}, testInfo) => {
  const weeks = weeksAhead(testInfo);
  await openCalendar(page);
  await openWeek(page, weeks);
  const wednesday = await describeWeekday(page, weeks, 2);

  await tapInDay(page, wednesday, 4);
  await expect(page.getByText(`Add to ${wednesday}`)).toBeVisible();
  await saveScreenshot(page, testInfo, "add-to-day");
  await page.getByRole("button", { name: "Close" }).click();
  const title = await addTaskToDay(page, wednesday, 4);
  expect(await isInColumn(page, stickerOf(page, title), wednesday)).toBe(true);
  await saveScreenshot(page, testInfo, "added-to-day-week");

  const other = await page.context().newPage();
  await openCalendar(other);
  await openWeek(other, weeks);
  await expect(stickerOf(other, title)).toBeVisible();
  expect(await isInColumn(other, stickerOf(other, title), wednesday)).toBe(true);
  await show(other, "Month");
  await expect(stickerOf(other, title)).toBeVisible();
  await saveScreenshot(other, testInfo, "added-to-day-month");
  await dayLabel(other, wednesday).click();
  await expect(pageTitle(other)).toHaveText(wednesday);
  await expect(stickerOf(other, title)).toBeVisible();

  await deleteTask(page, title);
  await expect(stickerOf(other, title)).toBeHidden();
});

test("asks before moving a sticker to another day, puts it back on no, and moves the task on yes", async ({
  page,
}, testInfo) => {
  const weeks = weeksAhead(testInfo);
  await openCalendar(page);
  await openWeek(page, weeks);
  const wednesday = await describeWeekday(page, weeks, 2);
  const thursday = await describeWeekday(page, weeks, 3);
  const title = await addTaskToDay(page, wednesday, 6);
  const sticker = stickerOf(page, title);
  const column = (await boxOf(dayLabel(page, wednesday))).width;

  await drag(page, sticker, { x: column, y: 0 });
  await expect(page.getByText(`Did you mean to change the date to ${thursday}?`)).toBeVisible();
  await saveScreenshot(page, testInfo, "change-the-date");
  await page.getByRole("button", { name: "Put it back" }).click();
  expect(await isInColumn(page, sticker, wednesday)).toBe(true);

  const other = await page.context().newPage();
  await openCalendar(other);
  await openWeek(other, weeks);
  await expect(stickerOf(other, title)).toBeVisible();

  await drag(page, sticker, { x: column, y: 0 });
  await page.getByRole("button", { name: "Change the date" }).click();
  await expect(page.getByText(/not saved yet/)).toBeHidden();
  expect(await isInColumn(page, sticker, thursday)).toBe(true);
  await expect
    .poll(() => isInColumn(other, stickerOf(other, title), thursday), { timeout: 10_000 })
    .toBe(true);
  await saveScreenshot(other, testInfo, "moved-to-another-day");
  await dayLabel(other, thursday).click();
  await expect(pageTitle(other)).toHaveText(thursday);
  await expect(stickerOf(other, title)).toBeVisible();

  await deleteTask(page, title);
});

test("moves a sticker within its day without asking", async ({ page }, testInfo) => {
  const weeks = weeksAhead(testInfo);
  await openCalendar(page);
  await openWeek(page, weeks);
  const wednesday = await describeWeekday(page, weeks, 2);
  const title = await addTaskToDay(page, wednesday, 8);
  const sticker = stickerOf(page, title);
  const before = await boxOf(sticker);

  await drag(page, sticker, { x: 0, y: before.height * 3 });

  await expect(page.getByRole("dialog")).toBeHidden();
  await expect.poll(async () => (await boxOf(sticker)).y).toBeGreaterThan(before.y + before.height);
  expect(await isInColumn(page, sticker, wednesday)).toBe(true);

  await deleteTask(page, title);
});

test("shows another member a task they can't see as a hidden sticker on its day", async ({
  page,
  browser,
}, testInfo) => {
  const [, housemate] = householdMembers();
  test.skip(housemate === undefined, "Needs a second email in HOUSEHOLD_MEMBERS");
  const weeks = weeksAhead(testInfo);
  const theirs = await (await browser.newContext({ ...testInfo.project.use })).newPage();
  await openCalendar(theirs, housemate);
  await openWeek(theirs, weeks);
  const wednesday = await describeWeekday(theirs, weeks, 2);
  const hidden = theirs.getByRole("button", { name: "Task, hidden" });
  const before = await hidden.count();

  await openCalendar(page);
  await openWeek(page, weeks);
  const title = await addTaskToDay(page, wednesday, 10, "Personal");

  await expect(hidden).toHaveCount(before + 1);
  await expect(theirs.getByRole("button", { name: `Task: ${title}` })).toHaveCount(0);
  expect(await isInColumn(theirs, hidden.last(), wednesday)).toBe(true);
  await saveScreenshot(theirs, testInfo, "hidden-on-day");

  await deleteTask(page, title);
  await expect(hidden).toHaveCount(before);
});

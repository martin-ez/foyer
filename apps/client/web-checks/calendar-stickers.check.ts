import { expect, type Locator, type Page, type TestInfo, test } from "@playwright/test";
import { dayLabel, describeWeekday, isInColumn, openWeek, show, tapInDay } from "./calendar-pages";
import { saveScreenshot } from "./screenshot";
import { householdMembers, signIn } from "./sign-in";
import { addTask, boxOf, bundleBuildTimeout, drag, openInbox, pageTitle, stickerOf } from "./tasks";

test.beforeEach(() => {
  test.setTimeout(bundleBuildTimeout + 90_000);
});

function weeksAhead(testInfo: TestInfo): number {
  return testInfo.project.name === "ipad" ? 3 : 4;
}

async function openCalendar(page: Page, email?: string) {
  await signIn(page, email);
  await expect(page.getByText("Up to date")).toBeVisible({ timeout: bundleBuildTimeout });
  await page.getByRole("tab", { name: "Calendar" }).click();
}

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

test("puts a sticker dropped outside any day back without asking", async ({ page }, testInfo) => {
  const weeks = weeksAhead(testInfo);
  await openCalendar(page);
  await openWeek(page, weeks);
  const wednesday = await describeWeekday(page, weeks, 2);
  const title = await addTaskToDay(page, wednesday, 12);
  const sticker = stickerOf(page, title);
  const before = await boxOf(sticker);
  const label = await boxOf(dayLabel(page, wednesday));

  const middle = before.y + before.height / 2;
  await drag(page, sticker, { x: 0, y: label.y + label.height / 2 - middle });

  await expect(page.getByRole("dialog")).toBeHidden();
  await expect.poll(async () => (await boxOf(sticker)).y).toBeCloseTo(before.y, 0);

  await deleteTask(page, title);
});

test("ticks a task on the calendar, which shows as done on its other pages and devices", async ({
  page,
}, testInfo) => {
  const weeks = weeksAhead(testInfo);
  await openCalendar(page);
  await openWeek(page, weeks);
  const wednesday = await describeWeekday(page, weeks, 2);
  const title = await addTaskToDay(page, wednesday, 2);
  const done = (on: Page) => on.getByRole("checkbox", { name: `Done: ${title}` });

  await done(page).click();

  await expect(done(page)).toBeChecked();
  const other = await page.context().newPage();
  await openCalendar(other);
  await openWeek(other, weeks);
  await show(other, "Month");
  await expect(done(other)).toBeChecked();
  await done(other).click();
  await expect(done(page)).not.toBeChecked();

  await deleteTask(page, title);
});

test("gives an open task without a date the day tapped", async ({ page }, testInfo) => {
  const weeks = weeksAhead(testInfo);
  await openInbox(page);
  const title = await addTask(page);
  await page.getByRole("tab", { name: "Calendar" }).click();
  await openWeek(page, weeks);
  const wednesday = await describeWeekday(page, weeks, 2);

  await tapInDay(page, wednesday, 3);
  await page.getByRole("button", { name: `Put “${title}” on this day` }).click();

  await expect(stickerOf(page, title)).toBeVisible();
  expect(await isInColumn(page, stickerOf(page, title), wednesday)).toBe(true);
  await saveScreenshot(page, testInfo, "undated-task-given-a-day");

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

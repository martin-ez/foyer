import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { expectOnAnotherDevice } from "./another-device";
import { describeWeekday, isInColumn, openWeek, tapInDay } from "./calendar-pages";
import { connectAtFakeGoogle, memberOfItsOwn } from "./google-calendar";
import { saveScreenshot } from "./screenshot";
import { archivedEventMembers, housemate, signIn } from "./sign-in";
import {
  addTask,
  boxOf,
  bundleBuildTimeout,
  createSpaceOfItsOwn,
  drag,
  openApp,
  openSpace,
  pageTitle,
  stickerOf,
} from "./tasks";

test.beforeEach(() => {
  test.setTimeout(bundleBuildTimeout + 120_000);
});

async function showSpaces(page: Page) {
  await page.getByRole("tab", { name: "Tasks" }).click();
  await page.getByRole("button", { name: "Spaces", exact: true }).click();
}

async function hideSpaces(page: Page) {
  await page.getByRole("button", { name: "Hide spaces" }).click();
}

async function createSharedSpace(page: Page): Promise<string> {
  const name = `Shared ${randomUUID().slice(0, 8)}`;
  await showSpaces(page);
  await page.getByLabel("New space's name").fill(name);
  await page.getByRole("button", { name: "Create shared" }).click();
  await expect(page.getByRole("button", { name: `Open ${name}` })).toBeVisible();
  await expect(page.getByText(/not saved yet/)).toBeHidden();
  await hideSpaces(page);
  return name;
}

async function addTaskToDay(page: Page, day: string, space: string): Promise<string> {
  const title = `Return the library books ${Date.now()}`;
  await tapInDay(page, day, 4);
  await page.getByLabel("Title").fill(title);
  await page.getByRole("checkbox", { name: `In ${space}` }).click();
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(stickerOf(page, title)).toBeVisible();
  await expect(page.getByText(/not saved yet/)).toBeHidden();
  return title;
}

test("archives a shared space out of every list and picker on each device, keeps its tasks on the calendar read-only, and restores it", async ({
  page,
  browser,
}, testInfo) => {
  const weeks = testInfo.project.name === "ipad" ? 21 : 22;
  await openApp(page);
  const space = await createSharedSpace(page);
  await page.getByRole("tab", { name: "Calendar" }).click();
  await openWeek(page, weeks);
  const wednesday = await describeWeekday(page, weeks, 2);
  const friday = await describeWeekday(page, weeks, 4);
  const title = await addTaskToDay(page, wednesday, space);
  const own = await createSpaceOfItsOwn(page);
  await openSpace(page, own);
  const ownTask = await addTask(page);
  const theirs = await (await browser.newContext({ ...testInfo.project.use })).newPage();
  await signIn(theirs, housemate);
  await expect(theirs.getByText("Up to date")).toBeVisible({ timeout: bundleBuildTimeout });
  await showSpaces(theirs);
  await expect(theirs.getByRole("button", { name: `Open ${space}` })).toBeVisible();
  await openSpace(page, space);

  await page.getByRole("button", { name: "Spaces", exact: true }).click();
  await page.getByRole("button", { name: `Archive ${space}` }).click();

  for (const device of [page, theirs]) {
    await expectOnAnotherDevice(device.getByRole("button", { name: `Open ${space}` })).toBeHidden();
    const archived = device.getByRole("list", { name: "Archived spaces" });
    await expect(archived.getByRole("button", { name: `Restore ${space}` })).toBeVisible();
  }
  await saveScreenshot(theirs, testInfo, "archived-space-in-spaces");
  await hideSpaces(page);
  await expect(pageTitle(page)).toHaveText(/^Inbox, page \d+$/);
  await page.getByRole("button", { name: "All lists" }).click();
  await expect(page.getByRole("list", { name: "Today" })).toBeVisible();
  await expect(page.getByRole("list", { name: space })).toHaveCount(0);
  await page.getByRole("button", { name: "Hide all lists" }).click();
  await openSpace(page, own);
  await stickerOf(page, ownTask).click();
  await page.getByLabel("Put it under another task").fill(title);
  await expect(page.getByRole("button", { name: /^Put under/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Close" }).click();

  await page.getByRole("tab", { name: "Calendar" }).click();
  await tapInDay(page, friday, 6);
  await expect(page.getByText(`Add to ${friday}`)).toBeVisible();
  await expect(page.getByRole("checkbox", { name: `In ${space}` })).toHaveCount(0);
  await page.getByRole("button", { name: "Close" }).click();

  const sticker = page.getByRole("button", { name: `Task: ${title}, archived` });
  const before = await boxOf(sticker);
  await drag(page, sticker, { x: before.width * 2, y: before.height * 2 });
  expect(await boxOf(sticker)).toEqual(before);
  await expect(page.getByRole("dialog", { name: "Change the date?" })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: `Done: ${title}` })).toBeDisabled();
  await sticker.click();
  await expect(page.getByText(`In ${space}, which is archived.`, { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete task" })).toHaveCount(0);
  await saveScreenshot(page, testInfo, "archived-task-on-calendar");
  await page.getByRole("button", { name: "Close" }).click();

  await theirs.getByRole("button", { name: `Restore ${space}` }).click();

  await expectOnAnotherDevice(sticker).toHaveCount(0);
  expect(await isInColumn(page, stickerOf(page, title), wednesday)).toBe(true);
  await showSpaces(page);
  await expect(page.getByRole("button", { name: `Open ${space}` })).toBeVisible();
  await hideSpaces(page);
  await page.getByRole("tab", { name: "Calendar" }).click();
  await stickerOf(page, title).click();
  await page.getByRole("button", { name: "Delete task" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(stickerOf(page, title)).toBeHidden();
});

test("leaves an archived space's events out of Upcoming events, and opens them read-only", async ({
  page,
}, testInfo) => {
  await signIn(page, memberOfItsOwn(archivedEventMembers, testInfo));
  await expect(page.getByText("Up to date")).toBeVisible({ timeout: bundleBuildTimeout });
  await connectAtFakeGoogle(page, /^Continue as /);
  const dinner = `Dinner ${Date.now()}`;
  await page.getByRole("tab", { name: "Calendar" }).click();
  await page.getByRole("button", { name: "New event" }).click();
  await page.getByLabel("Title").fill(dinner);
  await page.getByRole("checkbox", { name: "All day" }).click();
  const tomorrow = await page.evaluate(() => {
    const day = new Date();
    day.setDate(day.getDate() + 1);
    const two = (value: number) => String(value).padStart(2, "0");
    return `${day.getFullYear()}-${two(day.getMonth() + 1)}-${two(day.getDate())}`;
  });
  await page.getByLabel("First day").fill(tomorrow);
  await page.getByLabel("Last day").fill(tomorrow);
  await page.getByRole("checkbox", { name: "In Personal" }).click();
  await page.getByRole("button", { name: "Add event" }).click();
  const upcoming = page.getByRole("list", { name: "Upcoming events" });
  await expect(upcoming.getByLabel(`Event: ${dinner}`)).toBeVisible();

  await showSpaces(page);
  await page.getByRole("button", { name: "Archive Personal" }).click();
  await hideSpaces(page);
  await page.getByRole("tab", { name: "Calendar" }).click();

  await expect(upcoming.getByLabel(`Event: ${dinner}`)).toHaveCount(0);
  await page.getByRole("button", { name: "Next day" }).click();
  await page.getByRole("button", { name: `Event: ${dinner}, archived` }).click();
  await expect(page.getByText("In Personal, which is archived.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete event" })).toHaveCount(0);
  await saveScreenshot(page, testInfo, "archived-event-on-calendar");
  await page.getByRole("button", { name: "Close" }).click();

  await showSpaces(page);
  await page.getByRole("button", { name: "Restore Personal" }).click();
  await hideSpaces(page);
  await page.getByRole("tab", { name: "Calendar" }).click();
  await expect(upcoming.getByLabel(`Event: ${dinner}`)).toBeVisible();
});

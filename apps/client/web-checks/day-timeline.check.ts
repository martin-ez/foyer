import { expect, type Page, type TestInfo, test } from "@playwright/test";
import { expectOnAnotherDevice } from "./another-device";
import {
  dayPage,
  describeTimeInBrowser,
  openDayInWeek,
  tapOnTimeline,
  toHour,
  toStrip,
} from "./calendar-pages";
import { saveScreenshot } from "./screenshot";
import { signIn } from "./sign-in";
import { bundleBuildTimeout, createSpaceOfItsOwn, drag, openApp, stickerOf } from "./tasks";

test.beforeEach(() => {
  test.setTimeout(bundleBuildTimeout + 120_000);
});

function weeksAhead(testInfo: TestInfo): number {
  return testInfo.project.name === "ipad" ? 7 : 8;
}

async function openTheDayOnAnotherDevice(page: Page, weeks: number): Promise<Page> {
  const other = await page.context().newPage();
  await signIn(other);
  await expect(other.getByText("Up to date")).toBeVisible({ timeout: bundleBuildTimeout });
  await other.getByRole("tab", { name: "Calendar" }).click();
  await openDayInWeek(other, weeks, 2);
  return other;
}

test("moves a task along a day page's timeline, changing its time on every device, and the strip takes its time off", async ({
  page,
}, testInfo) => {
  const weeks = weeksAhead(testInfo);
  await openApp(page);
  const space = await createSpaceOfItsOwn(page);
  await page.getByRole("tab", { name: "Calendar" }).click();
  const day = await openDayInWeek(page, weeks, 2);
  const nine = await describeTimeInBrowser(page, 9 * 60);
  const two = await describeTimeInBrowser(page, 14 * 60);
  const four = await describeTimeInBrowser(page, 16 * 60);
  const title = `Water the plants ${Date.now()}`;
  const timed = (on: Page, time: string) =>
    dayPage(on, day).getByRole("button", { name: `Task: ${title}, at ${time}` });

  await tapOnTimeline(page, day, 9 * 60);
  await expect(page.getByText(`Add to ${day} at ${nine}`)).toBeVisible();
  await page.getByLabel("Title").fill(title);
  await page.getByRole("checkbox", { name: `In ${space}` }).click();
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(timed(page, nine)).toBeVisible();
  await expect(page.getByText(/not saved yet/)).toBeHidden();
  expect(await toHour(page, day, timed(page, nine), 9 * 60)).toBeCloseTo(0, 0);

  const other = await openTheDayOnAnotherDevice(page, weeks);
  await expect(timed(other, nine)).toBeVisible();

  await drag(page, timed(page, nine), {
    x: 0,
    y: await toHour(page, day, timed(page, nine), 14 * 60),
  });
  await expect(timed(page, two)).toBeVisible();
  expect(await toHour(page, day, timed(page, two), 14 * 60)).toBeCloseTo(0, 0);
  await expectOnAnotherDevice(timed(other, two)).toBeVisible();
  await expectOnAnotherDevice
    .poll(async () => toHour(other, day, timed(other, two), 14 * 60))
    .toBeCloseTo(0, 0);
  await saveScreenshot(other, testInfo, "task-on-timeline");

  await timed(page, two).click();
  await page.getByLabel("Time").fill("4pm");
  await expect(page.getByText("A time is hours and minutes, as in 19:00.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
  await page.getByLabel("Time").fill("16:00");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(timed(page, four)).toBeVisible();
  await expect.poll(async () => toHour(page, day, timed(page, four), 16 * 60)).toBeCloseTo(0, 0);
  await expectOnAnotherDevice(timed(other, four)).toBeVisible();

  const sticker = stickerOf(page, title);
  await drag(page, sticker, { x: 0, y: await toStrip(page, day, sticker) });
  await expect(sticker).toHaveAccessibleName(`Task: ${title}`);
  await expectOnAnotherDevice(stickerOf(other, title)).toHaveAccessibleName(`Task: ${title}`);
  await saveScreenshot(page, testInfo, "task-in-strip");

  await sticker.click();
  await page.getByRole("button", { name: "Delete task" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(sticker).toBeHidden();
});

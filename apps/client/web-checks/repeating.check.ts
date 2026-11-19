import { expect, type Page, test } from "@playwright/test";
import { expectOnAnotherDevice } from "./another-device";
import { saveScreenshot } from "./screenshot";
import {
  addTask,
  bundleBuildTimeout,
  openSpaceOfItsOwn,
  sameMemberOnAnotherDevice,
  stickerOf,
  todayInBrowser,
} from "./tasks";

let space = "";

test.beforeEach(async ({ page }) => {
  test.setTimeout(bundleBuildTimeout + 60_000);
  space = await openSpaceOfItsOwn(page);
});

function addDays(date: string, days: number): string {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function weekdayOf(date: string): string {
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return names[new Date(`${date}T00:00:00Z`).getUTCDay()] ?? "";
}

async function openNewTask(page: Page, date: string): Promise<string> {
  const title = await addTask(page);
  await stickerOf(page, title).click();
  await page.getByLabel("Date").fill(date);
  return title;
}

test("repeats a task weekly, moves it to its next date when ticked, and unticks it", async ({
  page,
}, testInfo) => {
  const today = await todayInBrowser(page);
  const nextWeek = addDays(today, 7);
  const title = await openNewTask(page, today);

  await page.getByRole("radio", { name: "Weekly" }).click();
  await expect(page.getByText(`Every week on ${weekdayOf(today)}`)).toBeVisible();
  await expect(page.getByRole("checkbox", { name: weekdayOf(today) })).toBeChecked();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
  await expect(page.getByText(/not saved yet/)).toBeHidden();

  const done = page.getByRole("checkbox", { name: "Done", exact: true });
  await done.click();

  await expect(page.getByLabel("Date")).toHaveValue(nextWeek);
  await expect(done).not.toBeChecked();
  const doneBefore = page.getByRole("list", { name: "Done before" });
  await expect(doneBefore.getByText(`${today}, ticked by`)).toBeVisible();
  await expect(page.getByText(/not saved yet|Couldn't save/)).toBeHidden();
  await saveScreenshot(page, testInfo, "repeating-task-ticked");

  const other = await sameMemberOnAnotherDevice(page, space);
  await other.getByRole("button", { name: "List", exact: true }).click();
  const otherList = other.getByRole("list", { name: space });
  await expect(
    otherList.getByRole("button", { name: `${title} · ${nextWeek}, repeats` }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(stickerOf(page, `${title}, repeats, next on ${nextWeek}`)).toBeVisible();
  await saveScreenshot(page, testInfo, "repeating-sticker");
  await stickerOf(page, title).click();

  await doneBefore.getByRole("button", { name: `Untick ${today}` }).click();

  await expect(page.getByLabel("Date")).toHaveValue(today);
  await expect(doneBefore).toBeHidden();
  await expectOnAnotherDevice(
    otherList.getByRole("button", { name: `${title} · ${today}, repeats` }),
  ).toBeVisible();
});

test("repeats a task from when it's done, skipping the days it was overdue", async ({
  page,
}, testInfo) => {
  const today = await todayInBrowser(page);
  await openNewTask(page, addDays(today, -10));

  await page.getByRole("radio", { name: "Daily" }).click();
  await page.getByLabel("Repeat every how many days").fill("3");
  await page.getByRole("radio", { name: "After it's done" }).click();
  await expect(page.getByText("Every 3 days after it's done")).toBeVisible();
  await saveScreenshot(page, testInfo, "repeat-picker");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/not saved yet/)).toBeHidden();

  await page.getByRole("checkbox", { name: "Done", exact: true }).click();

  await expect(page.getByLabel("Date")).toHaveValue(addDays(today, 3));
  await expect(page.getByText(/not saved yet|Couldn't save/)).toBeHidden();
});

test("chooses the days a task repeats on, moving its date to the first of them", async ({
  page,
}) => {
  const today = await todayInBrowser(page);
  const tomorrow = addDays(today, 1);
  const title = await openNewTask(page, today);
  const save = page.getByRole("button", { name: "Save" });
  await page.getByRole("radio", { name: "Weekly" }).click();

  await page.getByRole("checkbox", { name: weekdayOf(tomorrow) }).click();
  await page.getByRole("checkbox", { name: weekdayOf(today) }).click();

  await expect(page.getByText(`Every week on ${weekdayOf(tomorrow)}`)).toBeVisible();
  await expect(page.getByLabel("Date")).toHaveValue(tomorrow);

  await page.getByRole("checkbox", { name: weekdayOf(tomorrow) }).click();

  await expect(page.getByText("Choose the days it repeats on.")).toBeVisible();
  await expect(save).toBeDisabled();

  const day = Number(tomorrow.slice(8));
  const place = ["first", "second", "third", "fourth", "fifth"][Math.ceil(day / 7) - 1];
  const weekdayInMonth = `on the ${place} ${weekdayOf(tomorrow)}`;
  await page.getByRole("radio", { name: "Monthly" }).click();
  await page.getByRole("radio", { name: weekdayInMonth }).click();

  await expect(page.getByText(`Every month ${weekdayInMonth}`)).toBeVisible();

  await page.getByRole("radio", { name: "After it's done" }).click();

  await expect(page.getByRole("radio", { name: weekdayInMonth })).toBeHidden();
  await expect(page.getByText("Every month after it's done")).toBeVisible();

  await page.getByRole("radio", { name: "On its schedule" }).click();

  await expect(page.getByText(`Every month on day ${day}`)).toBeVisible();
  await save.click();
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "List", exact: true }).click();
  const list = page.getByRole("list", { name: space });
  await expect(list.getByRole("button", { name: `${title} · ${tomorrow}, repeats` })).toBeVisible();
});

test("stops a task repeating, keeping its date", async ({ page }) => {
  const today = await todayInBrowser(page);
  const title = await openNewTask(page, today);
  await page.getByRole("radio", { name: "Monthly" }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(stickerOf(page, `${title}, repeats`)).toBeVisible();
  await stickerOf(page, title).click();

  await page.getByRole("radio", { name: "Never" }).click();
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByRole("radio", { name: "Never" })).toBeChecked();
  await expect(page.getByLabel("Date")).toHaveValue(today);
  await page.getByRole("button", { name: "Close" }).click();
  await expect(stickerOf(page, title)).toBeVisible();
  await expect(stickerOf(page, `${title}, repeats`)).toBeHidden();
  await expect(page.getByText(/not saved yet|Couldn't save/)).toBeHidden();
});

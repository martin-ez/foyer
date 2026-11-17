import { expect, test } from "@playwright/test";
import { saveScreenshot } from "./screenshot";
import {
  addTask,
  bundleBuildTimeout,
  openInbox,
  pageTitle,
  sameMemberOnAnotherDevice,
  stickerOf,
  todayInBrowser,
} from "./tasks";

test.beforeEach(async ({ page }) => {
  test.setTimeout(bundleBuildTimeout + 60_000);
  await openInbox(page);
});

test("lists a space's tasks in the order of their stickers", async ({ page }, testInfo) => {
  const first = await addTask(page);
  const second = await addTask(page);

  await page.getByRole("button", { name: "List", exact: true }).click();

  const list = page.getByRole("list", { name: "Inbox" });
  const titles = await list.getByRole("button").allTextContents();
  expect(titles.indexOf(first)).toBeGreaterThanOrEqual(0);
  expect(titles.indexOf(second)).toBeGreaterThan(titles.indexOf(first));
  await saveScreenshot(page, testInfo, "space-list");
  await page.getByRole("button", { name: "Hide list" }).click();
  await expect(list).toBeHidden();
});

test("edits a task's title, description and date, on this device and another", async ({ page }) => {
  const title = await addTask(page);
  const other = await sameMemberOnAnotherDevice(page);
  const renamed = `${title} renamed`;

  await stickerOf(page, title).click();
  await page.getByLabel("Title").fill(renamed);
  await page.getByLabel("Description").fill("From the corner shop");
  await page.getByLabel("Date").fill("2026-11-20");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(pageTitle(page)).toHaveText(renamed);
  await page.getByRole("button", { name: "Close" }).click();
  await expect(stickerOf(page, renamed)).toBeVisible();
  await expect(stickerOf(other, renamed)).toBeVisible();
  await stickerOf(other, renamed).click();
  await expect(other.getByLabel("Description")).toHaveValue("From the corner shop");
  await expect(other.getByLabel("Date")).toHaveValue("2026-11-20");
});

test("won't save a blank title or a date that isn't a day", async ({ page }) => {
  const title = await addTask(page);
  await stickerOf(page, title).click();

  await page.getByLabel("Title").fill("  ");
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Date").fill("tomorrow");

  await expect(page.getByText("A date is a day, as in 2026-11-17.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
});

test("lists tasks dated today under Today", async ({ page }, testInfo) => {
  const title = await addTask(page);
  await stickerOf(page, title).click();
  await page.getByLabel("Date").fill(await todayInBrowser(page));
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "Tasks", exact: true }).click();

  const today = page.getByRole("list", { name: "Today" });
  await expect(today.getByRole("button", { name: title })).toBeVisible();
  await saveScreenshot(page, testInfo, "tasks-view");
  await page.getByRole("button", { name: "Hide tasks" }).click();
  await expect(today).toBeHidden();
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await today.getByRole("button", { name: title }).click();
  await expect(page.getByLabel("Title")).toHaveValue(title);
});

test("moves a task to another space, with its sticker", async ({ page }, testInfo) => {
  const title = await addTask(page);
  await stickerOf(page, title).click();

  await page
    .getByRole("button", { name: /^Move to Personal/ })
    .first()
    .click();

  await expect(stickerOf(page, title)).toBeHidden();
  await page.getByRole("button", { name: "Show on its page" }).click();
  await expect(pageTitle(page)).toHaveText(/^Personal.*, page \d+$/);
  await expect(stickerOf(page, title)).toBeVisible();
  await saveScreenshot(page, testInfo, "moved-task");
});

test("deletes a task after asking, on this device and another", async ({ page }) => {
  const title = await addTask(page);
  const other = await sameMemberOnAnotherDevice(page);
  await expect(stickerOf(other, title)).toBeVisible();
  await stickerOf(page, title).click();

  await page.getByRole("button", { name: "Delete task" }).click();
  await page.getByRole("button", { name: "Keep it" }).click();
  await expect(page.getByLabel("Title")).toHaveValue(title);
  await page.getByRole("button", { name: "Delete task" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();

  await expect(stickerOf(page, title)).toBeHidden();
  await expect(stickerOf(other, title)).toBeHidden();
});

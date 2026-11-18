import { expect, type Page, test } from "@playwright/test";
import { expectOnAnotherDevice } from "./another-device";
import { saveScreenshot } from "./screenshot";
import {
  addTask,
  bundleBuildTimeout,
  openSpaceOfItsOwn,
  pageTitle,
  sameMemberOnAnotherDevice,
  stickerOf,
  todayInBrowser,
} from "./tasks";

let space = "";

test.beforeEach(async ({ page }) => {
  test.setTimeout(bundleBuildTimeout + 60_000);
  space = await openSpaceOfItsOwn(page);
});

function stickerCheckbox(page: Page, title: string) {
  return page.getByRole("checkbox", { name: `Done: ${title}` });
}

test("ticks a task on its sticker, and unticks it, on this device and another", async ({
  page,
}, testInfo) => {
  const title = await addTask(page);
  const other = await sameMemberOnAnotherDevice(page, space);
  await expect(stickerOf(other, title)).toBeVisible();

  await stickerCheckbox(page, title).click();

  await expect(stickerCheckbox(page, title)).toBeChecked();
  await expectOnAnotherDevice(stickerCheckbox(other, title)).toBeChecked();
  await expect(page.getByLabel("Title")).toBeHidden();
  await expect(page.getByText(/not saved yet/)).toBeHidden();
  await saveScreenshot(page, testInfo, "ticked-sticker");

  await stickerCheckbox(other, title).click();

  await expect(stickerCheckbox(other, title)).not.toBeChecked();
  await expectOnAnotherDevice(stickerCheckbox(page, title)).not.toBeChecked();
});

test("hides a ticked task from its space's list unless Show done is on", async ({
  page,
}, testInfo) => {
  const title = await addTask(page);
  await page.getByRole("button", { name: "List", exact: true }).click();
  const list = page.getByRole("list", { name: space });

  await list.getByRole("checkbox", { name: `Done: ${title}` }).click();

  await expect(list.getByRole("button", { name: title })).toBeHidden();
  await expect(stickerCheckbox(page, title)).toBeChecked();
  await page.getByRole("checkbox", { name: "Show done" }).click();
  await expect(list.getByRole("button", { name: title })).toBeVisible();
  await expect(list.getByRole("checkbox", { name: `Done: ${title}` })).toBeChecked();
  await saveScreenshot(page, testInfo, "show-done");

  await list.getByRole("checkbox", { name: `Done: ${title}` }).click();
  await page.getByRole("checkbox", { name: "Show done" }).click();
  await expect(list.getByRole("button", { name: title })).toBeVisible();
});

test("ticks a task from its full view, which leaves Today", async ({ page }, testInfo) => {
  const title = await addTask(page);
  await stickerOf(page, title).click();
  await page.getByLabel("Date").fill(await todayInBrowser(page));
  await page.getByRole("button", { name: "Save" }).click();

  await page.getByRole("checkbox", { name: "Done", exact: true }).click();

  const doneBox = page.getByRole("checkbox", { name: "Done", exact: true });
  await expect(doneBox).toBeChecked();
  await expect(pageTitle(page)).toHaveText(title);
  await saveScreenshot(page, testInfo, "ticked-task-view");
  await doneBox.click();
  await expect(doneBox).not.toBeChecked();
  await doneBox.click();
  await expect(doneBox).toBeChecked();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(stickerCheckbox(page, title)).toBeChecked();
  await page.getByRole("button", { name: "All lists" }).click();
  const today = page.getByRole("list", { name: "Today" });
  await expect(today.getByRole("button", { name: title })).toBeHidden();
  await page.getByRole("checkbox", { name: "Show done" }).click();
  await expect(today.getByRole("button", { name: title })).toBeHidden();
});

import { expect, test } from "@playwright/test";
import { expectOnAnotherDevice } from "./another-device";
import { saveScreenshot } from "./screenshot";
import {
  addTask,
  boxOf,
  bundleBuildTimeout,
  drag,
  openSpaceOfItsOwn,
  pageNumberIn,
  pageTitle,
  sameMemberOnAnotherDevice,
  stickerOf,
} from "./tasks";

let space = "";

test.beforeEach(async ({ page }) => {
  test.setTimeout(bundleBuildTimeout + 60_000);
  space = await openSpaceOfItsOwn(page);
});

test("adds a task to a space's page, as a sticker", async ({ page }, testInfo) => {
  await expect(page.getByRole("button", { name: "Add task" })).toBeDisabled();
  await page.getByLabel("New task").fill("   ");
  await expect(page.getByRole("button", { name: "Add task" })).toBeDisabled();

  const title = await addTask(page);

  await expect(pageTitle(page)).toHaveText(`${space}, page 1`);
  await expect(stickerOf(page, title)).toBeVisible();
  await saveScreenshot(page, testInfo, "task-sticker");
});

test("moves a sticker by dragging it, on this device and another", async ({ page }, testInfo) => {
  const title = await addTask(page);
  const other = await sameMemberOnAnotherDevice(page, space);
  const before = await boxOf(stickerOf(other, title));

  await drag(page, stickerOf(page, title), { x: 60, y: 0 });

  await expectOnAnotherDevice
    .poll(async () => (await boxOf(stickerOf(other, title))).x)
    .toBeGreaterThan(before.x);
  await expect(page.getByText(/not saved yet/)).toBeHidden();
  await saveScreenshot(page, testInfo, "moved-sticker");
});

test("keeps a dragged sticker under the pointer on a zoomed page", async ({ page }) => {
  const title = await addTask(page);
  const sticker = stickerOf(page, title);
  const box = await boxOf(sticker);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down("Control");
  for (let step = 0; step < 4; step++) await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
  await expect.poll(async () => (await boxOf(sticker)).width).toBeGreaterThan(box.width * 1.5);

  const zoomed = await drag(page, sticker, { x: 50, y: 0 });

  await expect.poll(async () => (await boxOf(sticker)).x - zoomed.x).toBeCloseTo(50, 0);
});

test("opens a sticker's task by tapping it, with its body page below", async ({
  page,
}, testInfo) => {
  const title = await addTask(page);

  await stickerOf(page, title).click();

  await expect(pageTitle(page)).toHaveText(title);
  await expect(page.getByLabel("Title")).toHaveValue(title);
  await expect(page.getByLabel(title, { exact: true })).toBeVisible();
  await saveScreenshot(page, testInfo, "open-task");
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByLabel("Title")).toBeHidden();
  await expect(stickerOf(page, title)).toBeVisible();
});

test("keeps a task open while the Calendar is shown", async ({ page }) => {
  const title = await addTask(page);
  await stickerOf(page, title).click();
  await expect(pageTitle(page)).toHaveText(title);

  await page.getByRole("tab", { name: "Calendar" }).click();
  await expect(page.getByLabel("Title")).toBeHidden();
  await expect(pageTitle(page)).not.toHaveText(title);
  await page.getByRole("tab", { name: "Tasks" }).click();

  await expect(pageTitle(page)).toHaveText(title);
  await expect(page.getByLabel("Title")).toHaveValue(title);
});

test("puts a task on the space's next page once its newest page is full", async ({
  page,
}, testInfo) => {
  const heading = pageTitle(page);
  const first = pageNumberIn(await heading.textContent());
  await expect(page.getByRole("button", { name: "Next page" })).toBeDisabled();

  let title = "";
  for (let added = 0; added < 20 && pageNumberIn(await heading.textContent()) === first; added++) {
    title = await addTask(page);
  }

  await expect(heading).toHaveText(`${space}, page ${first + 1}`);
  await expect(stickerOf(page, title)).toBeVisible();
  await expect(page.getByRole("button", { name: "Next page" })).toBeDisabled();
  await page.getByRole("button", { name: "Previous page" }).click();
  await expect(heading).toHaveText(`${space}, page ${first}`);
  await expect(stickerOf(page, title)).toBeHidden();
  await saveScreenshot(page, testInfo, "full-page");
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(heading).toHaveText(`${space}, page ${first + 1}`);
});

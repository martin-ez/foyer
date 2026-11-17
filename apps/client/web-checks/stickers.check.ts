import { expect, type Locator, type Page, test } from "@playwright/test";
import { saveScreenshot } from "./screenshot";
import { signIn } from "./sign-in";

const bundleBuildTimeout = 120_000;

test.beforeEach(async ({ page }) => {
  test.setTimeout(bundleBuildTimeout + 60_000);
  await openInbox(page);
});

test("adds a task to a space's page, as a sticker", async ({ page }, testInfo) => {
  await expect(page.getByRole("button", { name: "Add task" })).toBeDisabled();
  await page.getByLabel("New task").fill("   ");
  await expect(page.getByRole("button", { name: "Add task" })).toBeDisabled();

  const title = await addTask(page);

  await expect(page.getByRole("heading")).toHaveText(/^Inbox, page \d+$/);
  await expect(stickerOf(page, title)).toBeVisible();
  await saveScreenshot(page, testInfo, "task-sticker");
});

test("moves a sticker by dragging it, on this device and another", async ({ page }, testInfo) => {
  const title = await addTask(page);
  const other = await sameMemberOnAnotherDevice(page);
  const before = await boxOf(stickerOf(other, title));

  await drag(page, stickerOf(page, title), { x: 60, y: 0 });

  await expect.poll(async () => (await boxOf(stickerOf(other, title))).x).toBeGreaterThan(before.x);
  await expect(page.getByText(/not saved yet/)).toBeHidden();
  await saveScreenshot(page, testInfo, "moved-sticker");
});

test("keeps a dragged sticker under the pointer on a zoomed page", async ({ page }) => {
  const title = await addTask(page);
  const sticker = stickerOf(page, title);
  const box = await boxOf(sticker);
  const held = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(held.x, held.y);
  await page.keyboard.down("Control");
  for (let step = 0; step < 4; step++) await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
  await expect.poll(async () => (await boxOf(sticker)).width).toBeGreaterThan(box.width * 1.5);
  const zoomed = await boxOf(sticker);

  await page.mouse.down();
  await page.mouse.move(held.x + 50, held.y, { steps: 5 });
  await page.mouse.up();

  await expect.poll(async () => (await boxOf(sticker)).x - zoomed.x).toBeCloseTo(50, 0);
});

test("selects a sticker by tapping it, and lets it go", async ({ page }) => {
  const title = await addTask(page);

  await stickerOf(page, title).click();
  await expect(page.getByText(`Selected: Task: ${title}`)).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();

  await expect(page.getByText(/^Selected:/)).toBeHidden();
  await expect(stickerOf(page, title)).toBeVisible();
});

test("removes a sticker from the page, on this device and another", async ({ page }, testInfo) => {
  const title = await addTask(page);
  const other = await sameMemberOnAnotherDevice(page);
  await expect(stickerOf(other, title)).toBeVisible();

  await stickerOf(page, title).click();
  await expect(page.getByText(`Selected: Task: ${title}`)).toBeVisible();
  await saveScreenshot(page, testInfo, "selected-sticker");
  await page.getByRole("button", { name: "Remove from page" }).click();

  await expect(stickerOf(page, title)).toBeHidden();
  await expect(stickerOf(other, title)).toBeHidden();
});

test("puts a task on the space's next page once its newest page is full", async ({
  page,
}, testInfo) => {
  const heading = page.getByRole("heading");
  const first = pageNumberIn(await heading.textContent());
  await expect(page.getByRole("button", { name: "Next page" })).toBeDisabled();

  let title = "";
  for (let added = 0; added < 20 && pageNumberIn(await heading.textContent()) === first; added++) {
    title = await addTask(page);
  }

  await expect(heading).toHaveText(`Inbox, page ${first + 1}`);
  await expect(stickerOf(page, title)).toBeVisible();
  await expect(page.getByRole("button", { name: "Next page" })).toBeDisabled();
  await page.getByRole("button", { name: "Previous page" }).click();
  await expect(heading).toHaveText(`Inbox, page ${first}`);
  await expect(stickerOf(page, title)).toBeHidden();
  await saveScreenshot(page, testInfo, "full-page");
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(heading).toHaveText(`Inbox, page ${first + 1}`);
});

function pageNumberIn(heading: string | null): number {
  return Number(heading?.match(/page (\d+)$/)?.[1]);
}

async function openInbox(page: Page) {
  await signIn(page);
  await expect(page.getByText("Up to date")).toBeVisible({ timeout: bundleBuildTimeout });
  await page.getByRole("button", { name: "Spaces" }).click();
  await page.getByRole("button", { name: "Open Inbox" }).click();
  await expect(page.getByRole("heading")).toHaveText(/^Inbox, page \d+$/);
}

async function addTask(page: Page): Promise<string> {
  const title = `Water the plants ${Date.now()}`;
  await page.getByLabel("New task").fill(title);
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(stickerOf(page, title)).toBeVisible();
  await expect(page.getByText(/not saved yet/)).toBeHidden();
  return title;
}

async function sameMemberOnAnotherDevice(page: Page): Promise<Page> {
  const other = await page.context().newPage();
  await openInbox(other);
  return other;
}

function stickerOf(page: Page, title: string): Locator {
  return page.getByRole("button", { name: `Task: ${title}` });
}

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("The sticker isn't shown");
  return box;
}

async function drag(page: Page, sticker: Locator, by: { x: number; y: number }) {
  const box = await boxOf(sticker);
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + by.x, start.y + by.y, { steps: 8 });
  await page.mouse.up();
}

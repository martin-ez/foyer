import { a4Portrait } from "@foyer/shared";
import { Tool } from "@foyer/shared/gen/foyer/ink/v1/ink_pb";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { fittedCamera, type Point, pointOnPage } from "../src/page/sheet-camera";
import { expectOnAnotherDevice } from "./another-device";
import { framesSentBy, handwriting, inkDevice, inkFollowed, inkPixels, line } from "./ink";
import { saveScreenshot } from "./screenshot";
import {
  addTask,
  boxOf,
  bundleBuildTimeout,
  openSpace,
  openSpaceOfItsOwn,
  stickerOf,
} from "./tasks";

test.beforeEach(() => {
  test.setTimeout(bundleBuildTimeout + 90_000);
});

test("draws the ink another device writes above the page's stickers, moving with them, and takes away what it erases", async ({
  page,
}, testInfo) => {
  const sent = framesSentBy(page);
  const space = await openSpaceOfItsOwn(page);
  const sticker = stickerOf(page, await addTask(page));
  const sheet = sheetOf(page, space);
  const pageId = await inkFollowed(sent);
  const iPad = await inkDevice(page);
  expect(await inkPixels(page, sheet)).toBe(0);

  const fromSticker = await middleOnPage(sheet, sticker);
  const [across] = await iPad.addStrokes(pageId, [
    { samples: line(fromSticker, { x: 500, y: 640 }), tool: Tool.MONOLINE, size: 12 },
  ]);
  await expectOnAnotherDevice.poll(() => inkPixels(page, sheet)).toBeGreaterThan(200);
  expect(await inkPixels(page, sticker)).toBeGreaterThan(20);
  await saveScreenshot(page, testInfo, "ink-from-another-device");

  await zoomAndMoveAround(page, sticker);
  await expect.poll(() => inkPixels(page, sticker)).toBeGreaterThan(20);

  await iPad.eraseStrokes([across ?? ""]);
  await expectOnAnotherDevice.poll(() => inkPixels(page, sheet)).toBe(0);

  await iPad.addStrokes(pageId, [
    { samples: line({ x: 500, y: 200 }, { x: 80, y: 640 }), tool: Tool.MONOLINE, size: 12 },
  ]);
  await expectOnAnotherDevice.poll(() => inkPixels(page, sheet)).toBeGreaterThan(200);
  await page.reload();
  await expect(page.getByText("Up to date")).toBeVisible({ timeout: bundleBuildTimeout });
  await openSpace(page, space);
  await expect.poll(() => inkPixels(page, sheet)).toBeGreaterThan(200);
});

test("zooms a page holding hundreds of strokes", async ({ page }, testInfo) => {
  const sent = framesSentBy(page);
  const space = await openSpaceOfItsOwn(page);
  await addTask(page);
  const sheet = sheetOf(page, space);
  const pageId = await inkFollowed(sent);
  const iPad = await inkDevice(page);

  await iPad.addStrokes(pageId, handwriting(a4Portrait, 300));
  await expectOnAnotherDevice.poll(() => inkPixels(page, sheet)).toBeGreaterThan(2000);
  await saveScreenshot(page, testInfo, "ink-handwriting");

  const box = await boxOf(sheet);
  await page.mouse.move(box.x + box.width / 3, box.y + box.height / 4);
  await page.keyboard.down("Control");
  for (let step = 0; step < 6; step++) await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
  await expect.poll(() => inkPixels(page, sheet)).toBeGreaterThan(2000);
  await saveScreenshot(page, testInfo, "ink-handwriting-zoomed");
});

function sheetOf(page: Page, name: string): Locator {
  return page.getByLabel(`${name}, page 1`, { exact: true });
}

async function middleOnPage(sheet: Locator, of: Locator): Promise<Point> {
  const desk = await boxOf(sheet);
  const box = await boxOf(of);
  const at = { x: box.x - desk.x + box.width / 2, y: box.y - desk.y + box.height / 2 };
  return pointOnPage(fittedCamera(desk, a4Portrait), at);
}

async function zoomAndMoveAround(page: Page, around: Locator) {
  const box = await boxOf(around);
  const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(middle.x, middle.y);
  await page.keyboard.down("Control");
  for (let step = 0; step < 3; step++) await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
  const zoomed = await boxOf(around);
  const below = { x: zoomed.x + zoomed.width / 2, y: zoomed.y + zoomed.height + 40 };
  await page.mouse.move(below.x, below.y);
  await page.mouse.down();
  await page.mouse.move(below.x + 40, below.y + 30, { steps: 8 });
  await page.mouse.up();
}

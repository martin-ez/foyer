import { expect, type Page, test } from "@playwright/test";
import { describeDayInBrowser } from "./pages";
import { saveScreenshot } from "./screenshot";
import { signIn } from "./sign-in";

const bundleBuildTimeout = 120_000;

test.beforeEach(async ({ page }) => {
  test.setTimeout(bundleBuildTimeout + 30_000);
  await signIn(page);
  await expect(page.getByText("Up to date")).toBeVisible({ timeout: bundleBuildTimeout });
});

test("moves between days, and back to today", async ({ page }) => {
  const title = page.getByRole("heading");

  await page.getByRole("button", { name: "Next day" }).click();
  await expect(title).toHaveText(await describeDayInBrowser(page, 1));

  await page.getByRole("button", { name: "Previous day" }).click();
  await page.getByRole("button", { name: "Previous day" }).click();
  await expect(title).toHaveText(await describeDayInBrowser(page, -1));

  await page.getByRole("button", { name: "Today" }).click();
  await expect(title).toHaveText(await describeDayInBrowser(page, 0));
});

test("opens a space's first page", async ({ page }, testInfo) => {
  await page.getByRole("button", { name: "Spaces" }).click();
  await page.getByRole("button", { name: "Open Inbox" }).click();

  await expect(page.getByRole("heading")).toHaveText("Inbox, page 1");
  await expect(page.getByLabel("Inbox, page 1")).toBeVisible();
  await saveScreenshot(page, testInfo, "space-page");

  await page.getByRole("button", { name: "Next day" }).click();
  await expect(page.getByRole("heading")).toHaveText(await describeDayInBrowser(page, 1));
});

test("zooms in on the page around the pointer, and moves it", async ({ page }, testInfo) => {
  const sheet = page.getByLabel(await describeDayInBrowser(page, 0));
  const box = await sheet.boundingBox();
  if (!box) throw new Error("The page isn't shown");
  const fitted = await sheet.screenshot();

  await zoomIn(page, { x: box.x + box.width / 2, y: box.y + box.height / 3 });
  await expect.poll(async () => (await sheet.screenshot()).equals(fitted)).toBe(false);
  await saveScreenshot(page, testInfo, "zoomed-page");
  const zoomed = await sheet.screenshot();

  // Far enough to bring the page's top-left corner into view, since blank paper looks the same
  // wherever it is.
  await page.mouse.move(box.x + box.width / 4, box.y + box.height / 4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.75, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await sheet.screenshot()).equals(zoomed)).toBe(false);
  await saveScreenshot(page, testInfo, "moved-page");
});

/** Zooms in around a point, as a trackpad's pinch does: by scrolling with ctrl held. */
async function zoomIn(page: Page, at: { x: number; y: number }) {
  await page.mouse.move(at.x, at.y);
  await page.keyboard.down("Control");
  for (let step = 0; step < 4; step++) await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
}

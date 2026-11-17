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

test("opens a space on its newest page", async ({ page }, testInfo) => {
  await page.getByRole("tab", { name: "Tasks" }).click();
  await page.getByRole("button", { name: "Spaces" }).click();
  await page.getByRole("button", { name: "Open Inbox" }).click();

  const heading = page.getByRole("heading");
  await expect(heading).toHaveText(/^Inbox, page \d+$/);
  await expect(page.getByLabel((await heading.textContent()) ?? "")).toBeVisible();
  await expect(page.getByRole("button", { name: "Next page" })).toBeDisabled();
  await saveScreenshot(page, testInfo, "space-page");
});

test("shows and hides the spaces", async ({ page }) => {
  await page.getByRole("tab", { name: "Tasks" }).click();
  await page.getByRole("button", { name: "Spaces" }).click();
  await expect(page.getByRole("button", { name: "Open Inbox" })).toBeVisible();

  await page.getByRole("button", { name: "Hide spaces" }).click();
  await expect(page.getByRole("button", { name: "Open Inbox" })).toBeHidden();
});

test("zooms in on the page around the pointer", async ({ page }, testInfo) => {
  const sheet = await todaysPage(page);
  const fitted = await sheet.screenshot();

  await zoomInWithCtrlAndWheel(page, sheet.box);

  await expect.poll(async () => (await sheet.screenshot()).equals(fitted)).toBe(false);
  await saveScreenshot(page, testInfo, "zoomed-page");
});

test("zooms in with two fingers", async ({ page }) => {
  const sheet = await todaysPage(page);
  const fitted = await sheet.screenshot();

  await pinchOut(page, sheet.box);

  await expect.poll(async () => (await sheet.screenshot()).equals(fitted)).toBe(false);
});

test("moves a zoomed page by dragging it", async ({ page }, testInfo) => {
  const sheet = await todaysPage(page);
  await zoomInWithCtrlAndWheel(page, sheet.box);
  const zoomed = await sheet.screenshot();

  await dragTopLeftCornerIntoView(page, sheet.box);

  await expect.poll(async () => (await sheet.screenshot()).equals(zoomed)).toBe(false);
  await saveScreenshot(page, testInfo, "moved-page");
});

test("moves a zoomed page by scrolling", async ({ page }) => {
  const sheet = await todaysPage(page);
  await zoomInWithCtrlAndWheel(page, sheet.box);
  const zoomed = await sheet.screenshot();

  await page.mouse.wheel(-2000, -2000);

  await expect.poll(async () => (await sheet.screenshot()).equals(zoomed)).toBe(false);
});

type Box = { x: number; y: number; width: number; height: number };

async function todaysPage(page: Page) {
  const sheet = page.getByLabel(await describeDayInBrowser(page, 0));
  const box = await sheet.boundingBox();
  if (!box) throw new Error("The page isn't shown");
  return { box, screenshot: () => sheet.screenshot() };
}

async function zoomInWithCtrlAndWheel(page: Page, box: Box) {
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
  await page.keyboard.down("Control");
  for (let step = 0; step < 4; step++) await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
}

async function pinchOut(page: Page, box: Box) {
  const touch = await page.context().newCDPSession(page);
  const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const fingers = (apart: number) => [
    { x: middle.x - apart, y: middle.y, id: 1 },
    { x: middle.x + apart, y: middle.y, id: 2 },
  ];
  await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: fingers(20) });
  for (let apart = 30; apart <= 120; apart += 10) {
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: fingers(apart),
    });
  }
  await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function dragTopLeftCornerIntoView(page: Page, box: Box) {
  await page.mouse.move(box.x + box.width / 4, box.y + box.height / 4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.75, { steps: 5 });
  await page.mouse.up();
}

import { expect, type Locator, type Page } from "@playwright/test";
import { signIn } from "./sign-in";

/** How long the first visit may wait while Expo builds the app's bundle. */
export const bundleBuildTimeout = 120_000;

/** Signs in and opens the Inbox on its newest page. */
export async function openInbox(page: Page) {
  await signIn(page);
  await expect(page.getByText("Up to date")).toBeVisible({ timeout: bundleBuildTimeout });
  await page.getByRole("button", { name: "Spaces" }).click();
  await page.getByRole("button", { name: "Open Inbox" }).click();
  await expect(pageTitle(page)).toHaveText(/^Inbox, page \d+$/);
}

/** The open page's title, such as "Inbox, page 2". */
export function pageTitle(page: Page): Locator {
  return page.getByRole("heading").first();
}

/** The number of the page a title such as "Inbox, page 2" names. */
export function pageNumberIn(title: string | null): number {
  return Number(title?.match(/page (\d+)$/)?.[1]);
}

/** Adds a task with a title of its own to the open space, and returns the title once it's saved. */
export async function addTask(
  page: Page,
  title = `Water the plants ${Date.now()}`,
): Promise<string> {
  await page.getByLabel("New task").fill(title);
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(stickerOf(page, title)).toBeVisible();
  await expect(page.getByText(/not saved yet/)).toBeHidden();
  return title;
}

/** Another tab signed in as the same member, so another of their devices, on the Inbox. */
export async function sameMemberOnAnotherDevice(page: Page): Promise<Page> {
  const other = await page.context().newPage();
  await openInbox(other);
  return other;
}

/** A task's sticker on the open page. */
export function stickerOf(page: Page, title: string): Locator {
  return page.getByRole("button", { name: `Task: ${title}` });
}

/** Where something is on the screen. */
export async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("It isn't shown");
  return box;
}

/** Drags a sticker by this many screen pixels. */
export async function drag(page: Page, sticker: Locator, by: { x: number; y: number }) {
  const box = await boxOf(sticker);
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + by.x, start.y + by.y, { steps: 8 });
  await page.mouse.up();
}

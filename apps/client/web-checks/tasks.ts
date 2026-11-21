import { randomUUID } from "node:crypto";
import { expect, type Locator, type Page } from "@playwright/test";
import { signIn } from "./sign-in";

/** How long the first visit may wait while Expo builds the app's bundle. */
export const bundleBuildTimeout = 120_000;

/** Signs in, and waits until the household is up to date. */
export async function openApp(page: Page) {
  await signIn(page);
  await expect(page.getByText("Up to date")).toBeVisible({ timeout: bundleBuildTimeout });
}

/** Creates a personal space of the check's own, through the spaces panel, so that no other check
 *  adds to its pages, and returns its name once it's saved. Leaves the Tasks open. */
export async function createSpaceOfItsOwn(page: Page): Promise<string> {
  const name = `Space ${randomUUID().slice(0, 8)}`;
  await page.getByRole("tab", { name: "Tasks" }).click();
  await page.getByRole("button", { name: "Spaces", exact: true }).click();
  await page.getByLabel("New space's name").fill(name);
  await page.getByRole("button", { name: "Create personal" }).click();
  await expect(page.getByRole("button", { name: `Open ${name}` })).toBeVisible();
  await expect(page.getByText(/not saved yet/)).toBeHidden();
  await page.getByRole("button", { name: "Hide spaces" }).click();
  return name;
}

/** Opens the newest page of the space `name` in the Tasks. */
export async function openSpace(page: Page, name: string) {
  await page.getByRole("tab", { name: "Tasks" }).click();
  await page.getByRole("button", { name: "Spaces", exact: true }).click();
  await page.getByRole("button", { name: `Open ${name}` }).click();
  await expect(pageTitle(page)).toHaveText(new RegExp(`^${name}, page \\d+$`));
}

/** Signs in, creates a space of the check's own and opens its page, and returns its name. */
export async function openSpaceOfItsOwn(page: Page): Promise<string> {
  await openApp(page);
  const name = await createSpaceOfItsOwn(page);
  await openSpace(page, name);
  return name;
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

/** Another tab signed in as the same member, so another of their devices, on the newest page of
 *  the space `name`. */
export async function sameMemberOnAnotherDevice(page: Page, name: string): Promise<Page> {
  const other = await page.context().newPage();
  await openApp(other);
  await openSpace(other, name);
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

/** Drags a sticker by this many screen pixels, from its centre as it is just before the drag, and
 *  returns where it was then. */
export async function drag(page: Page, sticker: Locator, by: { x: number; y: number }) {
  const box = await boxOf(sticker);
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + by.x, start.y + by.y, { steps: 8 });
  await page.mouse.up();
  return box;
}

/** Today's date in the browser's own time zone, as the app works it out. */
export function todayInBrowser(page: Page): Promise<string> {
  return page.evaluate(() => {
    const now = new Date();
    const two = (value: number) => String(value).padStart(2, "0");
    return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
  });
}

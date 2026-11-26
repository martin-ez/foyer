import { expect, type Page, test } from "@playwright/test";
import { connectAtFakeGoogle, memberOfItsOwn } from "./google-calendar";
import { describeDayInBrowser } from "./pages";
import { saveScreenshot } from "./screenshot";
import { overviewMembers, signIn } from "./sign-in";
import {
  addTask,
  bundleBuildTimeout,
  openApp,
  openSpaceOfItsOwn,
  pageTitle,
  stickerOf,
  todayInBrowser,
} from "./tasks";

test.beforeEach(() => {
  test.setTimeout(bundleBuildTimeout + 60_000);
});

async function chooseFirstScreen(page: Page, name: string) {
  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("radio", { name }).click();
  await expect(page.getByRole("radio", { name })).toBeChecked();
  await page.getByRole("button", { name: "Hide account" }).click();
}

async function startAgain(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Up to date")).toBeVisible({ timeout: bundleBuildTimeout });
}

async function addTaskForToday(page: Page): Promise<string> {
  const title = await addTask(page);
  await stickerOf(page, title).click();
  await page.getByLabel("Date").fill(await todayInBrowser(page));
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByText(/not saved yet/)).toBeHidden();
  return title;
}

test("opens on today's day page until another first screen is chosen", async ({ page }) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Tasks" }).click();

  await startAgain(page);

  await expect(page).toHaveURL(/\/calendar$/);
  await expect(page.getByRole("tab", { name: "Calendar", selected: true })).toBeVisible();
  await expect(pageTitle(page)).toHaveText(await describeDayInBrowser(page, 0));
  await page.getByRole("button", { name: "Account" }).click();
  await expect(page.getByRole("radio", { name: "Today's day page" })).toBeChecked();
});

test("opens on the Today list once it's chosen", async ({ page }, testInfo) => {
  await openSpaceOfItsOwn(page);
  const title = await addTaskForToday(page);
  await chooseFirstScreen(page, "Today list");

  await startAgain(page);

  await expect(page).toHaveURL(/\/tasks\?show=today$/);
  await expect(page.getByRole("tab", { name: "Tasks", selected: true })).toBeVisible();
  const today = page.getByRole("list", { name: "Today" });
  await expect(today.getByRole("button", { name: title })).toBeVisible();
  await expect(page.getByRole("list", { name: "Inbox" })).toBeHidden();
  await expect(page.getByRole("checkbox", { name: "Show done" })).toBeHidden();
  await saveScreenshot(page, testInfo, "first-screen-today-list");
  await page.getByRole("button", { name: "Hide Today list" }).click();
  await expect(today).toBeHidden();
  await page.getByRole("button", { name: "Today list" }).click();
  await expect(today.getByRole("button", { name: title })).toBeVisible();
});

test("opens on the Overview once it's chosen, with today's tasks to tick", async ({
  page,
}, testInfo) => {
  await openSpaceOfItsOwn(page);
  const title = await addTaskForToday(page);
  await expect(page.getByRole("tab", { name: "Overview" })).toBeHidden();
  await chooseFirstScreen(page, "Overview");
  await expect(page.getByRole("tab", { name: "Overview" })).toBeVisible();

  await startAgain(page);

  await expect(page).toHaveURL(/\/overview$/);
  await expect(page.getByRole("tab", { name: "Overview", selected: true })).toBeVisible();
  await expect(pageTitle(page)).toHaveText(`Today, ${await describeDayInBrowser(page, 0)}`);
  const tasks = page.getByRole("list", { name: "Tasks" });
  await expect(tasks.getByRole("button", { name: title })).toBeVisible();
  const notes = page.getByRole("list", { name: "Recent notes" });
  await expect(notes.getByText("No notes yet")).toBeVisible();
  await saveScreenshot(page, testInfo, "first-screen-overview");

  await tasks.getByRole("button", { name: title }).click();
  await expect(page.getByLabel("Title")).toHaveValue(title);
  await expect(page.getByRole("button", { name: "Show on its page" })).toBeHidden();
  await page.getByRole("button", { name: "Close" }).click();
  await tasks.getByRole("checkbox", { name: `Done: ${title}` }).click();
  await expect(tasks.getByRole("button", { name: title })).toBeHidden();

  await chooseFirstScreen(page, "Today's day page");
  await page.getByRole("tab", { name: "Calendar" }).click();
  await expect(page.getByRole("tab", { name: "Overview" })).toBeHidden();
});

test("lists today's events on the Overview, and opens one", async ({ page }, testInfo) => {
  await signIn(page, memberOfItsOwn(overviewMembers, testInfo));
  await expect(page.getByText("Up to date")).toBeVisible({ timeout: bundleBuildTimeout });
  await connectAtFakeGoogle(page, /^Continue as /);
  const title = `Dentist ${Date.now()}`;
  const today = await todayInBrowser(page);
  await page.getByRole("button", { name: "New event" }).click();
  await page.getByLabel("Title").fill(title);
  await page.getByRole("checkbox", { name: "All day" }).click();
  await page.getByLabel("First day").fill(today);
  await page.getByLabel("Last day").fill(today);
  await page.getByRole("checkbox", { name: "In Personal" }).click();
  await page.getByRole("button", { name: "Add event" }).click();
  await expect(page.getByText(/not saved yet/)).toBeHidden();
  await chooseFirstScreen(page, "Overview");

  await startAgain(page);

  const events = page.getByRole("list", { name: "Events" });
  await expect(events.getByRole("button", { name: `Event: ${title}` })).toBeVisible();
  await expect(events.getByText("No events today")).toBeHidden();
  await events.getByRole("button", { name: `Event: ${title}` }).click();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(title);
});

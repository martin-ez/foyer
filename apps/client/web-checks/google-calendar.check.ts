import { expect, type Page, type TestInfo, test } from "@playwright/test";
import { describeWeekday, isInColumn, openWeek, show, tapInDay } from "./calendar-pages";
import { describeDayInBrowser, describeWeekInBrowser } from "./pages";
import { saveScreenshot } from "./screenshot";
import { householdMembers, signIn } from "./sign-in";
import { bundleBuildTimeout } from "./tasks";

const connectPrompt = "Connect Google Calendar to keep a Google calendar for each of your spaces.";

function memberOfItsOwnFor(testInfo: TestInfo): string {
  const members = householdMembers();
  const email = members[testInfo.project.name === "ipad" ? 0 : 1];
  test.skip(email === undefined, "Needs a second email in HOUSEHOLD_MEMBERS");
  return email ?? "";
}

async function openAccount(page: Page) {
  const show = page.getByRole("button", { name: "Account", exact: true });
  if (await show.isVisible()) await show.click();
}

async function hideAccount(page: Page) {
  await page.getByRole("button", { name: "Hide account" }).click();
}

async function signInDisconnected(page: Page, email: string) {
  await signIn(page, email);
  await expect(page.getByText("Up to date")).toBeVisible({ timeout: bundleBuildTimeout });
  await openAccount(page);
  const disconnect = page.getByRole("button", { name: "Disconnect Google Calendar" });
  if (await disconnect.isVisible()) {
    await disconnect.click();
    await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  }
  await expect(page.getByText("Google Calendar: Not connected")).toBeVisible();
  await hideAccount(page);
}

async function connectAtFakeGoogle(page: Page, choice: RegExp) {
  await page.getByRole("button", { name: "Connect Google Calendar" }).click();
  await expect(page.getByRole("heading", { name: "Fake Google" })).toBeVisible();
  await page.getByRole("link", { name: choice }).click();
  await expect(page.getByText("Up to date")).toBeVisible({ timeout: bundleBuildTimeout });
}

async function openSpaces(page: Page) {
  await page.getByRole("tab", { name: "Tasks" }).click();
  await page.getByRole("button", { name: "Spaces", exact: true }).click();
}

test.beforeEach(() => {
  test.setTimeout(bundleBuildTimeout + 60_000);
});

test("connects Google Calendar, makes a calendar for each space, and disconnects", async ({
  page,
}, testInfo) => {
  await signInDisconnected(page, memberOfItsOwnFor(testInfo));
  await expect(page.getByText(connectPrompt)).toBeVisible();
  await saveScreenshot(page, testInfo, "google-calendar-prompt");

  await connectAtFakeGoogle(page, /^Continue as /);
  await expect(page.getByText(connectPrompt)).toBeHidden();
  await openAccount(page);
  await expect(page.getByText("Google Calendar: Connected")).toBeVisible();
  await saveScreenshot(page, testInfo, "google-calendar-connected");
  await hideAccount(page);

  await openSpaces(page);
  await expect(page.getByText("Calendar in your Google account").first()).toBeVisible();
  await saveScreenshot(page, testInfo, "google-calendar-spaces");

  await openAccount(page);
  await page.getByRole("button", { name: "Disconnect Google Calendar" }).click();
  await page.getByRole("button", { name: "Stay connected" }).click();
  await expect(page.getByText("Google Calendar: Connected")).toBeVisible();
  await page.getByRole("button", { name: "Disconnect Google Calendar" }).click();
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByText("Google Calendar: Not connected")).toBeVisible();
  await hideAccount(page);
  await expect(
    page.getByText("Calendar paused until you reconnect Google Calendar").first(),
  ).toBeVisible();
  await saveScreenshot(page, testInfo, "google-calendar-paused");
});

test("says so when someone connects another Google account", async ({ page }, testInfo) => {
  await signInDisconnected(page, memberOfItsOwnFor(testInfo));

  await connectAtFakeGoogle(page, /^Continue with another account$/);

  await expect(
    page.getByText(
      "That isn't the Google account you sign in with. Connect Google Calendar with that one.",
    ),
  ).toBeVisible();
  await expect(page.getByText(connectPrompt)).toBeVisible();
  await saveScreenshot(page, testInfo, "google-calendar-other-account");
});

test("returns without connecting when someone cancels", async ({ page }, testInfo) => {
  await signInDisconnected(page, memberOfItsOwnFor(testInfo));

  await connectAtFakeGoogle(page, /^Cancel$/);

  await expect(page.getByText(connectPrompt)).toBeVisible();
  await openAccount(page);
  await expect(page.getByText("Google Calendar: Not connected")).toBeVisible();
});

async function ensurePersonalSpace(page: Page, name: string) {
  await openSpaces(page);
  if ((await page.getByText(name, { exact: true }).count()) === 0) {
    await page.getByLabel("New space's name").fill(name);
    await page.getByRole("button", { name: "Create personal" }).click();
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  }
  await page.getByRole("button", { name: "Hide spaces" }).click();
}

function dayFromToday(days: number): string {
  const day = new Date();
  day.setDate(day.getDate() + days);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

test("adds, changes and deletes events, which reach Google Calendar and come back from it", async ({
  page,
}, testInfo) => {
  test.setTimeout(bundleBuildTimeout + 180_000);
  const email = memberOfItsOwnFor(testInfo);
  const tomorrow = dayFromToday(1);
  const title = `Dentist ${Date.now()}`;
  await signInDisconnected(page, email);
  await connectAtFakeGoogle(page, /^Continue as /);
  await ensurePersonalSpace(page, "Work");
  await page.getByRole("tab", { name: "Calendar" }).click();

  await page.getByRole("button", { name: "New event" }).click();
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("First day").fill(tomorrow);
  await page.getByLabel("Starts at").fill("7pm");
  await expect(page.getByText("Times are as in 19:00.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add event" })).toBeDisabled();
  await page.getByLabel("Starts at").fill("19:00");
  await page.getByLabel("Last day").fill(tomorrow);
  await page.getByLabel("Ends at").fill("20:00");
  await page.getByRole("checkbox", { name: "In Work" }).click();
  await saveScreenshot(page, testInfo, "event-editor");
  await page.getByRole("button", { name: "Add event" }).click();
  const listed = page.getByRole("button", { name: `Event: ${title}` });
  await expect(listed).toContainText("8:00");
  await expect(listed).toContainText("· Work");
  await saveScreenshot(page, testInfo, "events-upcoming");

  await listed.click();
  await page.getByRole("button", { name: "Move to Personal" }).click();
  await expect(page.getByText("In Personal")).toBeVisible();
  await page.getByLabel("Title").fill(`${title} with Sam`);
  await page.getByRole("checkbox", { name: "All day" }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: "Close" }).click();
  const changed = page.getByRole("button", { name: `Event: ${title} with Sam` });
  await expect(changed).toContainText("all day");

  const google = await page.context().newPage();
  const calendar = google.getByRole("region", { name: `Foyer · Personal (dev:${email})` });
  await expect(async () => {
    await google.goto("/auth/dev/google/calendar");
    await expect(calendar).toContainText(`${title} with Sam`, { timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  const fromGoogle = `Haircut ${Date.now()}`;
  await calendar.getByLabel("Title", { exact: true }).fill(fromGoogle);
  await calendar.getByLabel("Starts").fill(tomorrow);
  await calendar.getByLabel("Ends").fill(dayFromToday(2));
  await calendar.getByRole("button", { name: "Add event" }).click();
  await google.close();

  const added = page.getByRole("button", { name: `Event: ${fromGoogle}` });
  await expect(added).toContainText("added in Google Calendar", { timeout: 90_000 });
  await saveScreenshot(page, testInfo, "events-from-google");

  await page.getByRole("button", { name: "Next day" }).click();
  const tomorrowsPage = page.getByLabel(await describeDayInBrowser(page, 1), { exact: true });
  for (const event of [`${title} with Sam`, fromGoogle]) {
    await expect(tomorrowsPage.getByRole("button", { name: `Event: ${event}` })).toBeVisible();
  }
  await saveScreenshot(page, testInfo, "events-on-their-day");

  await page.getByRole("button", { name: "Today" }).click();

  const fromDay = `Swimming ${Date.now()}`;
  const weeks = 5;
  await openWeek(page, weeks);
  const wednesday = await describeWeekday(page, weeks, 2);
  await tapInDay(page, wednesday, 4);
  await page.getByRole("checkbox", { name: "New event" }).click();
  await page.getByLabel("Title").fill(fromDay);
  await page.getByRole("checkbox", { name: "All day" }).click();
  await page.getByRole("checkbox", { name: "In Work" }).click();
  await page.getByRole("button", { name: "Add event" }).click();
  const onItsDay = page
    .getByLabel(await describeWeekInBrowser(page, weeks), { exact: true })
    .getByRole("button", { name: `Event: ${fromDay}` });
  await expect(onItsDay).toBeVisible();
  expect(await isInColumn(page, onItsDay, wednesday)).toBe(true);
  await saveScreenshot(page, testInfo, "event-added-to-day");
  await onItsDay.click();
  await expect(page.getByLabel("Title")).toHaveValue(fromDay);
  await page.getByRole("button", { name: "Close" }).click();
  await tapInDay(page, wednesday, 8);
  await page.getByRole("checkbox", { name: "New event" }).click();
  await expect(page.getByRole("checkbox", { name: "In Work" })).toBeChecked();
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Today" }).click();
  await show(page, "Day");
  const fromDayListed = page.getByRole("button", { name: `Event: ${fromDay}` });
  await expect(fromDayListed).toContainText("· Work");

  for (const event of [changed, added, fromDayListed]) {
    await event.click();
    await page.getByRole("button", { name: "Delete event" }).click();
    await expect(event).toBeHidden();
  }
});

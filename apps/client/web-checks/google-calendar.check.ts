import { expect, type Page, type TestInfo, test } from "@playwright/test";
import { saveScreenshot } from "./screenshot";
import { householdMembers, signIn } from "./sign-in";
import { bundleBuildTimeout } from "./tasks";

const connectPrompt = "Connect Google Calendar to keep a Google calendar for each of your spaces.";

/** Each viewport connects as a member of its own, so that the two don't connect and disconnect the
 *  same member at once: the iPad's as the first in `HOUSEHOLD_MEMBERS`, the phone's as the
 *  second. */
function memberFor(testInfo: TestInfo): string {
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

/** Signs in on the Calendar, disconnected from Google, as a member who may have connected before. */
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
  await signInDisconnected(page, memberFor(testInfo));
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
  await signInDisconnected(page, memberFor(testInfo));

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
  await signInDisconnected(page, memberFor(testInfo));

  await connectAtFakeGoogle(page, /^Cancel$/);

  await expect(page.getByText(connectPrompt)).toBeVisible();
  await openAccount(page);
  await expect(page.getByText("Google Calendar: Not connected")).toBeVisible();
});

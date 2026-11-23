import { randomUUID } from "node:crypto";
import { calendarName } from "@foyer/shared";
import { expect, type Page, test } from "@playwright/test";
import { expectOnAnotherDevice } from "./another-device";
import { connectAtFakeGoogle, memberOfItsOwn } from "./google-calendar";
import { saveScreenshot } from "./screenshot";
import { leavingMembers, signIn, stayingMembers } from "./sign-in";
import { bundleBuildTimeout } from "./tasks";

test.beforeEach(() => {
  test.setTimeout(bundleBuildTimeout + 60_000);
});

async function signInConnected(page: Page, email: string) {
  await signIn(page, email);
  await expect(page.getByText("Up to date")).toBeVisible({ timeout: bundleBuildTimeout });
  await connectAtFakeGoogle(page, /^Continue as /);
}

async function showSpaces(page: Page) {
  await page.getByRole("tab", { name: "Tasks" }).click();
  await page.getByRole("button", { name: "Spaces", exact: true }).click();
}

async function holdersInGoogle(page: Page, calendar: string): Promise<string[]> {
  await page.goto("/auth/dev/google/calendar");
  const headings = await page.getByRole("heading", { level: 2 }).allTextContents();
  const named = `${calendar} (dev:`;
  return headings
    .filter((heading) => heading.startsWith(named))
    .map((heading) => heading.slice(named.length, -1));
}

test("hands a shared space's calendar to a remaining member once its holder leaves the allowlist", async ({
  page,
  browser,
}, testInfo) => {
  const leaving = memberOfItsOwn(leavingMembers, testInfo);
  const staying = memberOfItsOwn(stayingMembers, testInfo);
  const nameOf = (email: string) => email.split("@")[0];
  const space = `Shared ${randomUUID().slice(0, 8)}`;
  const reminder = `Share “${calendarName(space)}” with the household in Google Calendar's settings.`;
  await signInConnected(page, leaving);
  await showSpaces(page);
  await page.getByLabel("New space's name").fill(space);
  await page.getByRole("button", { name: "Create shared" }).click();
  await expect(page.getByText(reminder)).toBeVisible();
  const theirs = await (await browser.newContext({ ...testInfo.project.use })).newPage();
  await signInConnected(theirs, staying);
  await showSpaces(theirs);
  const heldByLeaving = theirs.getByText(`Calendar in ${nameOf(leaving)}'s Google account`);
  const waitingForLeaving = theirs.getByText(`paused until ${nameOf(leaving)} reconnects`);
  await expect(heldByLeaving.first()).toBeVisible();

  const removed = await page.request.post(
    `/auth/dev/remove-from-allowlist?email=${encodeURIComponent(leaving)}`,
  );

  expect(removed.status()).toBe(204);
  await expectOnAnotherDevice(heldByLeaving).toHaveCount(0);
  await expect(waitingForLeaving).toHaveCount(0);
  const google = await theirs.context().newPage();
  await expect(async () => {
    const holders = await holdersInGoogle(google, calendarName(space));
    expect(holders[0]).toBe(leaving);
    expect(holders.slice(1)).not.toEqual([]);
  }).toPass({ timeout: 15_000 });
  await saveScreenshot(theirs, testInfo, "leaving-new-holder");
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible({
    timeout: bundleBuildTimeout,
  });
});

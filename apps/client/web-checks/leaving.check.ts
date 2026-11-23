import { randomUUID } from "node:crypto";
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

/** Where a space's Google calendar stands, as its row in the spaces panel says. */
function calendarOf(page: Page, space: string) {
  const open = page.getByRole("button", { name: `Open ${space}`, exact: true });
  const calendar = page.getByText(/^(Calendar|No Google calendar)/);
  return page
    .locator("div")
    .filter({ has: open })
    .filter({ has: calendar })
    .last()
    .locator(calendar);
}

test("hands a shared space's calendar to a remaining member once its holder leaves the allowlist", async ({
  page,
  browser,
}, testInfo) => {
  const leaving = memberOfItsOwn(leavingMembers, testInfo);
  const leavingName = leaving.split("@")[0];
  await signInConnected(page, leaving);
  const space = `Shared ${randomUUID().slice(0, 8)}`;
  await showSpaces(page);
  await page.getByLabel("New space's name").fill(space);
  await page.getByRole("button", { name: "Create shared" }).click();
  await expect(calendarOf(page, space)).toHaveText("Calendar in your Google account");
  const staying = await (await browser.newContext({ ...testInfo.project.use })).newPage();
  await signInConnected(staying, memberOfItsOwn(stayingMembers, testInfo));
  await showSpaces(staying);
  await expect(calendarOf(staying, space)).toHaveText(
    `Calendar in ${leavingName}'s Google account`,
  );

  const removed = await page.request.post(
    `/auth/dev/remove-from-allowlist?email=${encodeURIComponent(leaving)}`,
  );

  expect(removed.status()).toBe(204);
  await expectOnAnotherDevice(calendarOf(staying, space)).not.toHaveText(
    `Calendar in ${leavingName}'s Google account`,
  );
  await expectOnAnotherDevice(calendarOf(staying, space)).toHaveText(
    /^Calendar in (your|\S+'s) Google account$/,
  );
  await saveScreenshot(staying, testInfo, "leaving-new-holder");
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible({
    timeout: bundleBuildTimeout,
  });
});

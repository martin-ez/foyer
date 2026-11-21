import { expect, type Page, type TestInfo } from "@playwright/test";
import { bundleBuildTimeout } from "./tasks";

/** The member of `members` for the check's viewport. */
export function memberOfItsOwn(members: Readonly<Record<string, string>>, testInfo: TestInfo) {
  const email = members[testInfo.project.name];
  if (email === undefined) throw new Error(`No member of its own for ${testInfo.project.name}.`);
  return email;
}

/** Connects Google Calendar at the fake Google, choosing the link that matches `choice`, and waits
 *  until the household is up to date again. */
export async function connectAtFakeGoogle(page: Page, choice: RegExp) {
  await page.getByRole("button", { name: "Connect Google Calendar" }).click();
  await expect(page.getByRole("heading", { name: "Fake Google" })).toBeVisible();
  await page.getByRole("link", { name: choice }).click();
  await expect(page.getByText("Up to date")).toBeVisible({ timeout: bundleBuildTimeout });
}

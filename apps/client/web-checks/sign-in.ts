import type { Page } from "@playwright/test";

/** The member the checks sign in as, unless a check needs another. */
export const member = "you@example.com";

/** A second member, for checks that need two people in the household. */
export const housemate = "housemate@example.com";

/** Members only the Google Calendar checks sign in as, one for each viewport, so connecting
 *  Google Calendar and adding events never changes what another check sees. */
export const googleCalendarMembers: Readonly<Record<string, string>> = {
  ipad: "calendar.ipad@example.com",
  phone: "calendar.phone@example.com",
};

/** Everyone the checks' backend lets in, in place of `HOUSEHOLD_MEMBERS` in `.dev.vars`. */
export const checksHouseholdMembers = [member, housemate, ...Object.values(googleCalendarMembers)];

/** Signs in to the checks' backend without Google, as `email`, which returns to the web app. */
export async function signIn(page: Page, email = member) {
  await page.goto(`/auth/dev?email=${encodeURIComponent(email)}`);
}

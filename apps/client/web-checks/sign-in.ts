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

/** Members only the check of events under tasks signs in as, one for each viewport, since it
 *  connects Google Calendar to add an event. */
export const eventNestingMembers: Readonly<Record<string, string>> = {
  ipad: "nesting.ipad@example.com",
  phone: "nesting.phone@example.com",
};

/** Members only the check of repeating events signs in as, one for each viewport, since a series
 *  adds an event on each of its days. */
export const repeatingEventMembers: Readonly<Record<string, string>> = {
  ipad: "series.ipad@example.com",
  phone: "series.phone@example.com",
};

/** Members only the check of archived spaces' events signs in as, one for each viewport, since it
 *  connects Google Calendar and archives their Personal space. */
export const archivedEventMembers: Readonly<Record<string, string>> = {
  ipad: "archive.ipad@example.com",
  phone: "archive.phone@example.com",
};

/** Members only the check of today's events on the Overview signs in as, one for each viewport,
 *  since it connects Google Calendar to add an event. */
export const overviewMembers: Readonly<Record<string, string>> = {
  ipad: "overview.ipad@example.com",
  phone: "overview.phone@example.com",
};

/** Members only the check of a member leaving the household signs in as, one for each viewport:
 *  those who leave, and are refused from then on, and those who stay. */
export const leavingMembers: Readonly<Record<string, string>> = {
  ipad: "leaving.ipad@example.com",
  phone: "leaving.phone@example.com",
};
export const stayingMembers: Readonly<Record<string, string>> = {
  ipad: "staying.ipad@example.com",
  phone: "staying.phone@example.com",
};

/** Everyone the checks' backend lets in, in place of `HOUSEHOLD_MEMBERS` in `.dev.vars`. */
export const checksHouseholdMembers = [
  member,
  housemate,
  ...Object.values(googleCalendarMembers),
  ...Object.values(eventNestingMembers),
  ...Object.values(repeatingEventMembers),
  ...Object.values(archivedEventMembers),
  ...Object.values(overviewMembers),
  ...Object.values(leavingMembers),
  ...Object.values(stayingMembers),
];

/** Signs in to the checks' backend without Google, as `email`, which returns to the web app. */
export async function signIn(page: Page, email = member) {
  await page.goto(`/auth/dev?email=${encodeURIComponent(email)}`);
}

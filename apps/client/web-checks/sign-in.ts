import { readFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";

const devVars = path.join(__dirname, "../../server/.dev.vars");

/** The first email in `HOUSEHOLD_MEMBERS` in the local backend's `.dev.vars`. */
export function householdMember(): string {
  const [email] = householdMembers();
  if (email === undefined) throw new Error(`${devVars} sets no HOUSEHOLD_MEMBERS.`);
  return email;
}

/** The emails in `HOUSEHOLD_MEMBERS` in the local backend's `.dev.vars`. */
export function householdMembers(): string[] {
  let text: string;
  try {
    text = readFileSync(devVars, "utf8");
  } catch {
    throw new Error(`${devVars} is missing: copy .dev.vars.example there.`);
  }
  const value = /^\s*HOUSEHOLD_MEMBERS\s*=\s*(.*)$/m.exec(text)?.[1]?.trim() ?? "";
  const emails: unknown = JSON.parse(value.replace(/^(['"])(.*)\1$/, "$2") || "[]");
  return Array.isArray(emails) ? emails.filter((email) => typeof email === "string") : [];
}

/** Signs in to the local backend without Google, as `email`, which returns to the web app. */
export async function signIn(page: Page, email = householdMember()) {
  await page.goto(`/auth/dev?email=${encodeURIComponent(email)}`);
}

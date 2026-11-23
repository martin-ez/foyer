import { env } from "cloudflare:workers";
import { isLocalBackend } from "./local";

/** Whether the email is on the household's allowlist, the `HOUSEHOLD_MEMBERS` secret. Emails are
 *  compared ignoring case and surrounding spaces. A missing or malformed allowlist lets nobody in,
 *  and logs why without logging its contents. */
export function isOnAllowlist(email: string): boolean {
  const allowlist = readAllowlist(env.HOUSEHOLD_MEMBERS);
  if ("problem" in allowlist) {
    console.error(`${allowlist.problem}, so nobody can sign in. ${expectedFormat}`);
    return false;
  }
  return allowlist.members.has(normalize(email)) && !removedLocally.has(normalize(email));
}

/** Whether the email has left the household's allowlist, so its member leaves the household.
 *  Unlike `isOnAllowlist`, which then lets nobody in, a missing, malformed or empty allowlist has
 *  nobody leave, since leaving gives away their shared spaces' calendars for good. */
export function hasLeftAllowlist(email: string): boolean {
  const allowlist = readAllowlist(env.HOUSEHOLD_MEMBERS);
  if ("problem" in allowlist || allowlist.members.size === 0) return false;
  return !allowlist.members.has(normalize(email)) || removedLocally.has(normalize(email));
}

/** Takes an email off the allowlist of a local backend until it restarts, as if it were taken out
 *  of `HOUSEHOLD_MEMBERS`, so web checks can have a member leave. Does nothing on a deployed one. */
export function removeFromAllowlistLocally(email: string): void {
  if (isLocalBackend()) removedLocally.add(normalize(email));
}

const removedLocally = new Set<string>();

const expectedFormat = 'It should be a JSON list of email addresses, such as ["name@example.com"].';

function readAllowlist(value: string | undefined): { members: Set<string> } | { problem: string } {
  if (value === undefined || value.trim() === "") return { problem: "HOUSEHOLD_MEMBERS isn't set" };
  let members: unknown;
  try {
    members = JSON.parse(value);
  } catch {
    return { problem: "HOUSEHOLD_MEMBERS isn't valid JSON" };
  }
  if (!Array.isArray(members) || !members.every(isEmailAddress)) {
    return { problem: "HOUSEHOLD_MEMBERS isn't a list of email addresses" };
  }
  return { members: new Set(members.map(normalize)) };
}

function isEmailAddress(value: unknown): value is string {
  return typeof value === "string" && /^[^@\s]+@[^@\s]+$/.test(value.trim());
}

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

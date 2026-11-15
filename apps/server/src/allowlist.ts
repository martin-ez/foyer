import { env } from "cloudflare:workers";

/** Whether the email is on the household's allowlist, the `HOUSEHOLD_MEMBERS` secret. Emails are
 *  compared ignoring case and surrounding spaces. A missing or malformed allowlist lets nobody in,
 *  and logs why without logging its contents. */
export function isOnAllowlist(email: string): boolean {
  return readAllowlist(env.HOUSEHOLD_MEMBERS).has(normalize(email));
}

const expectedFormat = 'It should be a JSON list of email addresses, such as ["name@example.com"].';

function readAllowlist(value: string | undefined): Set<string> {
  if (value === undefined || value.trim() === "") {
    return refuseEveryone("HOUSEHOLD_MEMBERS isn't set");
  }
  let members: unknown;
  try {
    members = JSON.parse(value);
  } catch {
    return refuseEveryone("HOUSEHOLD_MEMBERS isn't valid JSON");
  }
  if (!Array.isArray(members) || !members.every(isEmailAddress)) {
    return refuseEveryone("HOUSEHOLD_MEMBERS isn't a list of email addresses");
  }
  return new Set(members.map(normalize));
}

function refuseEveryone(reason: string): Set<string> {
  console.error(`${reason}, so nobody can sign in. ${expectedFormat}`);
  return new Set();
}

function isEmailAddress(value: unknown): value is string {
  return typeof value === "string" && /^[^@\s]+@[^@\s]+$/.test(value.trim());
}

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

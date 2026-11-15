import { DurableObject, env } from "cloudflare:workers";
import { newId } from "@foyer/shared";
import { isOnAllowlist } from "./allowlist";
import { householdMigrations, migrate } from "./migrations";
import { hashSecret, newSecret } from "./secrets";

/** What every member sees of a member. */
export type Member = { id: string; name: string };

/** A Google account that signed in: Google's id for it, its email and its owner's first name. */
export type GoogleAccount = { subject: string; email: string; name: string };

const day = 24 * 60 * 60 * 1000;

/** How long a session lasts without being used. */
export const sessionLifetime = 90 * day;

/** How long the iPad app has to exchange its one-time code for a session. */
export const signInCodeLifetime = 60 * 1000;

type SignInCode = { memberId: string; expiresAt: number };

/** The household's hub, with its own SQLite storage. Starting it runs the storage migrations it
 *  hasn't run yet, before it answers anything. */
export class Household extends DurableObject<Env> {
  readonly #signInCodes = new Map<string, SignInCode>();

  constructor(ctx: DurableObjectState, bindings: Env) {
    super(ctx, bindings);
    migrate(ctx.storage, householdMigrations);
  }

  /** Confirms the household's SQLite storage answers. */
  ping(): string {
    return this.ctx.storage.sql.exec<{ status: string }>("SELECT 'ok' AS status").one().status;
  }

  /** Lets a Google account in when its email is on the allowlist, as the member who signed in with
   *  it before, or as a new member. Returns null for an account that isn't let in. */
  join(account: GoogleAccount): Member | null {
    if (!isOnAllowlist(account.email)) return null;
    const { sql } = this.ctx.storage;
    const [existing] = sql
      .exec<Member>("SELECT id, name FROM members WHERE google_subject = ?", account.subject)
      .toArray();
    if (existing) {
      sql.exec("UPDATE members SET email = ? WHERE id = ?", account.email, existing.id);
      return existing;
    }
    const member = { id: newId(), name: account.name };
    sql.exec(
      "INSERT INTO members (id, email, google_subject, name, joined_at) VALUES (?, ?, ?, ?, ?)",
      member.id,
      account.email,
      account.subject,
      member.name,
      Date.now(),
    );
    return member;
  }

  /** Lets an email on the allowlist in without Google, for local development: as the first member
   *  who signed in with it, or as a new member named after it. Returns null for an email that isn't
   *  let in. */
  joinWithoutGoogle(email: string): Member | null {
    const address = email.trim().toLowerCase();
    if (!isOnAllowlist(address)) return null;
    const [existing] = this.ctx.storage.sql
      .exec<Member>(
        "SELECT id, name FROM members WHERE lower(email) = ? ORDER BY joined_at LIMIT 1",
        address,
      )
      .toArray();
    return (
      existing ??
      this.join({ subject: `dev:${address}`, email: address, name: address.split("@")[0] ?? "" })
    );
  }

  /** Starts a session for a member and returns its token, of which only a hash is stored. Removes
   *  the sessions that ended unused. */
  async startSession(memberId: string): Promise<string> {
    const token = newSecret();
    const tokenHash = await hashSecret(token);
    const now = Date.now();
    const { sql } = this.ctx.storage;
    sql.exec("DELETE FROM sessions WHERE last_used_at <= ?", now - sessionLifetime);
    sql.exec(
      "INSERT INTO sessions (id, token_hash, member_id, created_at, last_used_at) VALUES (?, ?, ?, ?, ?)",
      newId(),
      tokenHash,
      memberId,
      now,
      now,
    );
    return token;
  }

  /** Gives a member a one-time code, valid for a minute, that the iPad app exchanges for a session.
   *  Codes are only kept in memory. */
  issueSignInCode(memberId: string): string {
    const code = newSecret();
    this.#signInCodes.set(code, { memberId, expiresAt: Date.now() + signInCodeLifetime });
    return code;
  }

  /** Exchanges a one-time code for a new session, once. Returns null for a code that was never
   *  given, was used, or expired, and for a member whose email has left the allowlist. */
  async finishSignIn(code: string): Promise<{ token: string; member: Member } | null> {
    const now = Date.now();
    const signInCode = this.#signInCodes.get(code);
    for (const [given, { expiresAt }] of this.#signInCodes) {
      if (given === code || expiresAt <= now) this.#signInCodes.delete(given);
    }
    if (!signInCode || signInCode.expiresAt <= now) return null;

    const [member] = this.ctx.storage.sql
      .exec<Member & { email: string }>(
        "SELECT id, name, email FROM members WHERE id = ?",
        signInCode.memberId,
      )
      .toArray();
    if (!member || !isOnAllowlist(member.email)) return null;
    return {
      token: await this.startSession(member.id),
      member: { id: member.id, name: member.name },
    };
  }

  /** The member whose session a token belongs to, or null once it has ended. A session ends after
   *  90 days without use, or once its member's email leaves the allowlist. Using a session moves
   *  its last use forward at most once a day, and `renewed` says when this use did. */
  async sessionFor(token: string): Promise<{ member: Member; renewed: boolean } | null> {
    const tokenHash = await hashSecret(token);
    const { sql } = this.ctx.storage;
    const [session] = sql
      .exec<{ id: string; last_used_at: number; member_id: string; name: string; email: string }>(
        `SELECT sessions.id, sessions.last_used_at, members.id AS member_id, members.name, members.email
         FROM sessions JOIN members ON members.id = sessions.member_id
         WHERE sessions.token_hash = ?`,
        tokenHash,
      )
      .toArray();
    if (!session) return null;

    const now = Date.now();
    if (session.last_used_at <= now - sessionLifetime) {
      sql.exec("DELETE FROM sessions WHERE id = ?", session.id);
      return null;
    }
    if (!isOnAllowlist(session.email)) {
      sql.exec("DELETE FROM sessions WHERE member_id = ?", session.member_id);
      return null;
    }
    const renewed = session.last_used_at <= now - day;
    if (renewed) sql.exec("UPDATE sessions SET last_used_at = ? WHERE id = ?", now, session.id);
    return { member: { id: session.member_id, name: session.name }, renewed };
  }

  /** Ends the session a token belongs to, if it hasn't ended already. */
  async endSession(token: string): Promise<void> {
    this.ctx.storage.sql.exec("DELETE FROM sessions WHERE token_hash = ?", await hashSecret(token));
  }
}

/** The one household this deployment holds. */
export function theHousehold(): DurableObjectStub<Household> {
  return env.HOUSEHOLD.getByName("household");
}

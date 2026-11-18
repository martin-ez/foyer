import { calendarName } from "@foyer/shared";
import { isOnAllowlist } from "./allowlist";
import {
  type CalendarAnswer,
  calendarClient,
  calendarScope,
  createCalendar,
  grantedAccessFor,
  refreshAccess,
  renameCalendar,
  revokeAccess,
} from "./google-calendar";
import { nextSeq, type RowKey } from "./rows";

/** What became of connecting Google Calendar: connected, or refused because the person chose
 *  another Google account than the one they sign in with, or didn't allow calendar access, or
 *  failed for another reason. */
export type ConnectingResult = "connected" | "other-account" | "no-access" | "failed";

/** What Google sent back when someone allowed access, for the household to exchange. */
export type ConnectingAnswer = {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  /** The device's time zone, which the member's new calendars take. */
  timeZone: string;
};

const minute = 60_000;

/** The longest the household waits before trying Google again after a failure. */
export const longestRetryDelay = 60 * minute;

type SpaceToMake = { id: string; name: string; time_zone: string };

type HeldCalendar = {
  space_id: string;
  google_calendar_id: string;
  name_in_google: string;
  name: string;
};

type Done = "done" | "failed" | "access-stopped";

/** Keeps members' Google connections, and a Google calendar for each space except the Inbox in
 *  its holder's account. `changed` sends devices the rows that changed, and `wake` asks for the
 *  household's alarm, which runs `work`, at a time. */
export class Calendars {
  readonly #storage: DurableObjectStorage;
  readonly #changed: (keys: RowKey[]) => void;
  readonly #wake: (at: number) => void;
  #retryDelay = minute;
  #nextAttemptAt = 0;
  #running: Promise<void> = Promise.resolve();

  constructor(
    storage: DurableObjectStorage,
    changed: (keys: RowKey[]) => void,
    wake: (at: number) => void,
  ) {
    this.#storage = storage;
    this.#changed = changed;
    this.#wake = wake;
  }

  /** Exchanges what Google sent back for access to a member's calendars, and keeps it, resuming
   *  their paused spaces. Refuses an account other than the one they sign in with, and access that
   *  leaves out the calendars. */
  async connect(memberId: string, answer: ConnectingAnswer): Promise<ConnectingResult> {
    const { sql } = this.#storage;
    const [member] = sql
      .exec<{ google_subject: string; email: string }>(
        "SELECT google_subject, email FROM members WHERE id = ?",
        memberId,
      )
      .toArray();
    const client = calendarClient();
    if (!member || !client || !isOnAllowlist(member.email)) return "failed";

    let granted: Awaited<ReturnType<typeof grantedAccessFor>>;
    try {
      granted = await grantedAccessFor(client, answer);
    } catch (error) {
      console.error(`Connecting Google Calendar failed: ${error}`);
      return "failed";
    }
    if (granted.subject !== member.google_subject) return "other-account";
    if (!granted.scopes.includes(calendarScope)) return "no-access";
    const refreshToken = granted.refreshToken;
    if (!refreshToken) {
      console.error("Connecting Google Calendar failed: Google sent no refresh token");
      return "failed";
    }

    const changed = this.#storage.transactionSync(() => {
      const seq = nextSeq(sql);
      sql.exec(
        `INSERT INTO google_connections (member_id, refresh_token, scope, state, time_zone,
           connected_at, access_token, access_token_expires_at, seq)
         VALUES (?, ?, ?, 'connected', ?, ?, ?, ?, ?)
         ON CONFLICT (member_id) DO UPDATE SET refresh_token = excluded.refresh_token,
           scope = excluded.scope, state = 'connected', time_zone = excluded.time_zone,
           access_token = excluded.access_token,
           access_token_expires_at = excluded.access_token_expires_at, seq = excluded.seq`,
        memberId,
        refreshToken,
        granted.scopes.join(" "),
        answer.timeZone,
        Date.now(),
        granted.accessToken,
        granted.expiresAt,
        seq,
      );
      sql.exec("DELETE FROM tombstones WHERE kind = 'google_connection' AND id = ?", memberId);
      return [connectionKey(memberId), ...this.#touchHeldSpaces(memberId, seq)];
    });
    this.#changed(changed);
    this.soon();
    return "connected";
  }

  /** Forgets a member's Google access, and revokes it at Google. The spaces whose calendars are in
   *  their account become paused. Does nothing for a member who isn't connected. */
  async disconnect(memberId: string): Promise<void> {
    const { sql } = this.#storage;
    const [connection] = sql
      .exec<{ refresh_token: string }>(
        "SELECT refresh_token FROM google_connections WHERE member_id = ?",
        memberId,
      )
      .toArray();
    if (!connection) return;
    const changed = this.#storage.transactionSync(() => {
      sql.exec("DELETE FROM google_connections WHERE member_id = ?", memberId);
      const seq = nextSeq(sql);
      sql.exec(
        `INSERT OR REPLACE INTO tombstones (kind, id, visible_to, seq)
         VALUES ('google_connection', ?, ?, ?)`,
        memberId,
        memberId,
        seq,
      );
      return [connectionKey(memberId), ...this.#touchHeldSpaces(memberId, seq)];
    });
    this.#changed(changed);
    const revoked = await revokeAccess(connection.refresh_token);
    if ("failed" in revoked) console.error(`Revoking Google access failed: ${revoked.failed}`);
  }

  /** Asks for Google's work to be done now, if there is any: after a change that may need a
   *  calendar made or renamed. */
  soon(): void {
    if (!this.#hasWork()) return;
    this.#nextAttemptAt = 0;
    this.#wake(Date.now());
  }

  /** Makes and renames the calendars spaces wait for, one run at a time. Access Google refuses
   *  needs reconnecting and pauses its spaces. After a failure, it asks to run again later, waiting
   *  twice as long each time, up to `longestRetryDelay`. */
  work(): Promise<void> {
    const run = this.#running.then(() => this.#work());
    this.#running = run.catch(() => {});
    return run;
  }

  async #work(): Promise<void> {
    if (Date.now() < this.#nextAttemptAt) {
      this.#wake(this.#nextAttemptAt);
      return;
    }
    let failed = false;
    for (const memberId of this.#connectedMembers()) {
      if ((await this.#workFor(memberId)) === "failed") failed = true;
    }
    if (!failed) {
      this.#retryDelay = minute;
      this.#nextAttemptAt = 0;
      return;
    }
    this.#nextAttemptAt = Date.now() + this.#retryDelay;
    this.#retryDelay = Math.min(this.#retryDelay * 2, longestRetryDelay);
    this.#wake(this.#nextAttemptAt);
  }

  async #workFor(memberId: string): Promise<Done> {
    for (const space of this.#calendarsToMake(memberId)) {
      const name = calendarName(space.name);
      const made = await this.#withAccess(memberId, (token) =>
        createCalendar(token, { name, timeZone: space.time_zone }),
      );
      if ("revoked" in made) return this.#accessStopped(memberId);
      if (!("ok" in made)) return failure(`Making a calendar for space ${space.id}`, made);
      this.#keepCalendar(memberId, space.id, made.ok, name);
    }
    for (const calendar of this.#calendarsToRename(memberId)) {
      const name = calendarName(calendar.name);
      const renamed = await this.#withAccess(memberId, (token) =>
        renameCalendar(token, calendar.google_calendar_id, name),
      );
      if ("revoked" in renamed) return this.#accessStopped(memberId);
      if ("gone" in renamed) {
        console.error(`The calendar of space ${calendar.space_id} is no longer in Google.`);
      } else if (!("ok" in renamed)) {
        return failure(`Renaming the calendar of space ${calendar.space_id}`, renamed);
      }
      this.#storage.sql.exec(
        "UPDATE space_calendars SET name_in_google = ? WHERE space_id = ?",
        name,
        calendar.space_id,
      );
    }
    return "done";
  }

  async #withAccess<T>(
    memberId: string,
    call: (accessToken: string) => Promise<CalendarAnswer<T>>,
  ): Promise<CalendarAnswer<T>> {
    const [held] = this.#storage.sql
      .exec<{ access_token: string | null; access_token_expires_at: number | null }>(
        "SELECT access_token, access_token_expires_at FROM google_connections WHERE member_id = ?",
        memberId,
      )
      .toArray();
    const fresh = (held?.access_token_expires_at ?? 0) > Date.now() + minute;
    let accessToken = fresh ? held?.access_token : null;
    if (!accessToken) {
      const refreshed = await this.#refresh(memberId);
      if (!("ok" in refreshed)) return refreshed;
      accessToken = refreshed.ok;
    }
    const answer = await call(accessToken);
    if (!("unauthorized" in answer)) return answer;
    const refreshed = await this.#refresh(memberId);
    if (!("ok" in refreshed)) return refreshed;
    const again = await call(refreshed.ok);
    return "unauthorized" in again ? { failed: "Google didn't accept a new access token" } : again;
  }

  async #refresh(memberId: string): Promise<CalendarAnswer<string>> {
    const { sql } = this.#storage;
    const client = calendarClient();
    const [connection] = sql
      .exec<{ refresh_token: string }>(
        "SELECT refresh_token FROM google_connections WHERE member_id = ? AND state = 'connected'",
        memberId,
      )
      .toArray();
    if (!client || !connection) return { failed: "The member isn't connected to Google" };
    const refreshed = await refreshAccess(client, connection.refresh_token);
    if (!("ok" in refreshed)) return refreshed;
    sql.exec(
      `UPDATE google_connections SET access_token = ?, access_token_expires_at = ?
       WHERE member_id = ? AND refresh_token = ?`,
      refreshed.ok.accessToken,
      refreshed.ok.expiresAt,
      memberId,
      connection.refresh_token,
    );
    return { ok: refreshed.ok.accessToken };
  }

  #accessStopped(memberId: string): Done {
    const { sql } = this.#storage;
    const changed = this.#storage.transactionSync(() => {
      const [connection] = sql
        .exec(
          "SELECT 1 FROM google_connections WHERE member_id = ? AND state = 'connected'",
          memberId,
        )
        .toArray();
      if (!connection) return [] as RowKey[];
      const seq = nextSeq(sql);
      sql.exec(
        `UPDATE google_connections SET state = 'needs_reconnecting', access_token = NULL,
           access_token_expires_at = NULL, seq = ?
         WHERE member_id = ?`,
        seq,
        memberId,
      );
      return [connectionKey(memberId), ...this.#touchHeldSpaces(memberId, seq)];
    });
    this.#changed(changed);
    return "access-stopped";
  }

  #keepCalendar(memberId: string, spaceId: string, calendarId: string, name: string): void {
    const { sql } = this.#storage;
    const kept = this.#storage.transactionSync(() => {
      if (sql.exec("SELECT 1 FROM space_calendars WHERE space_id = ?", spaceId).toArray().length) {
        console.error(`Space ${spaceId} already had a calendar, so ${calendarId} isn't used.`);
        return false;
      }
      sql.exec(
        `INSERT INTO space_calendars (space_id, member_id, google_calendar_id, name_in_google,
           created_at)
         VALUES (?, ?, ?, ?, ?)`,
        spaceId,
        memberId,
        calendarId,
        name,
        Date.now(),
      );
      sql.exec("UPDATE spaces SET seq = ? WHERE id = ?", nextSeq(sql), spaceId);
      return true;
    });
    if (kept) this.#changed([{ kind: "space", id: spaceId }]);
  }

  #touchHeldSpaces(memberId: string, seq: number): RowKey[] {
    const { sql } = this.#storage;
    const held = sql
      .exec<{ space_id: string }>(
        "SELECT space_id FROM space_calendars WHERE member_id = ?",
        memberId,
      )
      .toArray();
    sql.exec(
      "UPDATE spaces SET seq = ? WHERE id IN (SELECT space_id FROM space_calendars WHERE member_id = ?)",
      seq,
      memberId,
    );
    return held.map(({ space_id }) => ({ kind: "space", id: space_id }));
  }

  #connectedMembers(): string[] {
    return this.#storage.sql
      .exec<{ member_id: string }>(
        `SELECT member_id FROM google_connections WHERE state = 'connected'
         ORDER BY connected_at, member_id`,
      )
      .toArray()
      .map(({ member_id }) => member_id);
  }

  #calendarsToMake(memberId: string): SpaceToMake[] {
    return this.#storage.sql
      .exec<SpaceToMake>(
        `SELECT spaces.id, spaces.name, connection.time_zone
         FROM spaces
         JOIN google_connections AS connection
           ON connection.member_id = ? AND connection.state = 'connected'
         LEFT JOIN space_calendars ON space_calendars.space_id = spaces.id
         WHERE space_calendars.space_id IS NULL AND (
           (spaces.kind = 'personal' AND spaces.owner_id = connection.member_id)
           OR (spaces.kind = 'shared' AND connection.member_id = coalesce(
             (SELECT member_id FROM google_connections
              WHERE member_id = spaces.created_by AND state = 'connected'),
             (SELECT member_id FROM google_connections WHERE state = 'connected'
              ORDER BY connected_at, member_id LIMIT 1))))
         ORDER BY spaces.created_at, spaces.id`,
        memberId,
      )
      .toArray();
  }

  #calendarsToRename(memberId: string): HeldCalendar[] {
    return this.#storage.sql
      .exec<HeldCalendar>(
        `SELECT space_calendars.space_id, space_calendars.google_calendar_id,
           space_calendars.name_in_google, spaces.name
         FROM space_calendars JOIN spaces ON spaces.id = space_calendars.space_id
         WHERE space_calendars.member_id = ?`,
        memberId,
      )
      .toArray()
      .filter((calendar) => calendar.name_in_google !== calendarName(calendar.name));
  }

  #hasWork(): boolean {
    return this.#connectedMembers().some(
      (memberId) =>
        this.#calendarsToMake(memberId).length > 0 || this.#calendarsToRename(memberId).length > 0,
    );
  }
}

function connectionKey(memberId: string): RowKey {
  return { kind: "google_connection", id: memberId };
}

function failure(what: string, answer: { failed: string } | { gone: true } | object): Done {
  const reason = "failed" in answer ? answer.failed : "Google no longer has it";
  console.error(`${what} failed: ${reason}`);
  return "failed";
}

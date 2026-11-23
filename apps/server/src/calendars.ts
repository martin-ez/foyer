import { calendarName, newId } from "@foyer/shared";
import { hasLeftAllowlist, isOnAllowlist } from "./allowlist";
import { settleCalendarStickers } from "./calendar-stickers";
import {
  EventSync,
  type OutOfCalls,
  readIntervalWhileAway,
  readIntervalWhileConnected,
  type SpaceCalendar,
  wakeWaitingWrites,
} from "./event-sync";
import { redateEvents } from "./events";
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
import { deleteItemForHousehold } from "./items";
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

/** How many calls to Google one run makes at most, refreshing access included, so that it stays
 *  within the free plan's 50 calls to other hosts. The next run does the rest at once. */
export const callsPerRun = 40;

type SpaceToMake = { id: string; name: string; time_zone: string };

type LostCalendar = { space_id: string; name: string; time_zone: string };

type Holder = { member_id: string; time_zone: string };

type HeldCalendar = {
  space_id: string;
  google_calendar_id: string;
  name_in_google: string;
  name: string;
};

type Done = "done" | "failed" | "access-stopped" | "postponed";

/** Keeps members' Google connections, a Google calendar for each space except the Inbox in its
 *  holder's account, and those calendars' events in step with Foyer's. The household's alarm runs
 *  `work`; it reads more often while `devicesConnected` says a device is connected. */
export class Calendars {
  readonly #storage: DurableObjectStorage;
  readonly #changed: (keys: RowKey[]) => void;
  readonly #wake: (at: number) => void;
  readonly #devicesConnected: () => boolean;
  readonly #events: EventSync;
  #retryDelay = minute;
  #nextAttemptAt = 0;
  readonly #toReadNow = new Set<string>();
  #callsLeft = callsPerRun;
  #running: Promise<void> = Promise.resolve();

  constructor(
    storage: DurableObjectStorage,
    changed: (keys: RowKey[]) => void,
    wake: (at: number) => void,
    devicesConnected: () => boolean,
  ) {
    this.#storage = storage;
    this.#changed = changed;
    this.#wake = wake;
    this.#devicesConnected = devicesConnected;
    this.#events = new EventSync(
      storage,
      (memberId, call) => this.#withAccess(memberId, call),
      changed,
      (spaceId) => this.#calendarLost(spaceId),
    );
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
      wakeWaitingWrites(sql);
      return [connectionKey(memberId), ...this.#touchHeldSpaces(memberId, seq)];
    });
    this.#changed(changed);
    this.readSoon();
    this.soon();
    return "connected";
  }

  /** Forgets a member's Google access, and revokes it at Google. The spaces whose calendars are in
   *  their account become paused. Does nothing for a member who isn't connected. */
  async disconnect(memberId: string): Promise<void> {
    const refreshToken = this.#forgetConnection(memberId);
    if (refreshToken === null) return;
    const revoked = await revokeAccess(refreshToken);
    if ("failed" in revoked) console.error(`Revoking Google access failed: ${revoked.failed}`);
  }

  /** Asks for Google's work to be done now, if there is any: after a change that may need a
   *  calendar made or renamed, an event written, or a restored space's calendar read. */
  soon(): void {
    if (!this.#hasWork() && this.#calendarsDue().length === 0) return;
    this.#nextAttemptAt = 0;
    this.#wake(Date.now());
  }

  /** Reads every calendar's changes from Google now, as when a device connects. */
  readSoon(): void {
    const calendars = this.#readableCalendars();
    if (calendars.length === 0) return;
    for (const { space_id } of calendars) this.#toReadNow.add(space_id);
    this.#wake(Date.now());
  }

  /** Makes and renames calendars, then writes, reads and makes occurrences, waiting longest first,
   *  in runs of at most `callsPerRun` calls to Google, the next starting at once. Refused access
   *  pauses its spaces; other failures wait twice as long each time, up to `longestRetryDelay`. */
  work(): Promise<void> {
    const run = this.#running.then(() => this.#work());
    this.#running = run.catch(() => {});
    return run;
  }

  async #work(): Promise<void> {
    try {
      await this.#workNow();
    } finally {
      this.#wakeForNextWork();
    }
  }

  async #workNow(): Promise<void> {
    this.#callsLeft = callsPerRun;
    await this.#letLeaversGo();
    let failed = false;
    if (Date.now() >= this.#nextAttemptAt) {
      for (const memberId of this.#connectedMembers()) {
        if (this.#callsLeft <= 0) break;
        if ((await this.#workFor(memberId)) === "failed") failed = true;
      }
    }
    if (this.#callsLeft > 0) {
      for (const memberId of await this.#events.writeDue()) this.#accessStopped(memberId);
    }
    if (Date.now() < this.#nextAttemptAt) return;
    for (const calendar of this.#calendarsDue()) {
      if (this.#callsLeft <= 0) break;
      const outcome = await this.#events.read(calendar);
      if (outcome === "postponed") break;
      this.#toReadNow.delete(calendar.space_id);
      if (typeof outcome === "object") this.#accessStopped(outcome.accessStopped);
      if (outcome === "failed") failed = true;
    }
    for (const { series, calendar } of this.#events.seriesDue()) {
      if (this.#callsLeft <= 0) break;
      const outcome = await this.#events.makeOccurrences(series, calendar);
      if (typeof outcome === "object") this.#accessStopped(outcome.accessStopped);
      if (outcome === "failed") failed = true;
    }
    if (failed) {
      this.#nextAttemptAt = Date.now() + this.#retryDelay;
      this.#retryDelay = Math.min(this.#retryDelay * 2, longestRetryDelay);
    } else {
      this.#retryDelay = minute;
      this.#nextAttemptAt = 0;
    }
  }

  #wakeForNextWork(): void {
    const times = [this.#events.nextWriteAt()];
    if (this.#nextAttemptAt > Date.now()) times.push(this.#nextAttemptAt);
    else if (this.#hasCalendarWork() || this.#events.seriesDue().length > 0) {
      times.push(Date.now());
    }
    for (const calendar of this.#readableCalendars()) {
      times.push(Math.max(this.#readDueAt(calendar), this.#nextAttemptAt));
    }
    const next = times.filter((time): time is number => time !== null);
    if (next.length > 0) this.#wake(Math.max(Math.min(...next), Date.now()));
  }

  async #letLeaversGo(): Promise<void> {
    for (const memberId of this.#leaversConnected()) {
      if (this.#callsLeft <= 0) break;
      const refreshToken = this.#forgetConnection(memberId);
      if (refreshToken === null) continue;
      const revoked = await this.#ask(() => revokeAccess(refreshToken));
      if ("failed" in revoked) console.error(`Revoking Google access failed: ${revoked.failed}`);
    }
    for (const spaceId of this.#spacesToTakeOver()) this.#takeOver(spaceId);
  }

  async #workFor(memberId: string): Promise<Done> {
    for (const calendar of this.#calendarsToRemake(memberId)) {
      const name = calendarName(calendar.name);
      const made = await this.#withAccess(memberId, (token) =>
        createCalendar(token, { name, timeZone: calendar.time_zone }),
      );
      if ("revoked" in made) return this.#accessStopped(memberId);
      if (!("ok" in made))
        return failure(`Making again the calendar of space ${calendar.space_id}`, made);
      this.#remakeCalendar(calendar.space_id, made.ok, name);
    }
    for (const space of this.#calendarsToMake(memberId)) {
      const name = calendarName(space.name);
      const made = await this.#withAccess(memberId, (token) =>
        createCalendar(token, { name, timeZone: space.time_zone }),
      );
      if ("revoked" in made) return this.#accessStopped(memberId);
      if (!("ok" in made)) return failure(`Making a calendar for space ${space.id}`, made);
      this.#keepCalendar(memberId, space.id, made.ok, name, space.time_zone);
    }
    for (const calendar of this.#calendarsToRename(memberId)) {
      const name = calendarName(calendar.name);
      const renamed = await this.#withAccess(memberId, (token) =>
        renameCalendar(token, calendar.google_calendar_id, name),
      );
      if ("revoked" in renamed) return this.#accessStopped(memberId);
      if ("gone" in renamed) {
        this.#calendarLost(calendar.space_id);
        continue;
      }
      if (!("ok" in renamed)) {
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
  ): Promise<CalendarAnswer<T> | OutOfCalls> {
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
    const token = accessToken;
    const answer = await this.#ask(() => call(token));
    if (!("unauthorized" in answer)) return answer;
    const refreshed = await this.#refresh(memberId);
    if (!("ok" in refreshed)) return refreshed;
    const newToken = refreshed.ok;
    const again = await this.#ask(() => call(newToken));
    return "unauthorized" in again ? { failed: "Google didn't accept a new access token" } : again;
  }

  #ask<T>(asking: () => Promise<T>): Promise<T | OutOfCalls> {
    if (this.#callsLeft <= 0) return Promise.resolve({ outOfCalls: true });
    this.#callsLeft -= 1;
    return asking();
  }

  async #refresh(memberId: string): Promise<CalendarAnswer<string> | OutOfCalls> {
    const { sql } = this.#storage;
    const client = calendarClient();
    const [connection] = sql
      .exec<{ refresh_token: string }>(
        "SELECT refresh_token FROM google_connections WHERE member_id = ? AND state = 'connected'",
        memberId,
      )
      .toArray();
    if (!client || !connection) return { failed: "The member isn't connected to Google" };
    const refreshed = await this.#ask(() => refreshAccess(client, connection.refresh_token));
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

  #forgetConnection(memberId: string): string | null {
    const { sql } = this.#storage;
    const [connection] = sql
      .exec<{ refresh_token: string }>(
        "SELECT refresh_token FROM google_connections WHERE member_id = ?",
        memberId,
      )
      .toArray();
    if (!connection) return null;
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
    return connection.refresh_token;
  }

  #takeOver(spaceId: string): void {
    const { sql } = this.#storage;
    const [holder] = this.#remainingHolders();
    const changed = this.#storage.transactionSync(() => {
      const deleted = this.#forgetCalendar(spaceId);
      if (holder) {
        sql.exec(
          `UPDATE space_calendars SET member_id = ?, time_zone = ?, lost_at = ?, sync_token = NULL,
             read_at = NULL
           WHERE space_id = ?`,
          holder.member_id,
          holder.time_zone,
          Date.now(),
          spaceId,
        );
      } else {
        sql.exec("DELETE FROM space_calendars WHERE space_id = ?", spaceId);
      }
      const seq = nextSeq(sql);
      sql.exec("UPDATE spaces SET seq = ? WHERE id = ?", seq, spaceId);
      const redated = holder ? this.#redateEventsOf(spaceId, seq) : [];
      return [{ kind: "space", id: spaceId } satisfies RowKey, ...deleted, ...redated];
    });
    this.#changed(changed);
    this.#nextAttemptAt = 0;
  }

  #redateEventsOf(spaceId: string, seq: number): RowKey[] {
    const { sql } = this.#storage;
    const events = sql
      .exec<{ id: string }>("SELECT id FROM items WHERE space_id = ? AND kind = 'event'", spaceId)
      .toArray()
      .map(({ id }) => id);
    const setter = { at: Date.now(), changeId: newId() };
    const redated = redateEvents(sql, events, setter, seq);
    return [
      ...redated.map((id): RowKey => ({ kind: "item", id })),
      ...settleCalendarStickers(sql, redated, setter, null),
    ];
  }

  #keepCalendar(
    memberId: string,
    spaceId: string,
    calendarId: string,
    name: string,
    timeZone: string,
  ): void {
    const { sql } = this.#storage;
    const kept = this.#storage.transactionSync(() => {
      if (sql.exec("SELECT 1 FROM space_calendars WHERE space_id = ?", spaceId).toArray().length) {
        console.error(`Space ${spaceId} already had a calendar, so ${calendarId} isn't used.`);
        return null;
      }
      sql.exec(
        `INSERT INTO space_calendars (space_id, member_id, google_calendar_id, name_in_google,
           created_at, time_zone)
         VALUES (?, ?, ?, ?, ?, ?)`,
        spaceId,
        memberId,
        calendarId,
        name,
        Date.now(),
        timeZone,
      );
      const seq = nextSeq(sql);
      sql.exec("UPDATE spaces SET seq = ? WHERE id = ?", seq, spaceId);
      wakeWaitingWrites(sql);
      return [
        { kind: "space", id: spaceId } satisfies RowKey,
        ...this.#redateEventsOf(spaceId, seq),
      ];
    });
    if (kept) this.#changed(kept);
  }

  #calendarLost(spaceId: string): void {
    const { sql } = this.#storage;
    const changed = this.#storage.transactionSync(() => {
      const [calendar] = sql
        .exec("SELECT 1 FROM space_calendars WHERE space_id = ? AND lost_at IS NULL", spaceId)
        .toArray();
      if (!calendar) return [];
      console.error(`The calendar of space ${spaceId} is no longer in Google, so it's made again.`);
      sql.exec(
        `UPDATE space_calendars SET lost_at = ?, sync_token = NULL, read_at = NULL
         WHERE space_id = ?`,
        Date.now(),
        spaceId,
      );
      return this.#forgetCalendar(spaceId);
    });
    this.#changed(changed);
    this.#nextAttemptAt = 0;
    this.#wake(Date.now());
  }

  #forgetCalendar(spaceId: string): RowKey[] {
    const { sql } = this.#storage;
    const [calendar] = sql
      .exec<{ google_calendar_id: string }>(
        "SELECT google_calendar_id FROM space_calendars WHERE space_id = ?",
        spaceId,
      )
      .toArray();
    if (!calendar) return [];
    const occurrences = sql
      .exec<{ id: string }>(
        `SELECT items.id FROM items JOIN google_events ON google_events.item_id = items.id
         WHERE google_events.google_calendar_id = ? AND items.series_id IS NOT NULL
         ORDER BY items.id`,
        calendar.google_calendar_id,
      )
      .toArray();
    for (const table of ["google_events", "google_event_removals", "google_series"]) {
      sql.exec(`DELETE FROM ${table} WHERE google_calendar_id = ?`, calendar.google_calendar_id);
    }
    const setter = { at: Date.now(), changeId: newId() };
    const deleted = occurrences.flatMap(({ id }) => {
      sql.exec("DELETE FROM google_event_writes WHERE item_id = ?", id);
      return deleteItemForHousehold(sql, id, setter);
    });
    const events = sql
      .exec<{ id: string }>("SELECT id FROM items WHERE space_id = ? AND kind = 'event'", spaceId)
      .toArray();
    for (const { id } of events) {
      sql.exec(
        `INSERT INTO google_event_writes (item_id, version, tries, next_attempt_at)
         VALUES (?, 1, 0, 0)
         ON CONFLICT (item_id) DO UPDATE SET version = version + 1, tries = 0, next_attempt_at = 0`,
        id,
      );
    }
    return deleted;
  }

  #remakeCalendar(spaceId: string, calendarId: string, name: string): void {
    const { sql } = this.#storage;
    this.#storage.transactionSync(() => {
      sql.exec(
        `UPDATE space_calendars SET google_calendar_id = ?, name_in_google = ?, lost_at = NULL,
           sync_token = NULL, read_at = NULL
         WHERE space_id = ?`,
        calendarId,
        name,
        spaceId,
      );
      wakeWaitingWrites(sql);
    });
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

  #leavers(): Set<string> {
    const members = this.#storage.sql
      .exec<{ id: string; email: string }>("SELECT id, email FROM members")
      .toArray();
    return new Set(members.filter(({ email }) => hasLeftAllowlist(email)).map(({ id }) => id));
  }

  #leaversConnected(): string[] {
    const leavers = this.#leavers();
    if (leavers.size === 0) return [];
    return this.#storage.sql
      .exec<{ member_id: string }>(
        "SELECT member_id FROM google_connections ORDER BY connected_at, member_id",
      )
      .toArray()
      .map(({ member_id }) => member_id)
      .filter((memberId) => leavers.has(memberId));
  }

  #spacesToTakeOver(): string[] {
    const leavers = this.#leavers();
    if (leavers.size === 0) return [];
    return this.#storage.sql
      .exec<{ space_id: string; member_id: string }>(
        `SELECT space_calendars.space_id, space_calendars.member_id
         FROM space_calendars JOIN spaces ON spaces.id = space_calendars.space_id
         WHERE spaces.kind = 'shared' AND spaces.archived = 0
         ORDER BY spaces.created_at, spaces.id`,
      )
      .toArray()
      .filter(({ member_id }) => leavers.has(member_id))
      .map(({ space_id }) => space_id);
  }

  #remainingHolders(): Holder[] {
    const leavers = this.#leavers();
    return this.#storage.sql
      .exec<Holder>(
        `SELECT member_id, time_zone FROM google_connections WHERE state = 'connected'
         ORDER BY connected_at, member_id`,
      )
      .toArray()
      .filter(({ member_id }) => !leavers.has(member_id));
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
         WHERE space_calendars.space_id IS NULL AND spaces.archived = 0 AND (
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

  #calendarsToRemake(memberId: string): LostCalendar[] {
    return this.#storage.sql
      .exec<LostCalendar>(
        `SELECT space_calendars.space_id, spaces.name, space_calendars.time_zone
         FROM space_calendars JOIN spaces ON spaces.id = space_calendars.space_id
         WHERE space_calendars.member_id = ? AND space_calendars.lost_at IS NOT NULL
           AND spaces.archived = 0
         ORDER BY space_calendars.lost_at, space_calendars.space_id`,
        memberId,
      )
      .toArray();
  }

  #calendarsDue(): SpaceCalendar[] {
    return this.#readableCalendars().filter((calendar) => this.#readDueAt(calendar) <= Date.now());
  }

  #readDueAt(calendar: SpaceCalendar): number {
    if (calendar.read_at === null || this.#toReadNow.has(calendar.space_id)) return 0;
    const interval = this.#devicesConnected() ? readIntervalWhileConnected : readIntervalWhileAway;
    return calendar.read_at + interval;
  }

  #readableCalendars(): SpaceCalendar[] {
    return this.#storage.sql
      .exec<SpaceCalendar>(
        `SELECT space_calendars.space_id, space_calendars.member_id,
           space_calendars.google_calendar_id, space_calendars.time_zone,
           space_calendars.sync_token, space_calendars.read_at, space_calendars.lost_at
         FROM space_calendars JOIN google_connections
           ON google_connections.member_id = space_calendars.member_id
           AND google_connections.state = 'connected'
         JOIN spaces ON spaces.id = space_calendars.space_id AND spaces.archived = 0
         WHERE space_calendars.lost_at IS NULL
         ORDER BY space_calendars.read_at IS NOT NULL, space_calendars.read_at,
           space_calendars.created_at, space_calendars.space_id`,
      )
      .toArray();
  }

  #calendarsToRename(memberId: string): HeldCalendar[] {
    return this.#storage.sql
      .exec<HeldCalendar>(
        `SELECT space_calendars.space_id, space_calendars.google_calendar_id,
           space_calendars.name_in_google, spaces.name
         FROM space_calendars JOIN spaces ON spaces.id = space_calendars.space_id
         WHERE space_calendars.member_id = ? AND space_calendars.lost_at IS NULL
           AND spaces.archived = 0`,
        memberId,
      )
      .toArray()
      .filter((calendar) => calendar.name_in_google !== calendarName(calendar.name));
  }

  #hasWork(): boolean {
    const nextWrite = this.#events.nextWriteAt();
    return this.#hasCalendarWork() || (nextWrite !== null && nextWrite <= Date.now());
  }

  #hasCalendarWork(): boolean {
    if (this.#leaversConnected().length > 0 || this.#spacesToTakeOver().length > 0) return true;
    return this.#connectedMembers().some(
      (memberId) =>
        this.#calendarsToMake(memberId).length > 0 ||
        this.#calendarsToRename(memberId).length > 0 ||
        this.#calendarsToRemake(memberId).length > 0,
    );
  }
}

function connectionKey(memberId: string): RowKey {
  return { kind: "google_connection", id: memberId };
}

function failure(what: string, answer: { failed: string } | { gone: true } | object): Done {
  if ("outOfCalls" in answer) return "postponed";
  const reason = "failed" in answer ? answer.failed : "Google no longer has it";
  console.error(`${what} failed: ${reason}`);
  return "failed";
}

import { eventDate, newId, sameEventTime } from "@foyer/shared";
import { settleCalendarStickers } from "./calendar-stickers";
import { isLater, type Setter } from "./changes";
import { redateEvents, storedEventTime, writeEventTime } from "./events";
import {
  type CalendarAnswer,
  deleteEvent,
  findCalendar,
  type GoogleEvent,
  type GoogleEventFields,
  insertEvent,
  listEvents,
  listInstances,
  moveEvent,
  patchEvent,
  readEvent,
} from "./google-calendar";
import {
  type EventFields,
  eventFieldsOf,
  googleFieldsOf,
  isSeries,
  occurrenceWindow,
  updatedAt,
} from "./google-events";
import { deleteItemForHousehold, insertItem, moveItemForHousehold } from "./items";
import { inJson, nextSeq, type RowKey } from "./rows";

const minute = 60_000;

/** The longest an event's write waits before it's tried again after failing. */
export const longestWriteDelay = 60 * minute;

/** How often the household reads a calendar's changes while a device is connected. */
export const readIntervalWhileConnected = minute;

/** How often the household reads a calendar's changes while no device is connected. */
export const readIntervalWhileAway = 15 * minute;

const untilWoken = Number.MAX_SAFE_INTEGER;

/** What became of writing to or reading from Google: done, waiting for the calendar's holder or
 *  for the calendar to be made again, failed for a reason that may pass, postponed to the next run
 *  as this one is out of calls, or stopped because Google no longer accepts the holder's access. */
export type SyncOutcome = "done" | "waiting" | "failed" | "postponed" | { accessStopped: string };

/** The answer instead of Google's when the run has made all the calls to Google it may. */
export type OutOfCalls = { outOfCalls: true };

/** Calls Google with a member's access, refreshing it when needed, or answers `OutOfCalls`. */
export type WithAccess = <T>(
  memberId: string,
  call: (accessToken: string) => Promise<CalendarAnswer<T>>,
) => Promise<CalendarAnswer<T> | OutOfCalls>;

/** A space's Google calendar, as the household reads it. */
export type SpaceCalendar = {
  space_id: string;
  member_id: string;
  google_calendar_id: string;
  time_zone: string;
  sync_token: string | null;
  read_at: number | null;
  lost_at: number | null;
};

/** A repeating series in a space's Google calendar, whose occurrences are events in Foyer: its
 *  Google ids, the id its occurrences share in Foyer, and the moment, in milliseconds since 1970,
 *  until which they've been made, or null when they're to be listed again. */
export type Series = {
  google_calendar_id: string;
  google_event_id: string;
  series_id: string;
  made_until: number | null;
};

type Link = {
  item_id: string;
  google_calendar_id: string;
  google_event_id: string;
  etag: string | null;
  fields: string | null;
};

type Destination =
  | { calendar: SpaceCalendar; event: GoogleEvent }
  | { nowhere: true }
  | { stopped: SyncOutcome };

type GoogleIds = Pick<Link, "google_calendar_id" | "google_event_id">;

type Occurrence = {
  item_id: string;
  google_event_id: string;
  date: string | null;
  starts_on: string | null;
  ends_on: string | null;
  starts_at: number | null;
  ends_at: number | null;
  waiting: number;
};

type StoredEvent = {
  space_id: string;
  series_id: string | null;
  title: string;
  description: string;
  starts_on: string | null;
  ends_on: string | null;
  starts_at: number | null;
  ends_at: number | null;
  title_at: number;
  title_change_id: string;
  description_at: number;
  description_change_id: string;
  time_at: number;
  time_change_id: string;
};

/** Marks each event that a change changed, and each deleted item that is in Google, as waiting to
 *  be written to Google. */
export function queueEventWrites(sql: SqlStorage, keys: readonly RowKey[]): void {
  const items = keys.filter(({ kind }) => kind === "item").map(({ id }) => id);
  if (items.length === 0) return;
  const ids = JSON.stringify(items);
  sql.exec(
    `INSERT INTO google_event_writes (item_id, version, tries, next_attempt_at)
     SELECT id, 1, 0, 0 FROM items WHERE id IN ${inJson} AND kind = 'event'
     UNION SELECT item_id, 1, 0, 0 FROM google_events WHERE item_id IN ${inJson}
     ON CONFLICT (item_id) DO UPDATE SET version = version + 1, tries = 0, next_attempt_at = 0`,
    ids,
    ids,
  );
}

/** Lets writes and removals that waited for a calendar's holder or a calendar be tried now. */
export function wakeWaitingWrites(sql: SqlStorage): void {
  sql.exec(
    "UPDATE google_event_writes SET next_attempt_at = 0 WHERE next_attempt_at = ?",
    untilWoken,
  );
  sql.exec(
    "UPDATE google_event_removals SET next_attempt_at = 0 WHERE next_attempt_at = ?",
    untilWoken,
  );
}

/** Keeps the events of the spaces' Google calendars in step with Foyer's both ways, field by field,
 *  the change made last winning. `changed` sends devices the rows that changed, and `calendarLost`
 *  hears of a space whose calendar no longer exists in Google. */
export class EventSync {
  readonly #storage: DurableObjectStorage;
  readonly #withAccess: WithAccess;
  readonly #changed: (keys: RowKey[]) => void;
  readonly #calendarLost: (spaceId: string) => void;

  constructor(
    storage: DurableObjectStorage,
    withAccess: WithAccess,
    changed: (keys: RowKey[]) => void,
    calendarLost: (spaceId: string) => void,
  ) {
    this.#storage = storage;
    this.#withAccess = withAccess;
    this.#changed = changed;
    this.#calendarLost = calendarLost;
  }

  /** Writes to Google, then removes from it, each event whose time to try has come, waiting longest
   *  first, until the run is out of calls. One that fails waits twice as long each time, up to
   *  `longestWriteDelay`. Returns the members whose access Google no longer accepts. */
  async writeDue(): Promise<string[]> {
    const { sql } = this.#storage;
    const stopped: string[] = [];
    const due = sql
      .exec<{ item_id: string; version: number; tries: number }>(
        `SELECT item_id, version, tries FROM google_event_writes WHERE next_attempt_at <= ?
         ORDER BY rowid`,
        Date.now(),
      )
      .toArray();
    for (const write of due) {
      const outcome = await this.#write(write.item_id);
      if (outcome === "postponed") return stopped;
      if (typeof outcome === "object") stopped.push(outcome.accessStopped);
      this.#settleWrite("google_event_writes", "item_id = ?", [write.item_id], write, outcome);
    }
    const removals = sql
      .exec<{ google_calendar_id: string; google_event_id: string; tries: number }>(
        `SELECT google_calendar_id, google_event_id, tries FROM google_event_removals
         WHERE next_attempt_at <= ? ORDER BY rowid`,
        Date.now(),
      )
      .toArray();
    for (const removal of removals) {
      const outcome = await this.#removeFromGoogle(
        removal.google_calendar_id,
        removal.google_event_id,
      );
      if (outcome === "postponed") return stopped;
      if (typeof outcome === "object") stopped.push(outcome.accessStopped);
      const where = "google_calendar_id = ? AND google_event_id = ?";
      const keys = [removal.google_calendar_id, removal.google_event_id];
      this.#settleWrite("google_event_removals", where, keys, removal, outcome);
    }
    return stopped;
  }

  /** When the next write or removal is to be tried, or null when none is. */
  nextWriteAt(): number | null {
    const [next] = this.#storage.sql
      .exec<{ at: number | null }>(
        `SELECT min(at) AS at FROM (
           SELECT next_attempt_at AS at FROM google_event_writes WHERE next_attempt_at < ?
           UNION ALL
           SELECT next_attempt_at AS at FROM google_event_removals WHERE next_attempt_at < ?)`,
        untilWoken,
        untilWoken,
      )
      .toArray();
    return next?.at ?? null;
  }

  /** Reads the changes made to a space's calendar in Google since the last read, or every event in
   *  it when Google dropped the sync token or there's none yet. */
  async read(calendar: SpaceCalendar): Promise<SyncOutcome> {
    const { sql } = this.#storage;
    const full = calendar.sync_token === null;
    const seen = new Set<string>();
    let from: { syncToken?: string; pageToken?: string } = full
      ? {}
      : { syncToken: calendar.sync_token ?? "" };
    for (;;) {
      const page = await this.#withAccess(calendar.member_id, (token) =>
        listEvents(token, calendar.google_calendar_id, from),
      );
      if ("tokenDropped" in page) {
        sql.exec(
          "UPDATE space_calendars SET sync_token = NULL WHERE space_id = ?",
          calendar.space_id,
        );
        return this.read({ ...calendar, sync_token: null });
      }
      if ("gone" in page) {
        this.#calendarLost(calendar.space_id);
        return "done";
      }
      if (!("ok" in page)) return outcomeOf(calendar.member_id, page);
      if (page.ok.timeZone && page.ok.timeZone !== calendar.time_zone) {
        this.#changeTimeZone(calendar.space_id, page.ok.timeZone);
      }
      for (const event of page.ok.events) {
        seen.add(event.id);
        const taken = await this.#take(calendar, event);
        if (taken !== "done") return taken;
      }
      if (page.ok.nextPageToken) {
        from = { pageToken: page.ok.nextPageToken };
        continue;
      }
      if (full) {
        const dropped = await this.#dropMissing(calendar.google_calendar_id, seen);
        if (dropped !== "done") return dropped;
      }
      sql.exec(
        "UPDATE space_calendars SET sync_token = ?, read_at = ? WHERE space_id = ?",
        page.ok.nextSyncToken ?? null,
        Date.now(),
        calendar.space_id,
      );
      return "done";
    }
  }

  async #write(itemId: string): Promise<SyncOutcome> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const event = this.#event(itemId);
      const link = this.#link(itemId);
      if (!event) {
        if (link) this.#queueRemoval(link);
        return "done";
      }
      const target = this.#calendarOfSpace(event.space_id);
      if (!target || target.lost_at !== null || !this.#readsAndWrites(target)) return "waiting";
      const fields = fieldsOfStored(event);
      if (!fields) return "done";
      if (event.series_id !== null) {
        if (!link || link.etag === null) {
          this.#deleteInFoyer(itemId);
          return "done";
        }
        if (link.google_calendar_id !== target.google_calendar_id) return "done";
      }

      if (link && link.google_calendar_id !== target.google_calendar_id) {
        const source = this.#calendarById(link.google_calendar_id);
        if (!source || source.member_id !== target.member_id || link.etag === null) {
          this.#queueRemoval(link);
          continue;
        }
        const moved = await this.#withAccess(target.member_id, (token) =>
          moveEvent(
            token,
            link.google_calendar_id,
            link.google_event_id,
            target.google_calendar_id,
          ),
        );
        if ("ok" in moved) {
          this.#keepLink({ ...link, google_calendar_id: target.google_calendar_id }, moved.ok);
        } else if ("gone" in moved) {
          const destination = await this.#destinationOf(link, "event");
          if ("stopped" in destination) return destination.stopped;
          if ("calendar" in destination) {
            this.#follow(link, destination.calendar, destination.event);
          } else {
            this.#storage.sql.exec("DELETE FROM google_events WHERE item_id = ?", itemId);
          }
        } else {
          return outcomeOf(target.member_id, moved);
        }
        continue;
      }

      if (!link || link.etag === null) {
        const eventId = link?.google_event_id ?? newGoogleEventId();
        if (!link) this.#addLink(itemId, target.google_calendar_id, eventId);
        const inserted = await this.#withAccess(target.member_id, (token) =>
          insertEvent(token, target.google_calendar_id, eventId, googleFieldsOf(fields)),
        );
        if ("ok" in inserted) {
          this.#keepLink(this.#link(itemId), inserted.ok);
          return "done";
        }
        if ("conflict" in inserted) {
          const found = await this.#withAccess(target.member_id, (token) =>
            readEvent(token, target.google_calendar_id, eventId),
          );
          if ("ok" in found && found.ok.status !== "cancelled") {
            this.#keepLink(this.#link(itemId), found.ok, { fields: null });
          } else if ("ok" in found || "gone" in found) {
            this.#storage.sql.exec("DELETE FROM google_events WHERE item_id = ?", itemId);
          } else {
            return outcomeOf(target.member_id, found);
          }
          continue;
        }
        if ("invalid" in inserted) {
          console.error(`Google refused event ${itemId}, so it's deleted: ${inserted.invalid}`);
          this.#deleteInFoyer(itemId);
          return "done";
        }
        if ("gone" in inserted) {
          this.#calendarLost(target.space_id);
          return "waiting";
        }
        return outcomeOf(target.member_id, inserted);
      }

      const known = readFields(link.fields);
      if (known && sameFields(known, fields)) return "done";
      const etag = link.etag;
      const patched = await this.#withAccess(target.member_id, (token) =>
        patchEvent(
          token,
          target.google_calendar_id,
          link.google_event_id,
          etag,
          withoutDescriptionUnchangedSinceRead(fields, known),
        ),
      );
      if ("ok" in patched) {
        this.#keepLink(link, patched.ok);
        return "done";
      }
      if ("changedSince" in patched || "invalid" in patched) {
        const found = await this.#withAccess(target.member_id, (token) =>
          readEvent(token, target.google_calendar_id, link.google_event_id),
        );
        if ("ok" in found && found.ok.status !== "cancelled") {
          if ("invalid" in patched) {
            console.error(`Google refused a change to event ${itemId}: ${patched.invalid}`);
            this.#takeGoogleVersion(itemId, found.ok);
            return "done";
          }
          this.#settleWithGoogle(itemId, found.ok, { queueIfDifferent: false });
          continue;
        }
        if (!("ok" in found) && !("gone" in found)) return outcomeOf(target.member_id, found);
      } else if (!("gone" in patched)) {
        return outcomeOf(target.member_id, patched);
      }
      const calendar = await this.#withAccess(target.member_id, (token) =>
        findCalendar(token, target.google_calendar_id),
      );
      if ("gone" in calendar) {
        this.#calendarLost(target.space_id);
        return "waiting";
      }
      if (!("ok" in calendar)) return outcomeOf(target.member_id, calendar);
      if (event.series_id === null) {
        const destination = await this.#destinationOf(link, "event");
        if ("stopped" in destination) return destination.stopped;
        if ("calendar" in destination) {
          this.#follow(link, destination.calendar, destination.event);
          continue;
        }
      }
      this.#deleteInFoyer(itemId);
      return "done";
    }
    return "failed";
  }

  async #removeFromGoogle(calendarId: string, eventId: string): Promise<SyncOutcome> {
    const calendar = this.#calendarById(calendarId);
    if (!calendar || calendar.lost_at !== null) return "done";
    if (!this.#readsAndWrites(calendar)) return "waiting";
    const removed = await this.#withAccess(calendar.member_id, (token) =>
      deleteEvent(token, calendarId, eventId),
    );
    if ("ok" in removed || "gone" in removed) return "done";
    return outcomeOf(calendar.member_id, removed);
  }

  #settleWrite(
    table: "google_event_writes" | "google_event_removals",
    where: string,
    keys: string[],
    write: { version?: number; tries: number },
    outcome: SyncOutcome,
  ): void {
    const { sql } = this.#storage;
    const sameWrite =
      write.version === undefined
        ? [where, keys]
        : [`${where} AND version = ?`, [...keys, write.version]];
    const [condition, bindings] = sameWrite as [string, (string | number)[]];
    if (outcome === "done") {
      sql.exec(`DELETE FROM ${table} WHERE ${condition}`, ...bindings);
    } else if (outcome !== "failed") {
      sql.exec(
        `UPDATE ${table} SET next_attempt_at = ? WHERE ${condition}`,
        untilWoken,
        ...bindings,
      );
    } else {
      const delay = Math.min(minute * 2 ** write.tries, longestWriteDelay);
      sql.exec(
        `UPDATE ${table} SET tries = tries + 1, next_attempt_at = ? WHERE ${condition}`,
        Date.now() + delay,
        ...bindings,
      );
    }
  }

  async #take(calendar: SpaceCalendar, event: GoogleEvent): Promise<SyncOutcome> {
    const series = this.#seriesAt(calendar.google_calendar_id, event.id);
    if (series && event.status === "cancelled") return this.#seriesLeft(series);
    if (series) {
      this.#listAgain(series);
      return "done";
    }
    if (isSeries(event) && event.status !== "cancelled") return this.#addSeries(calendar, event);
    const [link] = this.#links(
      "google_calendar_id = ? AND google_event_id = ?",
      calendar.google_calendar_id,
      event.id,
    );
    if (event.recurringEventId !== undefined) {
      return this.#takeOccurrence(calendar, event, link ?? null);
    }
    if (event.status === "cancelled") return link ? this.#leave(link) : "done";
    if (link) {
      this.#settleWithGoogle(link.item_id, event, { queueIfDifferent: true });
      return "done";
    }
    const elsewhere = this.#links(
      `google_event_id = ? AND google_calendar_id != ?
       AND item_id IN (SELECT id FROM items WHERE kind = 'event')`,
      event.id,
      calendar.google_calendar_id,
    );
    for (const known of elsewhere) {
      const left = await this.#hasLeft(known);
      if (typeof left === "object") return left.stopped;
      if (!left) continue;
      this.#follow(known, calendar, event);
      return "done";
    }
    this.#add(calendar, event);
    return "done";
  }

  #add(calendar: SpaceCalendar, event: GoogleEvent): void {
    const changed = this.#storage.transactionSync(() => this.#insert(calendar, event, null));
    this.#changed(changed);
  }

  #insert(calendar: SpaceCalendar, event: GoogleEvent, seriesId: string | null): RowKey[] {
    const { sql } = this.#storage;
    const fields = eventFieldsOf(event);
    if (!fields) return [];
    const at = updatedAt(event) ?? Date.now();
    const created = Date.parse(event.created ?? "");
    const itemId = newId();
    const setter = { at, changeId: newId() };
    insertItem(sql, {
      itemId,
      kind: "event",
      spaceId: calendar.space_id,
      title: fields.title,
      description: fields.description,
      date: null,
      time: fields.time,
      createdBy: null,
      createdAt: Number.isNaN(created) ? at : created,
      setter,
      seq: nextSeq(sql),
      seriesId,
    });
    sql.exec(
      `INSERT INTO google_events (item_id, google_calendar_id, google_event_id, etag, fields)
       VALUES (?, ?, ?, ?, ?)`,
      itemId,
      calendar.google_calendar_id,
      event.id,
      event.etag ?? null,
      JSON.stringify(fields),
    );
    const stickers = settleCalendarStickers(sql, [itemId], setter, null);
    return [{ kind: "item", id: itemId }, ...stickers];
  }

  #settleWithGoogle(
    itemId: string,
    event: GoogleEvent,
    options: { queueIfDifferent: boolean },
  ): void {
    const google = eventFieldsOf(event);
    if (!google) return;
    const { sql } = this.#storage;
    const changed = this.#storage.transactionSync(() => {
      const stored = this.#event(itemId);
      const link = this.#link(itemId);
      const foyer = stored && fieldsOfStored(stored);
      if (!stored || !link || !foyer) return [];
      const known = readFields(link.fields);
      const setter: Setter = { at: updatedAt(event) ?? Date.now(), changeId: newId() };
      const wins = (field: "title" | "description" | "time") =>
        (!known || !sameField(field, known, google)) &&
        !sameField(field, foyer, google) &&
        isLater(setter, { at: stored[`${field}_at`], changeId: stored[`${field}_change_id`] });
      const fieldsWon = (["title", "description", "time"] as const).filter(wins);
      let keys: RowKey[] = [];
      if (fieldsWon.length > 0) {
        const seq = nextSeq(sql);
        for (const field of fieldsWon) {
          if (field === "time") {
            writeEventTime(sql, itemId, google.time, setter, seq);
            continue;
          }
          sql.exec(
            `UPDATE items SET ${field} = ?, ${field}_at = ?, ${field}_change_id = ?, seq = ?
             WHERE id = ?`,
            google[field],
            setter.at,
            setter.changeId,
            seq,
            itemId,
          );
        }
        keys = [{ kind: "item", id: itemId }];
        if (fieldsWon.includes("time")) {
          keys.push(...settleCalendarStickers(sql, [itemId], setter, null));
        }
      }
      this.#keepLink(link, event);
      const after = this.#event(itemId);
      const now = after && fieldsOfStored(after);
      if (options.queueIfDifferent && now && !sameFields(now, google)) {
        queueEventWrites(sql, [{ kind: "item", id: itemId }]);
      }
      return keys;
    });
    this.#changed(changed);
  }

  #takeGoogleVersion(itemId: string, event: GoogleEvent): void {
    const google = eventFieldsOf(event);
    const { sql } = this.#storage;
    const changed = this.#storage.transactionSync(() => {
      const link = this.#link(itemId);
      if (!google || !link || !this.#event(itemId)) return [];
      const setter: Setter = { at: Date.now(), changeId: newId() };
      const seq = nextSeq(sql);
      sql.exec(
        `UPDATE items SET title = ?, title_at = ?, title_change_id = ?, description = ?,
           description_at = ?, description_change_id = ?, seq = ?
         WHERE id = ?`,
        google.title,
        setter.at,
        setter.changeId,
        google.description,
        setter.at,
        setter.changeId,
        seq,
        itemId,
      );
      writeEventTime(sql, itemId, google.time, setter, seq);
      this.#keepLink(link, event);
      const stickers = settleCalendarStickers(sql, [itemId], setter, null);
      return [{ kind: "item", id: itemId }, ...stickers] satisfies RowKey[];
    });
    this.#changed(changed);
  }

  async #leave(link: Link): Promise<SyncOutcome> {
    if (!this.#event(link.item_id)) {
      this.#deleteInFoyer(link.item_id);
      return "done";
    }
    const destination = await this.#destinationOf(link, "event");
    if ("stopped" in destination) return destination.stopped;
    if ("calendar" in destination) {
      this.#follow(link, destination.calendar, destination.event);
    } else {
      this.#deleteInFoyer(link.item_id);
    }
    return "done";
  }

  async #destinationOf(left: GoogleIds, kind: "event" | "series"): Promise<Destination> {
    const known = kind === "event" ? "google_events" : "google_series";
    const others = this.#storage.sql
      .exec<SpaceCalendar>(
        `SELECT space_id, member_id, google_calendar_id, time_zone, sync_token, read_at, lost_at
         FROM space_calendars
         WHERE google_calendar_id != ? AND lost_at IS NULL
           AND google_calendar_id NOT IN
             (SELECT google_calendar_id FROM ${known} WHERE google_event_id = ?)
         ORDER BY created_at, space_id`,
        left.google_calendar_id,
        left.google_event_id,
      )
      .toArray()
      .filter(({ member_id }) => this.#isConnected(member_id));
    for (const calendar of others) {
      const found = await this.#withAccess(calendar.member_id, (token) =>
        readEvent(token, calendar.google_calendar_id, left.google_event_id),
      );
      if ("ok" in found) {
        const isKind = kind === "series" ? isSeries(found.ok) : isSingle(found.ok);
        if (found.ok.status !== "cancelled" && isKind) {
          return { calendar, event: found.ok };
        }
      } else if (!("gone" in found)) {
        return { stopped: outcomeOf(calendar.member_id, found) };
      }
    }
    return { nowhere: true };
  }

  async #hasLeft(link: GoogleIds): Promise<boolean | { stopped: SyncOutcome }> {
    const calendar = this.#calendarById(link.google_calendar_id);
    const canAsk = calendar !== null && calendar.lost_at === null && this.#readsAndWrites(calendar);
    if (!canAsk) return true;
    const found = await this.#withAccess(calendar.member_id, (token) =>
      readEvent(token, link.google_calendar_id, link.google_event_id),
    );
    if ("ok" in found) return found.ok.status === "cancelled";
    if ("gone" in found) return true;
    return { stopped: outcomeOf(calendar.member_id, found) };
  }

  #follow(link: Link, to: SpaceCalendar, event: GoogleEvent): void {
    const { sql } = this.#storage;
    const setter: Setter = { at: updatedAt(event) ?? Date.now(), changeId: newId() };
    const changed = this.#storage.transactionSync(() => {
      sql.exec(
        "UPDATE google_events SET google_calendar_id = ? WHERE item_id = ?",
        to.google_calendar_id,
        link.item_id,
      );
      const moved = moveItemForHousehold(sql, link.item_id, to.space_id, setter);
      if (moved === null) queueEventWrites(sql, [{ kind: "item", id: link.item_id }]);
      return moved ?? [];
    });
    this.#changed(changed);
    this.#settleWithGoogle(link.item_id, event, { queueIfDifferent: true });
  }

  #deleteInFoyer(itemId: string): void {
    const { sql } = this.#storage;
    const changed = this.#storage.transactionSync(() => {
      sql.exec("DELETE FROM google_events WHERE item_id = ?", itemId);
      sql.exec("DELETE FROM google_event_writes WHERE item_id = ?", itemId);
      return deleteItemForHousehold(sql, itemId, { at: Date.now(), changeId: newId() });
    });
    this.#changed(changed);
  }

  async #dropMissing(calendarId: string, seen: ReadonlySet<string>): Promise<SyncOutcome> {
    const linked = this.#links(
      `google_calendar_id = ? AND etag IS NOT NULL
       AND item_id NOT IN (SELECT id FROM items WHERE series_id IS NOT NULL)`,
      calendarId,
    );
    for (const link of linked) {
      if (seen.has(link.google_event_id)) continue;
      const left = await this.#leave(link);
      if (left !== "done") return left;
    }
    for (const series of this.#seriesWhere("google_calendar_id = ?", calendarId)) {
      if (seen.has(series.google_event_id)) continue;
      const left = await this.#seriesLeft(series);
      if (left !== "done") return left;
    }
    return "done";
  }

  /** The series whose occurrences are due to be made, or listed again, in calendars whose holder is
   *  connected and whose space isn't archived, those to list again first. */
  seriesDue(now = Date.now()): { series: Series; calendar: SpaceCalendar }[] {
    const { to } = occurrenceWindow(now);
    const due = this.#seriesWhere("made_until IS NULL OR made_until < ?", to);
    return due.flatMap((series) => {
      const calendar = this.#calendarById(series.google_calendar_id);
      const readable =
        calendar !== null && calendar.lost_at === null && this.#readsAndWrites(calendar);
      return readable ? [{ series, calendar }] : [];
    });
  }

  /** Makes a series' occurrences in `occurrenceWindow`, or those beyond the ones made, changing
   *  those Foyer has to match. Listed again, one Google no longer lists becomes another it lists on
   *  the same day, keeping its id, or is deleted. */
  async makeOccurrences(series: Series, calendar: SpaceCalendar): Promise<SyncOutcome> {
    const window = occurrenceWindow(Date.now());
    const again = series.made_until === null;
    const from = again ? window.from : Math.max(series.made_until ?? 0, window.from);
    const instances: GoogleEvent[] = [];
    let pageToken: string | undefined;
    while (from < window.to) {
      const page = await this.#withAccess(calendar.member_id, (token) =>
        listInstances(token, calendar.google_calendar_id, series.google_event_id, {
          timeMin: from,
          timeMax: window.to,
          ...(pageToken ? { pageToken } : {}),
        }),
      );
      if ("gone" in page) return this.#seriesLeft(series);
      if ("invalid" in page) {
        console.error(`Google refused to list series ${series.series_id}: ${page.invalid}`);
        this.#storage.sql.exec(
          "UPDATE google_series SET made_until = ? WHERE series_id = ?",
          window.to,
          series.series_id,
        );
        return "done";
      }
      if (!("ok" in page)) return outcomeOf(calendar.member_id, page);
      instances.push(...page.ok.events.filter(({ status }) => status !== "cancelled"));
      pageToken = page.ok.nextPageToken;
      if (!pageToken) break;
    }
    const current = this.#seriesAt(series.google_calendar_id, series.google_event_id);
    if (current?.series_id !== series.series_id) return "done";
    this.#takeOccurrences(calendar, series, instances, again ? { from, to: window.to } : null);
    return "done";
  }

  #takeOccurrences(
    calendar: SpaceCalendar,
    series: Series,
    instances: readonly GoogleEvent[],
    listedAgain: { from: number; to: number } | null,
  ): void {
    const { sql } = this.#storage;
    const removing = new Set(
      sql
        .exec<{ google_event_id: string }>(
          "SELECT google_event_id FROM google_event_removals WHERE google_calendar_id = ?",
          calendar.google_calendar_id,
        )
        .toArray()
        .map(({ google_event_id }) => google_event_id),
    );
    const made = new Map(
      sql
        .exec<Occurrence>(
          `SELECT google_events.item_id, google_events.google_event_id, items.date, items.starts_on,
             items.ends_on, items.starts_at, items.ends_at,
             EXISTS (SELECT 1 FROM google_event_writes WHERE item_id = items.id) AS waiting
           FROM google_events JOIN items ON items.id = google_events.item_id
           WHERE items.series_id = ?`,
          series.series_id,
        )
        .toArray()
        .map((occurrence) => [occurrence.google_event_id, occurrence]),
    );
    const listed: GoogleEvent[] = [];
    for (const instance of instances) {
      const occurrence = made.get(instance.id);
      if (occurrence) {
        this.#settleWithGoogle(occurrence.item_id, instance, { queueIfDifferent: true });
        made.delete(instance.id);
      } else if (!removing.has(instance.id)) {
        listed.push(instance);
      }
    }
    const gone = listedAgain
      ? [...made.values()].filter(
          (occurrence) => !occurrence.waiting && happensBetween(occurrence, listedAgain),
        )
      : [];
    const relinked: { itemId: string; instance: GoogleEvent }[] = [];
    const changed = this.#storage.transactionSync(() => {
      const keys: RowKey[] = [];
      for (const instance of listed) {
        const fields = eventFieldsOf(instance);
        const day = fields && eventDate(fields.time, calendar.time_zone);
        const sameDay = gone.findIndex((occurrence) => occurrence.date === day);
        const [replaced] = sameDay >= 0 ? gone.splice(sameDay, 1) : [];
        if (replaced) {
          sql.exec(
            "UPDATE google_events SET google_event_id = ? WHERE item_id = ?",
            instance.id,
            replaced.item_id,
          );
          relinked.push({ itemId: replaced.item_id, instance });
          continue;
        }
        keys.push(...this.#insert(calendar, instance, series.series_id));
      }
      const setter = { at: Date.now(), changeId: newId() };
      for (const { item_id } of gone) {
        sql.exec("DELETE FROM google_events WHERE item_id = ?", item_id);
        keys.push(...deleteItemForHousehold(sql, item_id, setter));
      }
      sql.exec(
        "UPDATE google_series SET made_until = ? WHERE series_id = ?",
        occurrenceWindow(Date.now()).to,
        series.series_id,
      );
      return keys;
    });
    this.#changed(changed);
    for (const { itemId, instance } of relinked) {
      this.#settleWithGoogle(itemId, instance, { queueIfDifferent: true });
    }
  }

  async #takeOccurrence(
    calendar: SpaceCalendar,
    event: GoogleEvent,
    link: Link | null,
  ): Promise<SyncOutcome> {
    if (event.status === "cancelled") {
      if (link) this.#deleteInFoyer(link.item_id);
      return "done";
    }
    if (link) {
      this.#settleWithGoogle(link.item_id, event, { queueIfDifferent: true });
      return "done";
    }
    const series = this.#seriesAt(calendar.google_calendar_id, event.recurringEventId ?? "");
    if (series) this.#listAgain(series);
    return "done";
  }

  async #addSeries(calendar: SpaceCalendar, event: GoogleEvent): Promise<SyncOutcome> {
    const elsewhere = this.#seriesWhere(
      "google_event_id = ? AND google_calendar_id != ?",
      event.id,
      calendar.google_calendar_id,
    );
    for (const known of elsewhere) {
      const left = await this.#hasLeft(known);
      if (typeof left === "object") return left.stopped;
      if (!left) continue;
      this.#followSeries(known, calendar);
      return "done";
    }
    this.#storage.sql.exec(
      `INSERT INTO google_series (google_calendar_id, google_event_id, series_id, made_until)
       VALUES (?, ?, ?, NULL)`,
      calendar.google_calendar_id,
      event.id,
      newId(),
    );
    return "done";
  }

  async #seriesLeft(series: Series): Promise<SyncOutcome> {
    const destination = await this.#destinationOf(series, "series");
    if ("stopped" in destination) return destination.stopped;
    if ("calendar" in destination) {
      this.#followSeries(series, destination.calendar);
      return "done";
    }
    const { sql } = this.#storage;
    const changed = this.#storage.transactionSync(() => {
      const occurrences = this.#occurrencesOf(series.series_id);
      const setter = { at: Date.now(), changeId: newId() };
      sql.exec("DELETE FROM google_series WHERE series_id = ?", series.series_id);
      return occurrences.flatMap((itemId) => {
        sql.exec("DELETE FROM google_events WHERE item_id = ?", itemId);
        sql.exec("DELETE FROM google_event_writes WHERE item_id = ?", itemId);
        return deleteItemForHousehold(sql, itemId, setter);
      });
    });
    this.#changed(changed);
    return "done";
  }

  #followSeries(series: Series, to: SpaceCalendar): void {
    const { sql } = this.#storage;
    const changed = this.#storage.transactionSync(() => {
      sql.exec(
        `UPDATE google_series SET google_calendar_id = ?, made_until = NULL
         WHERE series_id = ?`,
        to.google_calendar_id,
        series.series_id,
      );
      const setter: Setter = { at: Date.now(), changeId: newId() };
      return this.#occurrencesOf(series.series_id).flatMap((itemId) => {
        sql.exec(
          "UPDATE google_events SET google_calendar_id = ? WHERE item_id = ?",
          to.google_calendar_id,
          itemId,
        );
        return moveItemForHousehold(sql, itemId, to.space_id, setter) ?? [];
      });
    });
    this.#changed(changed);
  }

  #listAgain(series: Series): void {
    this.#storage.sql.exec(
      "UPDATE google_series SET made_until = NULL WHERE series_id = ?",
      series.series_id,
    );
  }

  #occurrencesOf(seriesId: string): string[] {
    return this.#storage.sql
      .exec<{ id: string }>("SELECT id FROM items WHERE series_id = ? ORDER BY id", seriesId)
      .toArray()
      .map(({ id }) => id);
  }

  #seriesAt(calendarId: string, eventId: string): Series | null {
    const [series] = this.#seriesWhere(
      "google_calendar_id = ? AND google_event_id = ?",
      calendarId,
      eventId,
    );
    return series ?? null;
  }

  #seriesWhere(where: string, ...values: (string | number)[]): Series[] {
    return this.#storage.sql
      .exec<Series>(
        `SELECT google_calendar_id, google_event_id, series_id, made_until FROM google_series
         WHERE ${where} ORDER BY made_until IS NOT NULL, made_until, series_id`,
        ...values,
      )
      .toArray();
  }

  #changeTimeZone(spaceId: string, timeZone: string): void {
    const { sql } = this.#storage;
    const changed = this.#storage.transactionSync(() => {
      sql.exec("UPDATE space_calendars SET time_zone = ? WHERE space_id = ?", timeZone, spaceId);
      const events = sql
        .exec<{ id: string }>("SELECT id FROM items WHERE space_id = ? AND kind = 'event'", spaceId)
        .toArray()
        .map(({ id }) => id);
      const setter = { at: Date.now(), changeId: newId() };
      const redated = redateEvents(sql, events, setter, nextSeq(sql));
      return [
        ...redated.map((id): RowKey => ({ kind: "item", id })),
        ...settleCalendarStickers(sql, redated, setter, null),
      ];
    });
    this.#changed(changed);
  }

  #queueRemoval(link: Link): void {
    const { sql } = this.#storage;
    this.#storage.transactionSync(() => {
      sql.exec(
        `INSERT OR IGNORE INTO google_event_removals
           (google_calendar_id, google_event_id, tries, next_attempt_at)
         VALUES (?, ?, 0, 0)`,
        link.google_calendar_id,
        link.google_event_id,
      );
      sql.exec("DELETE FROM google_events WHERE item_id = ?", link.item_id);
    });
  }

  #keepLink(link: Link | null, event: GoogleEvent, options: { fields?: null } = {}): void {
    if (!link) return;
    const fields = options.fields === null ? null : eventFieldsOf(event);
    this.#storage.sql.exec(
      `UPDATE google_events SET google_calendar_id = ?, etag = ?, fields = ? WHERE item_id = ?`,
      link.google_calendar_id,
      event.etag ?? null,
      fields ? JSON.stringify(fields) : null,
      link.item_id,
    );
  }

  #addLink(itemId: string, calendarId: string, eventId: string): void {
    this.#storage.sql.exec(
      `INSERT INTO google_events (item_id, google_calendar_id, google_event_id, etag, fields)
       VALUES (?, ?, ?, NULL, NULL)`,
      itemId,
      calendarId,
      eventId,
    );
  }

  #link(itemId: string): Link | null {
    const [link] = this.#links("item_id = ?", itemId);
    return link ?? null;
  }

  #links(where: string, ...values: string[]): Link[] {
    return this.#storage.sql
      .exec<Link>(
        `SELECT item_id, google_calendar_id, google_event_id, etag, fields FROM google_events
         WHERE ${where} ORDER BY item_id`,
        ...values,
      )
      .toArray();
  }

  #event(itemId: string): StoredEvent | null {
    const [event] = this.#storage.sql
      .exec<StoredEvent>(
        `SELECT space_id, series_id, title, description, starts_on, ends_on, starts_at, ends_at,
           title_at,
           title_change_id, description_at, description_change_id, time_at, time_change_id
         FROM items WHERE id = ? AND kind = 'event'`,
        itemId,
      )
      .toArray();
    return event ?? null;
  }

  #calendarOfSpace(spaceId: string): SpaceCalendar | null {
    return this.#calendarWhere("space_id = ?", spaceId);
  }

  #calendarById(calendarId: string): SpaceCalendar | null {
    return this.#calendarWhere("google_calendar_id = ?", calendarId);
  }

  #calendarWhere(where: string, value: string): SpaceCalendar | null {
    const [calendar] = this.#storage.sql
      .exec<SpaceCalendar>(
        `SELECT space_id, member_id, google_calendar_id, time_zone, sync_token, read_at, lost_at
         FROM space_calendars WHERE ${where}`,
        value,
      )
      .toArray();
    return calendar ?? null;
  }

  #readsAndWrites(calendar: SpaceCalendar): boolean {
    const archived = this.#storage.sql
      .exec("SELECT 1 FROM spaces WHERE id = ? AND archived = 1", calendar.space_id)
      .toArray().length;
    return archived === 0 && this.#isConnected(calendar.member_id);
  }

  #isConnected(memberId: string): boolean {
    return (
      this.#storage.sql
        .exec(
          "SELECT 1 FROM google_connections WHERE member_id = ? AND state = 'connected'",
          memberId,
        )
        .toArray().length > 0
    );
  }
}

function isSingle(event: GoogleEvent): boolean {
  return !isSeries(event) && event.recurringEventId === undefined;
}

const day = 24 * 60 * minute;

function happensBetween(occurrence: Occurrence, between: { from: number; to: number }): boolean {
  const time = storedEventTime(occurrence);
  if (!time) return false;
  const [starts, ends] = time.allDay
    ? [Date.parse(time.startsOn), Date.parse(time.endsOn) + day]
    : [time.startsAt, time.endsAt];
  return ends > between.from && starts < between.to;
}

function newGoogleEventId(): string {
  return newId().replaceAll("-", "");
}

function fieldsOfStored(event: StoredEvent): EventFields | null {
  const time = storedEventTime(event);
  return time && { title: event.title, description: event.description, time };
}

function withoutDescriptionUnchangedSinceRead(
  fields: EventFields,
  lastRead: EventFields | null,
): GoogleEventFields {
  const { description, ...changes } = googleFieldsOf(fields);
  return lastRead?.description === fields.description ? changes : { ...changes, description };
}

function readFields(json: string | null): EventFields | null {
  if (json === null) return null;
  try {
    return JSON.parse(json) as EventFields;
  } catch {
    return null;
  }
}

function sameField(field: "title" | "description" | "time", a: EventFields, b: EventFields) {
  return field === "time" ? sameEventTime(a.time, b.time) : a[field] === b[field];
}

function sameFields(a: EventFields, b: EventFields): boolean {
  return (["title", "description", "time"] as const).every((field) => sameField(field, a, b));
}

function outcomeOf(memberId: string, answer: object): SyncOutcome {
  if ("outOfCalls" in answer) return "postponed";
  if ("revoked" in answer) return { accessStopped: memberId };
  const reason = "failed" in answer ? answer.failed : JSON.stringify(answer);
  console.error(`Syncing events with Google failed: ${reason}`);
  return "failed";
}

import { type Timestamp, timestampMs } from "@bufbuild/protobuf/wkt";
import { type EventTime, eventDate, eventTimeFields, readEventTime } from "@foyer/shared";
import type { EventSetTime } from "@foyer/shared/gen/foyer/event/v1/event_pb";
import { type Applied, isLater, type Setter } from "./changes";
import { itemFor } from "./items";
import { nextSeq, type RowKey } from "./rows";

/** When an event happens, as a change carries it, or why it can't happen then. */
export function eventTimeIn(change: {
  startsOn: string;
  endsOn: string;
  startsAt?: Timestamp;
  endsAt?: Timestamp;
}): EventTime | { problem: string } {
  return readEventTime({
    startsOn: change.startsOn,
    endsOn: change.endsOn,
    startsAt: change.startsAt ? timestampMs(change.startsAt) : null,
    endsAt: change.endsAt ? timestampMs(change.endsAt) : null,
  });
}

/** The time zone of a space's Google calendar, or null when the space has none. */
export function calendarTimeZone(sql: SqlStorage, spaceId: string): string | null {
  const [calendar] = sql
    .exec<{ time_zone: string }>(
      "SELECT time_zone FROM space_calendars WHERE space_id = ?",
      spaceId,
    )
    .toArray();
  return calendar?.time_zone ?? null;
}

/** When an event that the household holds happens, or null for an item that isn't an event. */
export function storedEventTime(row: {
  starts_on: string | null;
  ends_on: string | null;
  starts_at: number | null;
  ends_at: number | null;
}): EventTime | null {
  const read = readEventTime({
    startsOn: row.starts_on ?? "",
    endsOn: row.ends_on ?? "",
    startsAt: row.starts_at,
    endsAt: row.ends_at,
  });
  return "problem" in read ? null : read;
}

/** Changes when an event the member sees happens, unless a later change to its time won, and sets
 *  its date to the day it now starts in its calendar's time zone. Changing a deleted event has no
 *  effect. */
export function setEventTime(
  sql: SqlStorage,
  memberId: string,
  setter: Setter,
  change: EventSetTime,
): Applied {
  const time = eventTimeIn(change);
  if ("problem" in time) return { refused: time.problem };
  const found = itemFor(sql, memberId, change.itemId);
  if (!("item" in found)) return found.applied;
  if (found.item.kind !== "event") return { refused: "Only events have a time." };

  const key: RowKey = { kind: "item", id: change.itemId };
  const last = { at: found.item.time_at, changeId: found.item.time_change_id };
  if (!isLater(setter, last)) return { seq: nextSeq(sql), changed: [], unchanged: [key] };
  const seq = nextSeq(sql);
  writeEventTime(sql, change.itemId, time, setter, seq);
  return { seq, changed: [key], unchanged: [] };
}

/** Sets when an event happens, as change `seq` made by `setter`, and its date to the day it starts
 *  in its space's calendar's time zone. */
export function writeEventTime(
  sql: SqlStorage,
  itemId: string,
  time: EventTime,
  setter: Setter,
  seq: number,
): void {
  const fields = eventTimeFields(time);
  sql.exec(
    `UPDATE items SET starts_on = ?, ends_on = ?, starts_at = ?, ends_at = ?, time_at = ?,
       time_change_id = ?, seq = ?
     WHERE id = ?`,
    fields.startsOn || null,
    fields.endsOn || null,
    fields.startsAt,
    fields.endsAt,
    setter.at,
    setter.changeId,
    seq,
    itemId,
  );
  redateEvents(sql, [itemId], setter, seq);
}

/** Sets the date of each event among some items to the day it starts in its space's calendar's
 *  time zone, as change `seq` made by `setter`. Returns the events whose date changed. */
export function redateEvents(
  sql: SqlStorage,
  itemIds: readonly string[],
  setter: Setter,
  seq: number,
): string[] {
  const redated: string[] = [];
  for (const itemId of itemIds) {
    const [event] = sql
      .exec<StoredTime & { date: string | null; time_zone: string | null }>(
        `SELECT items.date, items.starts_on, items.ends_on, items.starts_at, items.ends_at,
           space_calendars.time_zone
         FROM items LEFT JOIN space_calendars ON space_calendars.space_id = items.space_id
         WHERE items.id = ? AND items.kind = 'event'`,
        itemId,
      )
      .toArray();
    const time = event && storedEventTime(event);
    if (!event || !time) continue;
    const date = eventDate(time, event.time_zone ?? "UTC");
    if (date === event.date) continue;
    sql.exec(
      "UPDATE items SET date = ?, date_at = ?, date_change_id = ?, seq = ? WHERE id = ?",
      date,
      setter.at,
      setter.changeId,
      seq,
      itemId,
    );
    redated.push(itemId);
  }
  return redated;
}

/** Whether some items can move into a space: those that are events only into a space that has a
 *  Google calendar. */
export function eventsCanMoveTo(sql: SqlStorage, itemIds: readonly string[], spaceId: string) {
  if (calendarTimeZone(sql, spaceId) !== null) return true;
  return !itemIds.some(
    (id) =>
      sql.exec("SELECT 1 FROM items WHERE id = ? AND kind = 'event'", id).toArray().length > 0,
  );
}

/** Refused when an event would move into a space without a Google calendar. */
export const eventNeedsCalendar = "An event can only go in a space with a Google calendar.";

/** Whether any of some items is an occurrence of a repeating event, which moves to another space
 *  only with its series, in Google Calendar. */
export function holdsOccurrence(sql: SqlStorage, itemIds: readonly string[]): boolean {
  return itemIds.some(
    (id) =>
      sql.exec("SELECT 1 FROM items WHERE id = ? AND series_id IS NOT NULL", id).toArray().length >
      0,
  );
}

/** Refused when an occurrence of a repeating event would move to another space. */
export const occurrenceMovesWithSeries =
  "A repeating event moves with its series, in Google Calendar.";

type StoredTime = {
  starts_on: string | null;
  ends_on: string | null;
  starts_at: number | null;
  ends_at: number | null;
};

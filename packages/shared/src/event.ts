import { isIsoDate } from "./page";

/** When an event happens: all day, from its first day to its last, both plain ISO 8601 dates, or
 *  from one moment to another, in milliseconds since 1970. */
export type EventTime =
  | { allDay: true; startsOn: string; endsOn: string }
  | { allDay: false; startsAt: number; endsAt: number };

/** When an event happens, as items and changes carry it: either both days, or both moments, with
 *  the others empty. Moments are in milliseconds since 1970, or null when empty. */
export type EventTimeFields = {
  startsOn: string;
  endsOn: string;
  startsAt: number | null;
  endsAt: number | null;
};

/** Reads when an event happens from its fields, or says why they don't make a time it can happen
 *  at: exactly one pair must be set, days must be dates, and it can't end before it starts. */
export function readEventTime(fields: EventTimeFields): EventTime | { problem: string } {
  const { startsOn, endsOn, startsAt, endsAt } = fields;
  const days = startsOn !== "" || endsOn !== "";
  const moments = startsAt !== null || endsAt !== null;
  if (days === moments) {
    return { problem: "An event happens either on whole days or between two times." };
  }
  if (days) {
    if (!isIsoDate(startsOn) || !isIsoDate(endsOn)) {
      return { problem: "An all-day event's first and last days are dates, as in “2026-11-17”." };
    }
    if (endsOn < startsOn) return { problem: endsBeforeItStarts };
    return { allDay: true, startsOn, endsOn };
  }
  if (startsAt === null || endsAt === null || !Number.isFinite(startsAt + endsAt)) {
    return { problem: "An event with times needs both the time it starts and the time it ends." };
  }
  if (endsAt < startsAt) return { problem: endsBeforeItStarts };
  return { allDay: false, startsAt, endsAt };
}

/** The fields that carry when an event happens, as `readEventTime` reads them. */
export function eventTimeFields(time: EventTime): EventTimeFields {
  return time.allDay
    ? { startsOn: time.startsOn, endsOn: time.endsOn, startsAt: null, endsAt: null }
    : { startsOn: "", endsOn: "", startsAt: time.startsAt, endsAt: time.endsAt };
}

/** Whether two times are the same. */
export function sameEventTime(a: EventTime, b: EventTime): boolean {
  if (a.allDay || b.allDay) {
    return a.allDay && b.allDay && a.startsOn === b.startsOn && a.endsOn === b.endsOn;
  }
  return a.startsAt === b.startsAt && a.endsAt === b.endsAt;
}

/** The day an event belongs to: its first day, or the day it starts in a time zone, an IANA name
 *  such as "Europe/Madrid". */
export function eventDate(time: EventTime, timeZone: string): string {
  return time.allDay ? time.startsOn : dayIn(time.startsAt, timeZone);
}

/** The day a moment, in milliseconds since 1970, falls on in a time zone, as a plain ISO 8601 date.
 *  A time zone that isn't known counts as UTC. */
export function dayIn(at: number, timeZone: string): string {
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat("en-US", { timeZone, ...dayParts });
  } catch {
    format = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...dayParts });
  }
  const parts = Object.fromEntries(
    format.formatToParts(at).map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

const dayParts = { year: "numeric", month: "2-digit", day: "2-digit" } as const;

const endsBeforeItStarts = "An event can't end before it starts.";

import {
  type EventTime,
  isIsoDate,
  limitItemDescription,
  limitItemTitle,
  readEventTime,
} from "@foyer/shared";
import type { GoogleEvent, GoogleEventFields } from "./google-calendar";
import { plainTextOf } from "./html-text";

/** What Foyer keeps of an event, which it writes to Google and reads back from it. */
export type EventFields = { title: string; description: string; time: EventTime };

/** The title of an event that has none in Google, as Google Calendar shows it. */
export const untitledEvent = "(No title)";

/** An event's fields as Google's Calendar API takes them: an all-day event ends the day after its
 *  last day there. Clears the start and end Google had of the other kind. */
export function googleFieldsOf({ title, description, time }: EventFields): GoogleEventFields {
  if (time.allDay) {
    return {
      summary: title,
      description,
      start: { date: time.startsOn, dateTime: null, timeZone: null },
      end: { date: addDays(time.endsOn, 1), dateTime: null, timeZone: null },
    };
  }
  return {
    summary: title,
    description,
    start: { date: null, dateTime: new Date(time.startsAt).toISOString() },
    end: { date: null, dateTime: new Date(time.endsAt).toISOString() },
  };
}

/** What Foyer keeps of an event from Google, made to fit Foyer's rules: a blank title becomes
 *  `untitledEvent`, an HTML description plain text, a title or description too long is cut, and an
 *  event that ends before it starts ends as it starts. Null when Foyer can't read its start. */
export function eventFieldsOf(event: GoogleEvent): EventFields | null {
  const time = timeOf(event);
  if (!time) return null;
  const title = limitItemTitle(event.summary?.trim() || untitledEvent);
  const description = limitItemDescription(plainTextOf(event.description ?? ""));
  return { title, description, time };
}

/** Whether an event belongs to a repeating series: the series itself, or one of its occurrences. */
export function isRepeating(event: GoogleEvent): boolean {
  return (event.recurrence?.length ?? 0) > 0 || Boolean(event.recurringEventId);
}

/** When Google last changed an event, in milliseconds since 1970, or null if it doesn't say. */
export function updatedAt(event: GoogleEvent): number | null {
  const at = Date.parse(event.updated ?? "");
  return Number.isNaN(at) ? null : at;
}

function timeOf({ start, end }: GoogleEvent): EventTime | null {
  if (start?.date !== undefined && start.date !== null) {
    if (!isIsoDate(start.date)) return null;
    const lastDay = end?.date && isIsoDate(end.date) ? addDays(end.date, -1) : start.date;
    const endsOn = [start.date, lastDay].sort().at(-1) ?? start.date;
    const read = readEventTime({ startsOn: start.date, endsOn, startsAt: null, endsAt: null });
    return "problem" in read ? null : read;
  }
  const startsAt = Date.parse(start?.dateTime ?? "");
  if (Number.isNaN(startsAt)) return null;
  const ending = Date.parse(end?.dateTime ?? "");
  const endsAt = Number.isNaN(ending) || ending < startsAt ? startsAt : ending;
  return { allDay: false, startsAt, endsAt };
}

function addDays(date: string, days: number): string {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

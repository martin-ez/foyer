import { timestampMs } from "@bufbuild/protobuf/wkt";
import { type EventTime, isIsoDate, readEventTime } from "@foyer/shared";
import { type Item, ItemKind } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import { addDays, describeDay, localToday } from "../page/calendar-date";

/** When an event happens, or null for an item that isn't an event. */
export function timeOf(item: Item): EventTime | null {
  if (item.kind !== ItemKind.EVENT) return null;
  const read = readEventTime({
    startsOn: item.startsOn,
    endsOn: item.endsOn,
    startsAt: item.startsAt ? timestampMs(item.startsAt) : null,
    endsAt: item.endsAt ? timestampMs(item.endsAt) : null,
  });
  return "problem" in read ? null : read;
}

/** The events that haven't ended by the device's clock, soonest first: an all-day event until its
 *  last day is over, in the device's time zone. Events that start together come by title. A
 *  repeating series comes once, as its next occurrence that hasn't ended. */
export function upcomingEvents(items: Iterable<Item>, now = new Date()): Item[] {
  const today = localToday(now);
  const upcoming: { item: Item; startsAt: number }[] = [];
  for (const item of items) {
    const time = timeOf(item);
    if (!time) continue;
    if (time.allDay ? time.endsOn < today : time.endsAt < now.getTime()) continue;
    upcoming.push({ item, startsAt: time.allDay ? midnightOf(time.startsOn) : time.startsAt });
  }
  const seriesListed = new Set<string>();
  return upcoming
    .sort((a, b) => a.startsAt - b.startsAt || a.item.title.localeCompare(b.item.title))
    .map(({ item }) => item)
    .filter(({ seriesId }) => {
      if (seriesId === "") return true;
      if (seriesListed.has(seriesId)) return false;
      seriesListed.add(seriesId);
      return true;
    });
}

/** The events that happen at some time of the device's today, by its clock and time zone: all-day
 *  ones first, then by when they start, and events that start together by title. */
export function todayEvents(items: Iterable<Item>, now = new Date()): Item[] {
  const today = localToday(now);
  const dayStarts = midnightOf(today);
  const dayEnds = midnightOf(addDays(today, 1));
  const listed: { item: Item; allDay: boolean; startsAt: number }[] = [];
  for (const item of items) {
    const time = timeOf(item);
    if (!time) continue;
    if (time.allDay) {
      if (time.startsOn <= today && today <= time.endsOn)
        listed.push({ item, allDay: true, startsAt: 0 });
    } else if (time.startsAt < dayEnds && (time.endsAt > dayStarts || time.startsAt >= dayStarts)) {
      listed.push({ item, allDay: false, startsAt: time.startsAt });
    }
  }
  return listed
    .sort(
      (a, b) =>
        Number(b.allDay) - Number(a.allDay) ||
        a.startsAt - b.startsAt ||
        a.item.title.localeCompare(b.item.title),
    )
    .map(({ item }) => item);
}

/** When an event happens as people read it, in the device's time zone. */
export function describeEventTime(time: EventTime, locale?: string): string {
  if (time.allDay) {
    const days =
      time.startsOn === time.endsOn
        ? describeDay(time.startsOn, locale)
        : `${describeDay(time.startsOn, locale)} – ${describeDay(time.endsOn, locale)}`;
    return `${days}, all day`;
  }
  const start = new Date(time.startsAt);
  const end = new Date(time.endsAt);
  const clock = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" });
  const startDay = describeDay(localToday(start), locale);
  if (localToday(start) === localToday(end)) {
    return `${startDay}, ${clock.format(start)} – ${clock.format(end)}`;
  }
  const endDay = describeDay(localToday(end), locale);
  return `${startDay}, ${clock.format(start)} – ${endDay}, ${clock.format(end)}`;
}

/** An event's time as the editor's fields show it, in the device's time zone: its first and last
 *  days, and, unless it's all day, the times it starts and ends, as "19:00". */
export type EventTimeDraft = {
  allDay: boolean;
  startsOn: string;
  endsOn: string;
  startTime: string;
  endTime: string;
};

/** A new event's time: today from 9:00 to 10:00. */
export function newEventDraft(today = localToday()): EventTimeDraft {
  return { allDay: false, startsOn: today, endsOn: today, startTime: "09:00", endTime: "10:00" };
}

/** The editor's fields for an event's time. */
export function draftOf(time: EventTime): EventTimeDraft {
  if (time.allDay) {
    const { startsOn, endsOn } = time;
    return { allDay: true, startsOn, endsOn, startTime: "09:00", endTime: "10:00" };
  }
  const start = new Date(time.startsAt);
  const end = new Date(time.endsAt);
  return {
    allDay: false,
    startsOn: localToday(start),
    endsOn: localToday(end),
    startTime: clockOf(start),
    endTime: clockOf(end),
  };
}

/** The time the editor's fields describe, in the device's time zone, or why they don't describe
 *  one an event can happen at. */
export function timeFromDraft(draft: EventTimeDraft): EventTime | { problem: string } {
  if (!isIsoDate(draft.startsOn) || !isIsoDate(draft.endsOn)) {
    return { problem: "Days are dates, as in 2026-11-17." };
  }
  if (draft.allDay) {
    return readEventTime({ ...draft, startsAt: null, endsAt: null });
  }
  const startsAt = momentOf(draft.startsOn, draft.startTime);
  const endsAt = momentOf(draft.endsOn, draft.endTime);
  if (startsAt === null || endsAt === null) return { problem: "Times are as in 19:00." };
  return readEventTime({ startsOn: "", endsOn: "", startsAt, endsAt });
}

function momentOf(date: string, time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  const [hours, minutes] = [Number(match?.[1]), Number(match?.[2])];
  if (!match || hours > 23 || minutes > 59) return null;
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  return new Date(year, month - 1, day, hours, minutes).getTime();
}

function midnightOf(date: string): number {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  return new Date(year, month - 1, day).getTime();
}

function clockOf(moment: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(moment.getHours())}:${pad(moment.getMinutes())}`;
}

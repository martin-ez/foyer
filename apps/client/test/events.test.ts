import { create } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import { ItemKind, ItemSchema } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  describeEventTime,
  draftOf,
  newEventDraft,
  timeFromDraft,
  timeOf,
  upcomingEvents,
} from "../src/calendar/events";

const zone = process.env.TZ;

beforeEach(() => {
  process.env.TZ = "America/Santo_Domingo";
});

afterEach(() => {
  process.env.TZ = zone;
});

function event(title: string, time: { on?: [string, string]; at?: [string, string] }) {
  return create(ItemSchema, {
    id: title,
    kind: ItemKind.EVENT,
    title,
    startsOn: time.on?.[0] ?? "",
    endsOn: time.on?.[1] ?? "",
    ...(time.at
      ? {
          startsAt: timestampFromMs(Date.parse(time.at[0])),
          endsAt: timestampFromMs(Date.parse(time.at[1])),
        }
      : {}),
  });
}

describe("upcomingEvents", () => {
  const now = new Date("2026-11-20T16:00:00-04:00");

  it("lists the events that haven't ended, soonest first, by title when they start together", () => {
    const items = [
      event("Dinner", { at: ["2026-11-20T19:00:00-04:00", "2026-11-20T21:00:00-04:00"] }),
      event("Lunch", { at: ["2026-11-20T12:00:00-04:00", "2026-11-20T13:00:00-04:00"] }),
      event("Holiday", { on: ["2026-11-20", "2026-11-22"] }),
      event("Bins", { on: ["2026-11-19", "2026-11-19"] }),
      event("Breakfast", { at: ["2026-11-21T08:00:00-04:00", "2026-11-21T09:00:00-04:00"] }),
      event("Away", { on: ["2026-11-20", "2026-11-20"] }),
      create(ItemSchema, { id: "task", kind: ItemKind.TASK, title: "A task" }),
    ];

    expect(upcomingEvents(items, now).map(({ title }) => title)).toEqual([
      "Away",
      "Holiday",
      "Dinner",
      "Breakfast",
    ]);
  });
});

describe("describeEventTime", () => {
  it("says the day of an all-day event, or its first and last days", () => {
    const one = timeOf(event("Away", { on: ["2026-11-20", "2026-11-20"] }));
    const more = timeOf(event("Holiday", { on: ["2026-11-20", "2026-11-22"] }));

    expect(one && describeEventTime(one, "en-US")).toBe("Friday, November 20, 2026, all day");
    expect(more && describeEventTime(more, "en-US")).toBe(
      "Friday, November 20, 2026 – Sunday, November 22, 2026, all day",
    );
  });

  it("says the times an event starts and ends in the device's time zone", () => {
    const evening = timeOf(
      event("Dinner", { at: ["2026-11-20T23:00:00Z", "2026-11-21T01:00:00Z"] }),
    );
    const overnight = timeOf(
      event("Party", { at: ["2026-11-21T02:00:00Z", "2026-11-21T06:00:00Z"] }),
    );

    expect(evening && describeEventTime(evening, "en-US")).toBe(
      "Friday, November 20, 2026, 7:00 PM – 9:00 PM",
    );
    expect(overnight && describeEventTime(overnight, "en-US")).toBe(
      "Friday, November 20, 2026, 10:00 PM – Saturday, November 21, 2026, 2:00 AM",
    );
  });
});

describe("the editor's fields", () => {
  it("start a new event today, from 9:00 to 10:00", () => {
    expect(newEventDraft("2026-11-20")).toEqual({
      allDay: false,
      startsOn: "2026-11-20",
      endsOn: "2026-11-20",
      startTime: "09:00",
      endTime: "10:00",
    });
  });

  it("show an event's times in the device's time zone, and read them back", () => {
    const time = timeOf(event("Dinner", { at: ["2026-11-20T23:00:00Z", "2026-11-21T01:00:00Z"] }));
    if (!time) throw new Error("Not an event");

    const draft = draftOf(time);

    expect(draft).toEqual({
      allDay: false,
      startsOn: "2026-11-20",
      endsOn: "2026-11-20",
      startTime: "19:00",
      endTime: "21:00",
    });
    expect(timeFromDraft(draft)).toEqual(time);
  });

  it("read an all-day event's days, leaving out its times", () => {
    const draft = { ...newEventDraft("2026-11-20"), allDay: true, endsOn: "2026-11-22" };

    expect(timeFromDraft(draft)).toEqual({
      allDay: true,
      startsOn: "2026-11-20",
      endsOn: "2026-11-22",
    });
  });

  it("say why they don't make a time an event can happen at", () => {
    const draft = newEventDraft("2026-11-20");

    expect(timeFromDraft({ ...draft, startsOn: "20/11/2026" })).toEqual({
      problem: "Days are dates, as in 2026-11-17.",
    });
    expect(timeFromDraft({ ...draft, startTime: "7pm" })).toEqual({
      problem: "Times are as in 19:00.",
    });
    expect(timeFromDraft({ ...draft, startTime: "11:00" })).toEqual({
      problem: "An event can't end before it starts.",
    });
  });
});

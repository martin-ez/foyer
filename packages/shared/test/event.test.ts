import { dayIn, eventDate, eventTimeFields, readEventTime, sameEventTime } from "@foyer/shared";
import { describe, expect, it } from "vitest";

const at = (iso: string) => Date.parse(iso);

describe("readEventTime", () => {
  it("reads an all-day event's first and last days", () => {
    const fields = { startsOn: "2026-11-20", endsOn: "2026-11-22", startsAt: null, endsAt: null };
    expect(readEventTime(fields)).toEqual({
      allDay: true,
      startsOn: "2026-11-20",
      endsOn: "2026-11-22",
    });
  });

  it("reads an event's times", () => {
    const startsAt = at("2026-11-20T18:00:00Z");
    const endsAt = at("2026-11-20T19:30:00Z");
    expect(readEventTime({ startsOn: "", endsOn: "", startsAt, endsAt })).toEqual({
      allDay: false,
      startsAt,
      endsAt,
    });
  });

  it("allows an event that ends as it starts", () => {
    const moment = at("2026-11-20T18:00:00Z");
    const time = { startsOn: "", endsOn: "", startsAt: moment, endsAt: moment };
    expect(readEventTime(time)).not.toHaveProperty("problem");
    const day = { startsOn: "2026-11-20", endsOn: "2026-11-20", startsAt: null, endsAt: null };
    expect(readEventTime(day)).not.toHaveProperty("problem");
  });

  it("refuses neither pair, both pairs, or half of one", () => {
    const moment = at("2026-11-20T18:00:00Z");
    for (const fields of [
      { startsOn: "", endsOn: "", startsAt: null, endsAt: null },
      { startsOn: "2026-11-20", endsOn: "2026-11-20", startsAt: moment, endsAt: moment },
      { startsOn: "2026-11-20", endsOn: "", startsAt: null, endsAt: null },
      { startsOn: "", endsOn: "", startsAt: moment, endsAt: null },
    ]) {
      expect(readEventTime(fields)).toHaveProperty("problem");
    }
  });

  it("refuses days that aren't dates", () => {
    const fields = { startsOn: "2026-11-31", endsOn: "2026-12-01", startsAt: null, endsAt: null };
    expect(readEventTime(fields)).toHaveProperty("problem");
  });

  it("refuses an event that ends before it starts", () => {
    const days = { startsOn: "2026-11-21", endsOn: "2026-11-20", startsAt: null, endsAt: null };
    expect(readEventTime(days)).toEqual({ problem: "An event can't end before it starts." });
    const startsAt = at("2026-11-20T18:00:00Z");
    const times = { startsOn: "", endsOn: "", startsAt, endsAt: startsAt - 1 };
    expect(readEventTime(times)).toEqual({ problem: "An event can't end before it starts." });
  });
});

describe("eventTimeFields", () => {
  it("gives back the fields a time was read from", () => {
    const days = { startsOn: "2026-11-20", endsOn: "2026-11-22", startsAt: null, endsAt: null };
    const time = readEventTime(days);
    if ("problem" in time) throw new Error(time.problem);
    expect(eventTimeFields(time)).toEqual(days);
  });
});

describe("sameEventTime", () => {
  it("tells apart all-day events and events with times", () => {
    const day = { allDay: true, startsOn: "2026-11-20", endsOn: "2026-11-20" } as const;
    const moment = at("2026-11-20T00:00:00Z");
    const times = { allDay: false, startsAt: moment, endsAt: moment } as const;
    expect(sameEventTime(day, { ...day })).toBe(true);
    expect(sameEventTime(times, { ...times })).toBe(true);
    expect(sameEventTime(day, times)).toBe(false);
    expect(sameEventTime(times, { ...times, endsAt: moment + 1 })).toBe(false);
  });
});

describe("eventDate", () => {
  it("is an all-day event's first day", () => {
    const time = { allDay: true, startsOn: "2026-11-20", endsOn: "2026-11-22" } as const;
    expect(eventDate(time, "Pacific/Auckland")).toBe("2026-11-20");
  });

  it("is the day an event starts in its calendar's time zone", () => {
    const startsAt = at("2026-11-20T23:30:00-04:00");
    const time = { allDay: false, startsAt, endsAt: startsAt } as const;
    expect(eventDate(time, "America/Santo_Domingo")).toBe("2026-11-20");
    expect(eventDate(time, "Europe/Madrid")).toBe("2026-11-21");
  });
});

describe("dayIn", () => {
  it("counts a time zone it doesn't know as UTC", () => {
    expect(dayIn(at("2026-11-20T23:30:00Z"), "Nowhere/Special")).toBe("2026-11-20");
  });
});

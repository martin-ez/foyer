import { afterEach, describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  daysIn,
  describeDay,
  describeMonth,
  describeWeek,
  localToday,
  monthOf,
  weekdayOf,
} from "../src/page/calendar-date";

describe("localToday", () => {
  const zone = process.env.TZ;
  afterEach(() => {
    process.env.TZ = zone;
  });

  it("gives the device's date, by its own clock and time zone", () => {
    expect(localToday(new Date(2026, 10, 17, 23, 59))).toBe("2026-11-17");
    expect(localToday(new Date(2026, 0, 5, 0, 1))).toBe("2026-01-05");
  });

  it("gives devices in different time zones their own date for the same moment", () => {
    const moment = new Date(Date.UTC(2026, 10, 17, 12, 0));

    process.env.TZ = "Pacific/Auckland";
    expect(localToday(moment)).toBe("2026-11-18");
    process.env.TZ = "America/Los_Angeles";
    expect(localToday(moment)).toBe("2026-11-17");
  });
});

describe("addDays", () => {
  it.each([
    ["2026-11-17", 1, "2026-11-18"],
    ["2026-11-30", 1, "2026-12-01"],
    ["2026-12-31", 1, "2027-01-01"],
    ["2026-01-01", -1, "2025-12-31"],
    ["2028-02-28", 1, "2028-02-29"],
    ["2026-03-29", 1, "2026-03-30"],
  ])("moves %s by %i days to %s", (date, days, moved) => {
    expect(addDays(date, days)).toBe(moved);
  });
});

describe("describeDay", () => {
  it("names the day as people read it", () => {
    expect(describeDay("2026-11-17", "en-US")).toBe("Tuesday, November 17, 2026");
  });
});

describe("monthOf", () => {
  it("gives the month a day falls in", () => {
    expect(monthOf("2026-11-17")).toBe("2026-11");
  });
});

describe("addMonths", () => {
  it.each([
    ["2026-11-17", 1, "2026-12-17"],
    ["2026-12-17", 1, "2027-01-17"],
    ["2026-01-17", -1, "2025-12-17"],
    ["2026-01-31", 1, "2026-02-28"],
    ["2028-01-31", 1, "2028-02-29"],
    ["2026-03-31", -1, "2026-02-28"],
    ["2026-11-17", 12, "2027-11-17"],
  ])("moves %s by %i months to %s", (date, months, moved) => {
    expect(addMonths(date, months)).toBe(moved);
  });
});

describe("daysIn", () => {
  it.each([
    ["2026-11", 30],
    ["2026-12", 31],
    ["2026-02", 28],
    ["2028-02", 29],
  ])("counts the days of %s", (month, days) => {
    expect(daysIn(month)).toBe(days);
  });
});

describe("describeMonth", () => {
  it("names the month as people read it", () => {
    expect(describeMonth("2026-11", "en-US")).toBe("November 2026");
  });
});

describe("describeWeek", () => {
  it("names the week from its Monday to its Sunday", () => {
    expect(describeWeek("2026-11-16", "en-US")).toBe("November 16, 2026 – November 22, 2026");
    expect(describeWeek("2026-12-28", "en-US")).toBe("December 28, 2026 – January 3, 2027");
  });
});

describe("weekdayOf", () => {
  it("names a day's weekday", () => {
    expect(weekdayOf("2026-11-16", "en-US")).toBe("Monday");
    expect(weekdayOf("2026-11-22", "en-US")).toBe("Sunday");
  });
});

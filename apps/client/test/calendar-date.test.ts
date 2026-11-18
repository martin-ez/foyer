import { afterEach, describe, expect, it } from "vitest";
import {
  describeDay,
  describeMonth,
  describeWeek,
  localToday,
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

describe("describeDay", () => {
  it("names the day as people read it", () => {
    expect(describeDay("2026-11-17", "en-US")).toBe("Tuesday, November 17, 2026");
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

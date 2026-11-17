import { describe, expect, it } from "vitest";
import { addDays, describeDay, localToday } from "../src/page/calendar-date";

describe("localToday", () => {
  it("gives the device's date, by its own clock and time zone", () => {
    expect(localToday(new Date(2026, 10, 17, 23, 59))).toBe("2026-11-17");
    expect(localToday(new Date(2026, 0, 5, 0, 1))).toBe("2026-01-05");
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

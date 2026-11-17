import {
  a2Landscape,
  a4Portrait,
  dayPageId,
  firstDayOfWeek,
  isIsoDate,
  isIsoMonth,
  isWeekStart,
  itemPageId,
  monthPageId,
  pageSizeFor,
  spacePageId,
  weekPageId,
} from "@foyer/shared";
import { describe, expect, it } from "vitest";

describe("page sizes", () => {
  it("measures A4 portrait and A2 landscape in points", () => {
    expect(a4Portrait).toEqual({ width: 595.28, height: 841.89 });
    expect(a2Landscape).toEqual({ width: 1683.78, height: 1190.55 });
  });

  it("makes month and week pages A2 landscape, and every other page A4 portrait", () => {
    expect(pageSizeFor("month")).toEqual(a2Landscape);
    expect(pageSizeFor("week")).toEqual(a2Landscape);
    expect(pageSizeFor("day")).toEqual(a4Portrait);
    expect(pageSizeFor("space")).toEqual(a4Portrait);
    expect(pageSizeFor("item")).toEqual(a4Portrait);
  });
});

describe("page ids", () => {
  it("names calendar pages by their kind and date", () => {
    expect(monthPageId("2026-11")).toBe("month:2026-11");
    expect(weekPageId("2026-11-16")).toBe("week:2026-11-16");
    expect(dayPageId("2026-11-14")).toBe("day:2026-11-14");
  });

  it("names space pages by their space and number", () => {
    const spaceId = "019a8f4e-5c00-7a3b-8c4d-1e2f3a4b5c6d";

    expect(spacePageId(spaceId, 2)).toBe(`space:${spaceId}:2`);
  });

  it("names a body page by its item", () => {
    const itemId = "019a8f4e-5c00-7a3b-8c4d-1e2f3a4b5c6d";

    expect(itemPageId(itemId)).toBe(`item:${itemId}`);
  });
});

describe("isIsoDate", () => {
  it.each(["2026-11-14", "2028-02-29", "0001-01-01"])("accepts %s", (date) => {
    expect(isIsoDate(date)).toBe(true);
  });

  it.each([
    ["a day that doesn't exist", "2026-02-29"],
    ["a month that doesn't exist", "2026-13-01"],
    ["a day 0", "2026-11-00"],
    ["a date without leading zeros", "2026-1-5"],
    ["a date and time", "2026-11-14T10:00"],
    ["a month", "2026-11"],
    ["nothing", ""],
  ])("refuses %s", (_, date) => {
    expect(isIsoDate(date)).toBe(false);
  });
});

describe("isIsoMonth", () => {
  it("accepts a month", () => {
    expect(isIsoMonth("2026-11")).toBe(true);
  });

  it.each(["2026-13", "2026-00", "2026-1", "2026-11-01"])("refuses %s", (month) => {
    expect(isIsoMonth(month)).toBe(false);
  });
});

describe("firstDayOfWeek", () => {
  it.each([
    ["a Monday", "2026-11-16", "2026-11-16"],
    ["a Tuesday", "2026-11-17", "2026-11-16"],
    ["a Sunday", "2026-11-22", "2026-11-16"],
    ["a day whose week starts in the month before", "2026-12-02", "2026-11-30"],
    ["a day whose week starts in the year before", "2027-01-03", "2026-12-28"],
    ["a leap day", "2028-02-29", "2028-02-28"],
  ])("gives the Monday of %s", (_, date, monday) => {
    expect(firstDayOfWeek(date)).toBe(monday);
  });
});

describe("isWeekStart", () => {
  it("accepts a Monday", () => {
    expect(isWeekStart("2026-11-16")).toBe(true);
  });

  it.each(["2026-11-17", "2026-11-22", "2026-11", "2026-02-30"])("refuses %s", (value) => {
    expect(isWeekStart(value)).toBe(false);
  });
});

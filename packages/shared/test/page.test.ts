import {
  a2Landscape,
  a4Portrait,
  dayPageId,
  isIsoDate,
  isIsoMonth,
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
    expect(weekPageId("2026-11-09")).toBe("week:2026-11-09");
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

import { addDays, addMonths, daysBetween, daysIn, monthOf } from "@foyer/shared";
import { describe, expect, it } from "vitest";

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

describe("daysBetween", () => {
  it.each([
    ["2026-11-17", "2026-11-20", 3],
    ["2026-11-20", "2026-11-17", -3],
    ["2026-12-30", "2027-01-02", 3],
    ["2026-03-28", "2026-03-30", 2],
    ["2026-11-17", "2026-11-17", 0],
  ])("counts from %s to %s as %i days", (from, to, days) => {
    expect(daysBetween(from, to)).toBe(days);
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

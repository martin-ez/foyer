import { liveLimitLiftsAt } from "@foyer/shared";
import { describe, expect, it } from "vitest";

describe("the daily limit for positions", () => {
  it("lifts at the next midnight UTC", () => {
    expect(liveLimitLiftsAt(Date.UTC(2026, 10, 17, 9, 30))).toBe(Date.UTC(2026, 10, 18));
  });

  it("lifts a whole day later when reached at midnight UTC", () => {
    expect(liveLimitLiftsAt(Date.UTC(2026, 10, 17))).toBe(Date.UTC(2026, 10, 18));
  });

  it("lifts in the next month and year", () => {
    expect(liveLimitLiftsAt(Date.UTC(2026, 11, 31, 23, 59))).toBe(Date.UTC(2027, 0, 1));
  });
});

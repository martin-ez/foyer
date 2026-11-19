import { isTimeOfDay, minutesIntoDay, minutesOf, timeOfDay } from "@foyer/shared";
import { describe, expect, it } from "vitest";

describe("isTimeOfDay", () => {
  it("takes hours and minutes, as in 19:00", () => {
    for (const time of ["00:00", "07:05", "19:00", "23:59"]) expect(isTimeOfDay(time)).toBe(true);
  });

  it("refuses times that don't exist, seconds, zones and other shapes", () => {
    for (const time of ["24:00", "12:60", "7:00", "19:00:00", "19:00Z", "19h", ""]) {
      expect(isTimeOfDay(time)).toBe(false);
    }
  });
});

describe("minutesOf and timeOfDay", () => {
  it("turn a time of day into minutes after midnight and back", () => {
    expect(minutesOf("00:00")).toBe(0);
    expect(minutesOf("19:45")).toBe(19 * 60 + 45);
    expect(timeOfDay(19 * 60 + 45)).toBe("19:45");
    expect(timeOfDay(6 * 60)).toBe("06:00");
  });

  it("wraps round within a day", () => {
    expect(timeOfDay(24 * 60 + 30)).toBe("00:30");
    expect(timeOfDay(-30)).toBe("23:30");
  });
});

describe("minutesIntoDay", () => {
  const sevenPmInMadrid = Date.UTC(2026, 10, 17, 18, 0);

  it("counts from the day's midnight in a time zone", () => {
    expect(minutesIntoDay(sevenPmInMadrid, "2026-11-17", "Europe/Madrid")).toBe(19 * 60);
    expect(minutesIntoDay(sevenPmInMadrid, "2026-11-17", "UTC")).toBe(18 * 60);
  });

  it("goes past a day for a moment on the next day, and below zero for one on the day before", () => {
    expect(minutesIntoDay(sevenPmInMadrid, "2026-11-16", "Europe/Madrid")).toBe(24 * 60 + 19 * 60);
    expect(minutesIntoDay(sevenPmInMadrid, "2026-11-18", "Europe/Madrid")).toBe(19 * 60 - 24 * 60);
  });

  it("counts a time zone it doesn't know as UTC", () => {
    expect(minutesIntoDay(sevenPmInMadrid, "2026-11-17", "Nowhere/Else")).toBe(18 * 60);
  });
});

import { describe, expect, it } from "vitest";
import { calendarPage, stepCalendar } from "../src/calendar/calendar-view";

describe("calendarPage", () => {
  it("shows the month, week or day a view's day falls in", () => {
    expect(calendarPage({ span: "month", date: "2026-11-17" })).toEqual({
      kind: "month",
      month: "2026-11",
    });
    expect(calendarPage({ span: "week", date: "2026-11-17" })).toEqual({
      kind: "week",
      monday: "2026-11-16",
    });
    expect(calendarPage({ span: "day", date: "2026-11-17" })).toEqual({
      kind: "day",
      date: "2026-11-17",
    });
  });

  it.each([
    ["a Sunday", "2026-11-22", "2026-11-16"],
    ["a day whose week starts in the month before", "2026-12-02", "2026-11-30"],
    ["a day whose week starts in the year before", "2027-01-03", "2026-12-28"],
  ])("shows the week of %s on its Monday's page", (_, date, monday) => {
    expect(calendarPage({ span: "week", date })).toEqual({ kind: "week", monday });
  });
});

describe("stepCalendar", () => {
  it("moves a month's view by months, keeping the day of the month where it can", () => {
    expect(stepCalendar({ span: "month", date: "2026-11-17" }, 1)).toEqual({
      span: "month",
      date: "2026-12-17",
    });
    expect(stepCalendar({ span: "month", date: "2026-01-31" }, 1)).toEqual({
      span: "month",
      date: "2026-02-28",
    });
  });

  it("moves a week's view by weeks, across months and years", () => {
    expect(stepCalendar({ span: "week", date: "2026-12-30" }, 1)).toEqual({
      span: "week",
      date: "2027-01-06",
    });
    expect(stepCalendar({ span: "week", date: "2026-11-17" }, -1)).toEqual({
      span: "week",
      date: "2026-11-10",
    });
  });

  it("moves a day's view by days", () => {
    expect(stepCalendar({ span: "day", date: "2026-11-30" }, 1)).toEqual({
      span: "day",
      date: "2026-12-01",
    });
  });
});

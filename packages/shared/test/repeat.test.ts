import {
  firstOccurrence,
  formatRepeat,
  nextDate,
  occurrenceAfter,
  parseRepeat,
  type RepeatRule,
  weekdayOn,
} from "@foyer/shared";
import { describe, expect, it } from "vitest";

function rule(text: string): RepeatRule {
  const parsed = parseRepeat(text);
  if (!parsed) throw new Error(`Foyer can't read ${text}`);
  return parsed;
}

function occurrences(text: string, start: string, count: number): string[] {
  const dates: string[] = [];
  let after = firstOccurrence(rule(text), start);
  while (after !== null && dates.length < count) {
    dates.push(after);
    after = occurrenceAfter(rule(text), start, after);
  }
  return dates;
}

describe("parseRepeat and formatRepeat", () => {
  it("reads every rule the picker writes, and writes it back the same way", () => {
    const rules = [
      "FREQ=DAILY",
      "FREQ=DAILY;INTERVAL=3",
      "FREQ=WEEKLY",
      "FREQ=WEEKLY;BYDAY=TU",
      "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR",
      "FREQ=MONTHLY",
      "FREQ=MONTHLY;BYMONTHDAY=15",
      "FREQ=MONTHLY;BYMONTHDAY=-1",
      "FREQ=MONTHLY;INTERVAL=3;BYDAY=2TU",
      "FREQ=MONTHLY;BYDAY=-1FR",
      "FREQ=YEARLY",
      "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29",
      "FREQ=YEARLY;INTERVAL=999;BYMONTH=11;BYMONTHDAY=17",
    ];
    for (const text of rules) expect(formatRepeat(rule(text))).toBe(text);
  });

  it("reads a rule's parts in any order and case, and writes them in one order", () => {
    expect(formatRepeat(rule("byday=FR,MO;interval=1;freq=weekly"))).toBe(
      "FREQ=WEEKLY;BYDAY=MO,FR",
    );
    expect(formatRepeat(rule("BYMONTHDAY=17;FREQ=YEARLY;BYMONTH=11"))).toBe(
      "FREQ=YEARLY;BYMONTH=11;BYMONTHDAY=17",
    );
  });

  it("describes each kind of rule", () => {
    expect(rule("FREQ=DAILY;INTERVAL=3")).toEqual({ frequency: "daily", interval: 3 });
    expect(rule("FREQ=WEEKLY;BYDAY=TU,TH")).toEqual({
      frequency: "weekly",
      interval: 1,
      days: ["TU", "TH"],
    });
    expect(rule("FREQ=MONTHLY;BYDAY=-1FR")).toEqual({
      frequency: "monthly",
      interval: 1,
      on: { weekday: "FR", nth: -1 },
    });
    expect(rule("FREQ=YEARLY")).toEqual({ frequency: "yearly", interval: 1, on: null });
  });

  it("refuses rules with parts Foyer doesn't take, or that don't make sense", () => {
    const refused = [
      "",
      "RRULE:FREQ=DAILY",
      "FREQ=HOURLY",
      "FREQ=DAILY;COUNT=3",
      "FREQ=DAILY;UNTIL=20261231",
      "FREQ=WEEKLY;WKST=SU",
      "FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1",
      "INTERVAL=2",
      "FREQ=DAILY;INTERVAL=0",
      "FREQ=DAILY;INTERVAL=1000",
      "FREQ=DAILY;INTERVAL=-1",
      "FREQ=DAILY;FREQ=DAILY",
      "FREQ=DAILY;",
      "FREQ=DAILY;BYDAY=",
      "FREQ=DAILY;BYDAY=MO",
      "FREQ=WEEKLY;BYDAY=",
      "FREQ=WEEKLY;BYDAY=TU,TU",
      "FREQ=WEEKLY;BYDAY=1TU",
      "FREQ=WEEKLY;BYMONTHDAY=",
      "FREQ=MONTHLY;BYMONTHDAY=0",
      "FREQ=MONTHLY;BYMONTHDAY=32",
      "FREQ=MONTHLY;BYMONTHDAY=1,15",
      "FREQ=MONTHLY;BYDAY=TU",
      "FREQ=MONTHLY;BYDAY=6TU",
      "FREQ=MONTHLY;BYDAY=2TU,4TU",
      "FREQ=MONTHLY;BYDAY=2TU;BYMONTHDAY=3",
      "FREQ=YEARLY;BYMONTH=11",
      "FREQ=YEARLY;BYMONTH=13;BYMONTHDAY=1",
      "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30",
      "FREQ=YEARLY;BYMONTH=4;BYMONTHDAY=31",
    ];
    for (const text of refused) expect(parseRepeat(text), text).toBeNull();
  });
});

describe("weekdayOn", () => {
  it("names the weekday a date falls on", () => {
    expect(weekdayOn("2026-11-16")).toBe("MO");
    expect(weekdayOn("2026-11-17")).toBe("TU");
    expect(weekdayOn("2026-11-22")).toBe("SU");
    expect(weekdayOn("1969-12-31")).toBe("WE");
  });
});

describe("the dates a rule falls on", () => {
  it("repeats daily, every N days from the day it starts", () => {
    expect(occurrences("FREQ=DAILY", "2026-12-30", 3)).toEqual([
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
    ]);
    expect(occurrences("FREQ=DAILY;INTERVAL=3", "2026-11-17", 3)).toEqual([
      "2026-11-17",
      "2026-11-20",
      "2026-11-23",
    ]);
  });

  it("repeats weekly on chosen days, every N weeks from the week it starts", () => {
    expect(occurrences("FREQ=WEEKLY;BYDAY=TU,TH", "2026-11-18", 4)).toEqual([
      "2026-11-19",
      "2026-11-24",
      "2026-11-26",
      "2026-12-01",
    ]);
    expect(occurrences("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,SU", "2026-11-17", 4)).toEqual([
      "2026-11-22",
      "2026-11-30",
      "2026-12-06",
      "2026-12-14",
    ]);
  });

  it("repeats weekly on the weekday it starts on when it names no days", () => {
    expect(occurrences("FREQ=WEEKLY;INTERVAL=3", "2026-11-17", 3)).toEqual([
      "2026-11-17",
      "2026-12-08",
      "2026-12-29",
    ]);
  });

  it("repeats monthly on a day of the month, skipping months without it", () => {
    expect(occurrences("FREQ=MONTHLY;BYMONTHDAY=31", "2026-11-17", 3)).toEqual([
      "2026-12-31",
      "2027-01-31",
      "2027-03-31",
    ]);
    expect(occurrences("FREQ=MONTHLY", "2027-01-31", 3)).toEqual([
      "2027-01-31",
      "2027-03-31",
      "2027-05-31",
    ]);
  });

  it("repeats monthly on a day counted from the month's end", () => {
    expect(occurrences("FREQ=MONTHLY;BYMONTHDAY=-1", "2027-01-15", 3)).toEqual([
      "2027-01-31",
      "2027-02-28",
      "2027-03-31",
    ]);
  });

  it("repeats monthly on a weekday's place in the month, such as the last Friday", () => {
    expect(occurrences("FREQ=MONTHLY;BYDAY=-1FR", "2026-11-17", 3)).toEqual([
      "2026-11-27",
      "2026-12-25",
      "2027-01-29",
    ]);
    expect(occurrences("FREQ=MONTHLY;BYDAY=2TU", "2026-11-17", 3)).toEqual([
      "2026-12-08",
      "2027-01-12",
      "2027-02-09",
    ]);
    expect(occurrences("FREQ=MONTHLY;BYDAY=5TU", "2026-11-17", 2)).toEqual([
      "2026-12-29",
      "2027-03-30",
    ]);
  });

  it("repeats every N months from the month it starts", () => {
    expect(occurrences("FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=1", "2026-11-17", 3)).toEqual([
      "2027-02-01",
      "2027-05-01",
      "2027-08-01",
    ]);
  });

  it("repeats yearly on a day and month, skipping years without it", () => {
    expect(occurrences("FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29", "2026-11-17", 2)).toEqual([
      "2028-02-29",
      "2032-02-29",
    ]);
    expect(occurrences("FREQ=YEARLY;INTERVAL=2", "2026-11-17", 2)).toEqual([
      "2026-11-17",
      "2028-11-17",
    ]);
  });

  it("finds a date far from where the rule starts without stepping through every one", () => {
    expect(occurrenceAfter(rule("FREQ=DAILY;INTERVAL=7"), "2026-11-17", "2126-11-17")).toBe(
      "2126-11-19",
    );
    expect(occurrenceAfter(rule("FREQ=MONTHLY;BYDAY=-1FR"), "2026-11-17", "2126-11-17")).toBe(
      "2126-11-29",
    );
  });

  it("finds nothing for a rule that never falls on a day", () => {
    expect(firstOccurrence(rule("FREQ=MONTHLY;INTERVAL=12;BYMONTHDAY=31"), "2026-11-17")).toBe(
      null,
    );
  });
});

describe("nextDate", () => {
  const bins = rule("FREQ=WEEKLY;BYDAY=TU");
  const plants = rule("FREQ=DAILY;INTERVAL=3");

  it("follows the schedule when ticked on the day", () => {
    expect(nextDate(bins, "schedule", "2026-11-17", "2026-11-17")).toBe("2026-11-24");
  });

  it("follows the schedule when ticked early, from the occurrence ticked", () => {
    expect(nextDate(bins, "schedule", "2026-11-24", "2026-11-20")).toBe("2026-12-01");
  });

  it("skips what was missed when an overdue task is ticked on its schedule", () => {
    expect(nextDate(bins, "schedule", "2026-11-03", "2026-11-17")).toBe("2026-11-24");
    expect(nextDate(bins, "schedule", "2026-11-03", "2026-11-18")).toBe("2026-11-24");
  });

  it("keeps the schedule's own weeks when it repeats every few weeks", () => {
    const fortnightly = rule("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU");
    expect(nextDate(fortnightly, "schedule", "2026-11-03", "2026-11-18")).toBe("2026-12-01");
  });

  it("counts from the day it's ticked when it repeats from completion", () => {
    expect(nextDate(plants, "completion", "2026-11-17", "2026-11-17")).toBe("2026-11-20");
    expect(nextDate(plants, "completion", "2026-11-10", "2026-11-17")).toBe("2026-11-20");
    expect(nextDate(plants, "completion", "2026-12-01", "2026-11-17")).toBe("2026-11-20");
  });

  it("never moves a task to the occurrence just ticked", () => {
    expect(nextDate(plants, "completion", "2026-11-20", "2026-11-17")).toBe("2026-11-23");
  });

  it("counts months from completion on the day it's ticked", () => {
    const monthly = rule("FREQ=MONTHLY");
    expect(nextDate(monthly, "completion", "2026-10-01", "2026-11-17")).toBe("2026-12-17");
  });
});

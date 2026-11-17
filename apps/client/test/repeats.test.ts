import { create } from "@bufbuild/protobuf";
import { ItemSchema, RepeatFrom } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import { describe, expect, it } from "vitest";
import {
  chooseFrequency,
  chooseFrom,
  currentOccurrence,
  describeMonthly,
  describeRepeat,
  firstDateOf,
  monthlyOptions,
  type RepeatChoice,
  repeatFromKind,
  repeatOf,
  repeatProblem,
  sameRepeat,
  tickOf,
} from "../src/tasks/repeats";

const never: RepeatChoice = { rule: null, from: "schedule" };
const tuesday = "2026-11-17";

describe("repeatOf", () => {
  it("reads how a task repeats", () => {
    const task = { repeat: "FREQ=DAILY;INTERVAL=3", repeatFrom: RepeatFrom.COMPLETION };

    expect(repeatOf(task)).toEqual({
      rule: { frequency: "daily", interval: 3 },
      from: "completion",
    });
    expect(repeatFromKind("completion")).toBe(RepeatFrom.COMPLETION);
    expect(repeatFromKind("schedule")).toBe(RepeatFrom.SCHEDULE);
  });

  it("counts a task without a rule, or with one the app can't read, as not repeating", () => {
    expect(repeatOf({ repeat: "", repeatFrom: RepeatFrom.UNSPECIFIED }).rule).toBeNull();
    expect(repeatOf({ repeat: "FREQ=HOURLY", repeatFrom: RepeatFrom.SCHEDULE }).rule).toBeNull();
  });
});

describe("sameRepeat", () => {
  it("compares rules and where their next dates come from", () => {
    const weekly = { frequency: "weekly" as const, interval: 1, days: ["TU" as const] };

    expect(sameRepeat({ rule: weekly, from: "schedule" }, { rule: weekly, from: "schedule" })).toBe(
      true,
    );
    expect(
      sameRepeat({ rule: weekly, from: "schedule" }, { rule: weekly, from: "completion" }),
    ).toBe(false);
    expect(sameRepeat(never, { rule: null, from: "completion" })).toBe(true);
    expect(sameRepeat(never, { rule: weekly, from: "schedule" })).toBe(false);
  });
});

describe("currentOccurrence and tickOf", () => {
  const task = (repeat: string, date: string, repeatFrom = RepeatFrom.SCHEDULE) =>
    create(ItemSchema, { repeat, date, repeatFrom });

  it("ticks a task that doesn't repeat with no occurrence and no next date", () => {
    expect(currentOccurrence(task("", tuesday))).toBe("");
    expect(tickOf(task("", tuesday), tuesday)).toEqual({ occurrence: "", nextDate: "" });
  });

  it("ticks a repeating task's date, and moves it to the rule's next date from today", () => {
    const bins = task("FREQ=WEEKLY;BYDAY=TU", "2026-11-03");

    expect(currentOccurrence(bins)).toBe("2026-11-03");
    expect(tickOf(bins, tuesday)).toEqual({ occurrence: "2026-11-03", nextDate: "2026-11-24" });
  });

  it("moves a task whose rule never falls on another day to the day after", () => {
    const never = task("FREQ=MONTHLY;INTERVAL=12;BYMONTHDAY=31", "2026-11-30");

    expect(tickOf(never, tuesday)).toEqual({ occurrence: "2026-11-30", nextDate: "2026-12-01" });
  });
});

describe("chooseFrequency and chooseFrom", () => {
  it("starts each rule on its schedule from the task's date", () => {
    expect(chooseFrequency(never, "daily", tuesday).rule).toEqual({
      frequency: "daily",
      interval: 1,
    });
    expect(chooseFrequency(never, "weekly", tuesday).rule).toEqual({
      frequency: "weekly",
      interval: 1,
      days: ["TU"],
    });
    expect(chooseFrequency(never, "monthly", tuesday).rule).toEqual({
      frequency: "monthly",
      interval: 1,
      on: { day: 17 },
    });
    expect(chooseFrequency(never, "yearly", tuesday).rule).toEqual({
      frequency: "yearly",
      interval: 1,
      on: { month: 11, day: 17 },
    });
    expect(chooseFrequency(chooseFrequency(never, "daily", tuesday), null, tuesday)).toEqual(never);
  });

  it("keeps the interval when the frequency changes", () => {
    const everyThreeDays = { rule: { frequency: "daily" as const, interval: 3 }, from: "schedule" };

    expect(chooseFrequency(everyThreeDays as RepeatChoice, "weekly", tuesday).rule?.interval).toBe(
      3,
    );
  });

  it("counts only the interval from completion, and picks days again on the schedule", () => {
    const weekly = chooseFrequency(never, "weekly", tuesday);
    const fromCompletion = chooseFrom(weekly, "completion", tuesday);

    expect(fromCompletion).toEqual({
      rule: { frequency: "weekly", interval: 1, days: [] },
      from: "completion",
    });
    expect(chooseFrom(fromCompletion, "schedule", tuesday)).toEqual(weekly);
    expect(chooseFrom(never, "completion", tuesday)).toEqual({ rule: null, from: "completion" });
  });
});

describe("monthlyOptions", () => {
  it("offers the day of the month and the weekday's place in it", () => {
    expect(monthlyOptions(tuesday)).toEqual([{ day: 17 }, { weekday: "TU", nth: 3 }]);
  });

  it("offers the last such weekday in the month's last week, and the last day on it", () => {
    expect(monthlyOptions("2026-11-27")).toEqual([
      { day: 27 },
      { weekday: "FR", nth: 4 },
      { weekday: "FR", nth: -1 },
    ]);
    expect(monthlyOptions("2026-11-30")).toEqual([
      { day: 30 },
      { weekday: "MO", nth: 5 },
      { weekday: "MO", nth: -1 },
      { day: -1 },
    ]);
  });
});

describe("firstDateOf", () => {
  it("finds the rule's first day from the task's date, or from today without one", () => {
    const fridays = chooseFrequency(never, "weekly", "2026-11-20");

    expect(firstDateOf(fridays, "2026-11-21", tuesday)).toBe("2026-11-27");
    expect(firstDateOf(fridays, "", tuesday)).toBe("2026-11-20");
    expect(firstDateOf(never, "", tuesday)).toBeNull();
  });
});

describe("repeatProblem", () => {
  const weekly = chooseFrequency(never, "weekly", tuesday);

  it("finds nothing wrong with a task that doesn't repeat, or a rule with a date", () => {
    expect(repeatProblem(never, "", tuesday)).toBeNull();
    expect(repeatProblem(weekly, tuesday, tuesday)).toBeNull();
  });

  it("asks for an interval from 1 to 999", () => {
    const rule = { frequency: "weekly" as const, interval: 0, days: ["TU" as const] };

    expect(repeatProblem({ rule, from: "schedule" }, tuesday, tuesday)).toBe(
      "A task repeats every 1 to 999 weeks.",
    );
  });

  it("asks for days of the week on a weekly schedule", () => {
    const rule = { frequency: "weekly" as const, interval: 1, days: [] };

    expect(repeatProblem({ rule, from: "schedule" }, tuesday, tuesday)).toBe(
      "Choose the days it repeats on.",
    );
    expect(repeatProblem({ rule, from: "completion" }, tuesday, tuesday)).toBeNull();
  });

  it("asks for a date, and for a rule that falls on a day", () => {
    const rule = { frequency: "monthly" as const, interval: 12, on: { day: 31 } };

    expect(repeatProblem(weekly, "", tuesday)).toBe("A repeating task always has a date.");
    expect(repeatProblem({ rule, from: "schedule" }, "2026-11-30", tuesday)).toBe(
      "This rule never falls on a day.",
    );
  });
});

describe("describeMonthly", () => {
  it("names a day of the month, or the last day", () => {
    expect(describeMonthly({ day: 17 })).toBe("on day 17");
    expect(describeMonthly({ day: -1 })).toBe("on the last day");
  });

  it("names a weekday's place in the month, from first to fifth, or the last", () => {
    expect(describeMonthly({ weekday: "MO", nth: 1 })).toBe("on the first Monday");
    expect(describeMonthly({ weekday: "SU", nth: 5 })).toBe("on the fifth Sunday");
    expect(describeMonthly({ weekday: "FR", nth: -1 })).toBe("on the last Friday");
  });
});

describe("describeRepeat", () => {
  it("says how a task repeats in words", () => {
    const rules: [RepeatChoice, string][] = [
      [never, "Doesn't repeat"],
      [{ rule: { frequency: "daily", interval: 1 }, from: "schedule" }, "Every day"],
      [
        { rule: { frequency: "daily", interval: 3 }, from: "completion" },
        "Every 3 days after it's done",
      ],
      [
        { rule: { frequency: "weekly", interval: 1, days: ["TU"] }, from: "schedule" },
        "Every week on Tuesday",
      ],
      [
        { rule: { frequency: "weekly", interval: 2, days: ["MO", "WE", "FR"] }, from: "schedule" },
        "Every 2 weeks on Monday, Wednesday and Friday",
      ],
      [
        { rule: { frequency: "monthly", interval: 1, on: { day: 17 } }, from: "schedule" },
        "Every month on day 17",
      ],
      [
        { rule: { frequency: "monthly", interval: 1, on: { day: -1 } }, from: "schedule" },
        "Every month on the last day",
      ],
      [
        {
          rule: { frequency: "monthly", interval: 3, on: { weekday: "FR", nth: -1 } },
          from: "schedule",
        },
        "Every 3 months on the last Friday",
      ],
      [
        {
          rule: { frequency: "monthly", interval: 1, on: { weekday: "TU", nth: 2 } },
          from: "schedule",
        },
        "Every month on the second Tuesday",
      ],
      [
        {
          rule: { frequency: "yearly", interval: 1, on: { month: 11, day: 17 } },
          from: "schedule",
        },
        "Every year on November 17",
      ],
      [
        { rule: { frequency: "yearly", interval: 1, on: null }, from: "completion" },
        "Every year after it's done",
      ],
    ];

    for (const [choice, words] of rules) expect(describeRepeat(choice)).toBe(words);
  });
});

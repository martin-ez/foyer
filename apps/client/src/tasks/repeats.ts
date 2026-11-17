import {
  firstOccurrence,
  formatRepeat,
  type MonthlyOn,
  nextDate,
  parseRepeat,
  type RepeatFrom,
  type RepeatRule,
  repeatIntervalLimit,
  type Weekday,
  weekdayOn,
} from "@foyer/shared";
import { type Item, RepeatFrom as RepeatFromKind } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import { addDays, daysIn, monthOf } from "../page/calendar-date";

/** How a task repeats, as the picker holds it: a rule, or none, and where its next date comes
 *  from. */
export type RepeatChoice = { rule: RepeatRule | null; from: RepeatFrom };

/** How often a rule repeats. */
export type Frequency = RepeatRule["frequency"];

/** How a task repeats now. A rule the app can't read counts as none. */
export function repeatOf(task: Pick<Item, "repeat" | "repeatFrom">): RepeatChoice {
  const rule = task.repeat === "" ? null : parseRepeat(task.repeat);
  return { rule, from: task.repeatFrom === RepeatFromKind.COMPLETION ? "completion" : "schedule" };
}

/** Where a next date comes from, as the contracts name it. */
export function repeatFromKind(from: RepeatFrom): RepeatFromKind {
  return from === "completion" ? RepeatFromKind.COMPLETION : RepeatFromKind.SCHEDULE;
}

/** Whether two choices repeat a task the same way. Without a rule, where its next date would come
 *  from doesn't matter. */
export function sameRepeat(a: RepeatChoice, b: RepeatChoice): boolean {
  if (!a.rule || !b.rule) return !a.rule && !b.rule;
  return a.from === b.from && formatRepeat(a.rule) === formatRepeat(b.rule);
}

/** The occurrence a task's completion must name for the task to be done: a repeating task's
 *  date, and none for a task that doesn't repeat. */
export function currentOccurrence(task: Pick<Item, "repeat" | "date">): string {
  return task.repeat === "" ? "" : task.date;
}

/** What ticking a task on `today` names: the occurrence it ticks and the task's next date, both
 *  empty for a task that doesn't repeat. A rule that never falls on another day moves the task to
 *  the day after the occurrence, or after today when that's later. */
export function tickOf(
  task: Pick<Item, "repeat" | "repeatFrom" | "date">,
  today: string,
): { occurrence: string; nextDate: string } {
  const { rule, from } = repeatOf(task);
  if (task.repeat === "") return { occurrence: "", nextDate: "" };
  const occurrence = task.date === "" ? today : task.date;
  const next = rule ? nextDate(rule, from, occurrence, today) : null;
  return { occurrence, nextDate: next ?? addDays(occurrence > today ? occurrence : today, 1) };
}

/** The rule the picker starts from when someone chooses how often a task repeats, from the
 *  task's date: on its weekday, its day of the month, or its day and month. Repeating from
 *  completion, a rule counts only days, weeks, months or years. */
export function chooseFrequency(
  choice: RepeatChoice,
  frequency: Frequency | null,
  date: string,
): RepeatChoice {
  if (frequency === null) return { ...choice, rule: null };
  const interval = choice.rule?.interval ?? 1;
  return { ...choice, rule: defaultRule(frequency, interval, choice.from, date) };
}

/** The choice with its next date coming from `from` instead, keeping how often it repeats. */
export function chooseFrom(choice: RepeatChoice, from: RepeatFrom, date: string): RepeatChoice {
  if (!choice.rule) return { ...choice, from };
  return { from, rule: defaultRule(choice.rule.frequency, choice.rule.interval, from, date) };
}

function defaultRule(
  frequency: Frequency,
  interval: number,
  from: RepeatFrom,
  date: string,
): RepeatRule {
  const fromCompletion = from === "completion";
  const [, month = 1, day = 1] = date.split("-").map(Number);
  switch (frequency) {
    case "daily":
      return { frequency, interval };
    case "weekly":
      return { frequency, interval, days: fromCompletion ? [] : [weekdayOn(date)] };
    case "monthly":
      return { frequency, interval, on: fromCompletion ? null : { day } };
    case "yearly":
      return { frequency, interval, on: fromCompletion ? null : { month, day } };
  }
}

/** The ways a monthly rule can fall on `date`: its day of the month, its weekday's place in the
 *  month, and, near the month's end, the last such weekday or the last day. */
export function monthlyOptions(date: string): MonthlyOn[] {
  const day = Number(date.slice(8, 10));
  const length = daysIn(monthOf(date));
  const weekday = weekdayOn(date);
  const options: MonthlyOn[] = [{ day }, { weekday, nth: Math.ceil(day / 7) }];
  if (day + 7 > length) options.push({ weekday, nth: -1 });
  if (day === length) options.push({ day: -1 });
  return options;
}

/** The first day a task repeating by `choice` falls on, from its date or, without one, from
 *  today, or null if it never falls on a day. */
export function firstDateOf(choice: RepeatChoice, date: string, today: string): string | null {
  return choice.rule ? firstOccurrence(choice.rule, date === "" ? today : date) : null;
}

/** Why a task can't repeat this way, as a sentence, or null if it can. */
export function repeatProblem(choice: RepeatChoice, date: string, today: string): string | null {
  const { rule } = choice;
  if (!rule) return null;
  if (
    !Number.isInteger(rule.interval) ||
    rule.interval < 1 ||
    rule.interval > repeatIntervalLimit
  ) {
    return `A task repeats every 1 to ${repeatIntervalLimit} ${units[rule.frequency]}.`;
  }
  if (rule.frequency === "weekly" && choice.from === "schedule" && rule.days.length === 0) {
    return "Choose the days it repeats on.";
  }
  if (date === "") return "A repeating task always has a date.";
  if (firstDateOf(choice, date, today) === null) return "This rule never falls on a day.";
  return null;
}

const units: Record<Frequency, string> = {
  daily: "days",
  weekly: "weeks",
  monthly: "months",
  yearly: "years",
};

const weekdayNames: Record<Weekday, string> = {
  MO: "Monday",
  TU: "Tuesday",
  WE: "Wednesday",
  TH: "Thursday",
  FR: "Friday",
  SA: "Saturday",
  SU: "Sunday",
};

/** A weekday's name, such as "Tuesday". */
export function weekdayName(day: Weekday): string {
  return weekdayNames[day];
}

/** Where a monthly rule falls, as people read it, such as "on day 17" or "on the last Friday". */
export function describeMonthly(on: MonthlyOn): string {
  if ("day" in on) return on.day === -1 ? "on the last day" : `on day ${on.day}`;
  const places = ["", "first", "second", "third", "fourth", "fifth"];
  const place = on.nth === -1 ? "last" : (places[on.nth] ?? `${on.nth}th`);
  return `on the ${place} ${weekdayNames[on.weekday]}`;
}

/** How a task repeats, as people read it, such as "Every week on Tuesday" or "Every 3 days after
 *  it's done". */
export function describeRepeat({ rule, from }: RepeatChoice): string {
  if (!rule) return "Doesn't repeat";
  const unit = units[rule.frequency].slice(0, -1);
  const every = rule.interval === 1 ? `Every ${unit}` : `Every ${rule.interval} ${unit}s`;
  if (from === "completion") return `${every} after it's done`;
  switch (rule.frequency) {
    case "daily":
      return every;
    case "weekly": {
      const days = rule.days.map((day) => weekdayNames[day]);
      const listed =
        days.length > 1 ? `${days.slice(0, -1).join(", ")} and ${days.at(-1)}` : days[0];
      return listed ? `${every} on ${listed}` : every;
    }
    case "monthly":
      return rule.on ? `${every} ${describeMonthly(rule.on)}` : every;
    case "yearly":
      return rule.on ? `${every} on ${monthNames[rule.on.month - 1]} ${rule.on.day}` : every;
  }
}

const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

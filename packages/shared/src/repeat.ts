/** A day of the week, as iCalendar names it. */
export type Weekday = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

/** The days of the week from Monday, the day weeks start on. */
export const weekdays: readonly Weekday[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

/** Which day of the month a monthly rule falls on: a day of the month, counted from its end when
 *  negative, or a weekday's place in the month, such as the second Tuesday, or the last Friday when
 *  `nth` is -1. */
export type MonthlyOn = { day: number } | { weekday: Weekday; nth: number };

/** A repeat rule Foyer understands, every `interval` days, weeks, months or years. A part left
 *  out comes from the date the rule starts from, as in iCalendar: a weekly rule with no days
 *  repeats on that date's weekday. */
export type RepeatRule =
  | { frequency: "daily"; interval: number }
  | { frequency: "weekly"; interval: number; days: Weekday[] }
  | { frequency: "monthly"; interval: number; on: MonthlyOn | null }
  | { frequency: "yearly"; interval: number; on: { month: number; day: number } | null };

/** Where a repeating task's next date comes from: its rule's own dates, or the day it's ticked. */
export type RepeatFrom = "schedule" | "completion";

/** The largest interval a rule can have, such as every 999 days. */
export const repeatIntervalLimit = 999;

/** A rule from an iCalendar RRULE such as "FREQ=WEEKLY;BYDAY=TU", or null when Foyer can't repeat
 *  by it: one with a part Foyer doesn't take, such as COUNT, or a day that never comes. */
export function parseRepeat(text: string): RepeatRule | null {
  const parts = new Map<string, string>();
  for (const part of text.toUpperCase().split(";")) {
    const [name, value, ...rest] = part.split("=");
    if (!name || value === undefined || rest.length > 0 || parts.has(name)) return null;
    parts.set(name, value);
  }
  const take = (name: string) => {
    const value = parts.get(name);
    parts.delete(name);
    return value;
  };
  const frequency = take("FREQ");
  const intervalText = take("INTERVAL") ?? "1";
  const interval = /^\d{1,3}$/.test(intervalText) ? Number(intervalText) : 0;
  if (interval < 1) return null;
  const byDay = take("BYDAY");
  const byMonthDay = take("BYMONTHDAY");
  const byMonth = take("BYMONTH");
  if (parts.size > 0) return null;

  switch (frequency) {
    case "DAILY":
      if ([byDay, byMonthDay, byMonth].some((part) => part !== undefined)) return null;
      return { frequency: "daily", interval };
    case "WEEKLY": {
      if (byMonthDay !== undefined || byMonth !== undefined) return null;
      if (byDay === undefined) return { frequency: "weekly", interval, days: [] };
      const days = byDay.split(",");
      if (!days.every(isWeekday) || new Set(days).size !== days.length) return null;
      return { frequency: "weekly", interval, days: weekdays.filter((day) => days.includes(day)) };
    }
    case "MONTHLY": {
      if (byMonth !== undefined || (byDay !== undefined && byMonthDay !== undefined)) return null;
      if (byMonthDay !== undefined) {
        const day = wholeNumber(byMonthDay);
        if (day === null || day === 0 || Math.abs(day) > 31) return null;
        return { frequency: "monthly", interval, on: { day } };
      }
      if (byDay !== undefined) {
        const match = /^([+-]?[1-5])(MO|TU|WE|TH|FR|SA|SU)$/.exec(byDay);
        if (!match) return null;
        const on = { weekday: match[2] as Weekday, nth: Number(match[1]) };
        return { frequency: "monthly", interval, on };
      }
      return { frequency: "monthly", interval, on: null };
    }
    case "YEARLY": {
      if (byDay !== undefined || (byMonth === undefined) !== (byMonthDay === undefined))
        return null;
      if (byMonth === undefined || byMonthDay === undefined) {
        return { frequency: "yearly", interval, on: null };
      }
      const month = wholeNumber(byMonth);
      const day = wholeNumber(byMonthDay);
      const leapYear = 2028;
      if (month === null || month < 1 || month > 12) return null;
      if (day === null || day < 1 || day > daysInMonth(leapYear, month)) return null;
      return { frequency: "yearly", interval, on: { month, day } };
    }
    default:
      return null;
  }
}

/** A rule as an iCalendar RRULE, such as "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH". The same rule is
 *  always written the same way. */
export function formatRepeat(rule: RepeatRule): string {
  const parts = [`FREQ=${rule.frequency.toUpperCase()}`];
  if (rule.interval !== 1) parts.push(`INTERVAL=${rule.interval}`);
  switch (rule.frequency) {
    case "daily":
      break;
    case "weekly":
      if (rule.days.length > 0) {
        parts.push(`BYDAY=${weekdays.filter((day) => rule.days.includes(day)).join(",")}`);
      }
      break;
    case "monthly":
      if (rule.on && "day" in rule.on) parts.push(`BYMONTHDAY=${rule.on.day}`);
      else if (rule.on) parts.push(`BYDAY=${rule.on.nth}${rule.on.weekday}`);
      break;
    case "yearly":
      if (rule.on) parts.push(`BYMONTH=${rule.on.month}`, `BYMONTHDAY=${rule.on.day}`);
      break;
  }
  return parts.join(";");
}

/** The weekday a day falls on, from the day as an ISO 8601 date such as "2026-11-17". */
export function weekdayOn(date: string): Weekday {
  return weekdays[weekdayIndex(epochDayOf(date))] as Weekday;
}

/** The first date on or after `from` that a rule starting there falls on, as an ISO 8601 date, or
 *  null if it never falls on a day. */
export function firstOccurrence(rule: RepeatRule, from: string): string | null {
  return occurrenceAfter(rule, from, dateOf(epochDayOf(from) - 1));
}

/** The first date after `after` that a rule starting from `start` falls on, as an ISO 8601 date,
 *  or null if it never does. Only dates on or after `start` count, and the interval counts from
 *  it: every 2 weeks means `start`'s week, then every other week from there. */
export function occurrenceAfter(rule: RepeatRule, start: string, after: string): string | null {
  const first = Math.max(epochDayOf(start), epochDayOf(after) + 1);
  const { interval } = rule;
  if (rule.frequency === "daily") {
    const anchor = epochDayOf(start);
    return dateOf(anchor + Math.ceil((first - anchor) / interval) * interval);
  }
  if (rule.frequency === "weekly") {
    const offsets = (rule.days.length > 0 ? rule.days : [weekdayOn(start)]).map((day) =>
      weekdays.indexOf(day),
    );
    const anchorMonday = mondayOf(epochDayOf(start));
    const weeksToFirst = (mondayOf(first) - anchorMonday) / 7;
    for (let week = Math.floor(weeksToFirst / interval) * interval; ; week += interval) {
      const day = offsets
        .map((offset) => anchorMonday + week * 7 + offset)
        .sort((a, b) => a - b)
        .find((each) => each >= first);
      if (day !== undefined) return dateOf(day);
    }
  }

  const [startYear, startMonth, startDay] = partsOf(start);
  const [firstYear, firstMonth] = partsOf(dateOf(first));
  const monthly = rule.frequency === "monthly";
  const unitsToFirst = monthly
    ? (firstYear - startYear) * 12 + firstMonth - startMonth
    : firstYear - startYear;
  const searchLimit = 1000;
  for (let unit = Math.max(0, Math.floor(unitsToFirst / interval)) * interval, tries = 0; ; ) {
    if (tries++ > searchLimit) return null;
    const day = monthly
      ? monthlyDay(rule.on, startYear, startMonth + unit, startDay)
      : yearlyDay(rule.on, startYear + unit, startMonth, startDay);
    if (day !== null && day >= first) return dateOf(day);
    unit += interval;
  }
}

/** A repeating task's next date once ticked, or null if its rule never falls on a day: on its
 *  schedule, the rule's first date after both the occurrence and `today`, skipping missed ones;
 *  from completion, its first date after `today` as if it began then, never the occurrence. */
export function nextDate(
  rule: RepeatRule,
  from: RepeatFrom,
  occurrence: string,
  today: string,
): string | null {
  if (from === "schedule") {
    return occurrenceAfter(rule, occurrence, today > occurrence ? today : occurrence);
  }
  const next = occurrenceAfter(rule, today, today);
  return next === occurrence ? occurrenceAfter(rule, today, occurrence) : next;
}

function isWeekday(value: string): value is Weekday {
  return (weekdays as readonly string[]).includes(value);
}

function wholeNumber(text: string): number | null {
  return /^[+-]?\d{1,2}$/.test(text) ? Number(text) : null;
}

function monthlyDay(
  on: MonthlyOn | null,
  year: number,
  monthFromYear: number,
  startDay: number,
): number | null {
  const y = year + Math.floor((monthFromYear - 1) / 12);
  const m = modulo(monthFromYear - 1, 12) + 1;
  const length = daysInMonth(y, m);
  if (on === null || "day" in on) {
    const wanted = on === null ? startDay : on.day;
    const day = wanted > 0 ? wanted : length + wanted + 1;
    return day >= 1 && day <= length ? epochDay(y, m, day) : null;
  }
  const firstOfMonth = epochDay(y, m, 1);
  const offset = weekdays.indexOf(on.weekday);
  const firstWeekday = firstOfMonth + modulo(offset - weekdayIndex(firstOfMonth), 7);
  const lastOfMonth = firstOfMonth + length - 1;
  const lastWeekday = lastOfMonth - modulo(weekdayIndex(lastOfMonth) - offset, 7);
  const day = on.nth > 0 ? firstWeekday + (on.nth - 1) * 7 : lastWeekday + (on.nth + 1) * 7;
  return day >= firstOfMonth && day <= lastOfMonth ? day : null;
}

function yearlyDay(
  on: { month: number; day: number } | null,
  year: number,
  startMonth: number,
  startDay: number,
): number | null {
  const month = on?.month ?? startMonth;
  const day = on?.day ?? startDay;
  return day <= daysInMonth(year, month) ? epochDay(year, month, day) : null;
}

function mondayOf(day: number): number {
  return day - weekdayIndex(day);
}

function weekdayIndex(epochDay: number): number {
  return modulo(epochDay + weekdays.indexOf("TH"), 7);
}

function modulo(value: number, by: number): number {
  return ((value % by) + by) % by;
}

function daysInMonth(year: number, month: number): number {
  return epochDay(year, month + 1, 1) - epochDay(year, month, 1);
}

function epochDay(year: number, month: number, day: number): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return Math.round(date.getTime() / 86_400_000);
}

function epochDayOf(date: string): number {
  return epochDay(...partsOf(date));
}

function partsOf(date: string): [number, number, number] {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  return [year, month, day];
}

function dateOf(day: number): string {
  const date = new Date(day * 86_400_000);
  const pad = (value: number, length: number) => String(value).padStart(length, "0");
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}`;
}

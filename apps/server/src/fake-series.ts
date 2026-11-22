import {
  addDays,
  dayIn,
  daysBetween,
  firstOccurrence,
  minutesIntoDay,
  occurrenceAfter,
  parseRepeat,
} from "@foyer/shared";

/** When an occurrence of a series starts and ends, and the part of its Google id that comes after
 *  the series' id: its first day, as "20261124", or the moment it starts, as "20261124T190000Z". */
export type FakeOccurrence = {
  start: { date?: string; dateTime?: string; timeZone?: string };
  end: { date?: string; dateTime?: string; timeZone?: string };
  suffix: string;
};

const mostOccurrences = 5000;

/** The occurrences of a fake series until `until`, in milliseconds since 1970, by one RRULE of what
 *  Foyer's repeating tasks take, with COUNT or UNTIL, or none for any other rule. One with times
 *  repeats at its time of day in its own time zone, or else in `timeZone`. */
export function fakeOccurrences(
  series: {
    recurrence?: string[];
    start: { date?: string; dateTime?: string; timeZone?: string };
    end: { date?: string; dateTime?: string; timeZone?: string };
  },
  timeZone: string,
  until: number,
): FakeOccurrence[] {
  const rule = readRule(series.recurrence ?? []);
  if (!rule) return [];
  const occurrences: FakeOccurrence[] = [];
  if (series.start.date) {
    const first = series.start.date;
    const length = daysBetween(first, series.end.date ?? addDays(first, 1));
    let date = firstOccurrence(rule.repeat, first);
    while (date !== null && occurrences.length < Math.min(rule.count, mostOccurrences)) {
      if (Date.parse(date) >= until || (rule.until !== null && Date.parse(date) > rule.until)) {
        break;
      }
      occurrences.push({
        start: { date },
        end: { date: addDays(date, length) },
        suffix: date.replaceAll("-", ""),
      });
      date = occurrenceAfter(rule.repeat, first, date);
    }
    return occurrences;
  }
  const zone = series.start.timeZone ?? timeZone;
  const startsAt = Date.parse(series.start.dateTime ?? "");
  const endsAt = Date.parse(series.end.dateTime ?? "");
  if (Number.isNaN(startsAt) || Number.isNaN(endsAt)) return [];
  const first = dayIn(startsAt, zone);
  const minutes = minutesIntoDay(startsAt, first, zone);
  let date = firstOccurrence(rule.repeat, first);
  while (date !== null && occurrences.length < Math.min(rule.count, mostOccurrences)) {
    const at = momentIn(date, minutes, zone);
    if (at >= until || (rule.until !== null && at > rule.until)) break;
    const start = new Date(at).toISOString().replace(".000Z", "Z");
    const end = new Date(at + endsAt - startsAt).toISOString().replace(".000Z", "Z");
    occurrences.push({
      start: { dateTime: start, timeZone: zone },
      end: { dateTime: end, timeZone: zone },
      suffix: start.replaceAll("-", "").replaceAll(":", ""),
    });
    date = occurrenceAfter(rule.repeat, first, date);
  }
  return occurrences;
}

function readRule(recurrence: string[]) {
  const line = recurrence.find((each) => each.toUpperCase().startsWith("RRULE:"));
  if (!line) return null;
  let count = Number.POSITIVE_INFINITY;
  let until: number | null = null;
  const parts = line
    .slice("RRULE:".length)
    .split(";")
    .filter((part) => {
      const [name = "", value = ""] = part.split("=");
      if (name.toUpperCase() === "COUNT") count = Number(value);
      else if (name.toUpperCase() === "UNTIL") until = untilOf(value);
      else return true;
      return false;
    });
  const repeat = parseRepeat(parts.join(";"));
  return repeat && { repeat, count, until };
}

function untilOf(value: string): number | null {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  if (match[4] === undefined) return Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, 23, 59, 59);
  return Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, hour, minute, second);
}

function momentIn(date: string, minutes: number, timeZone: string): number {
  let at = Date.parse(`${date}T00:00:00Z`) + minutes * 60_000;
  for (let step = 0; step < 3; step += 1) {
    const off = minutesIntoDay(at, date, timeZone) - minutes;
    if (off === 0) break;
    at -= off * 60_000;
  }
  return at;
}

import { daysBetween } from "./dates";

/** Whether a value is an ISO 8601 local time of hours and minutes, with no time zone, such as
 *  "19:00": the time of day a task can have. */
export function isTimeOfDay(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** How many minutes after midnight a time of day such as "19:00" is. */
export function minutesOf(time: string): number {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/** The time of day some minutes after midnight, such as "19:00", wrapping round within a day. */
export function timeOfDay(minutes: number): string {
  const within = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(within / 60))}:${pad(within % 60)}`;
}

/** How many minutes after the start of `date` a moment, in milliseconds since 1970, is in a time
 *  zone, an IANA name such as "Europe/Madrid": negative on a day before, and a day or more on a day
 *  after. A time zone that isn't known counts as UTC. */
export function minutesIntoDay(at: number, date: string, timeZone: string): number {
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat("en-US", { timeZone, ...momentParts });
  } catch {
    format = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...momentParts });
  }
  const parts = Object.fromEntries(
    format.formatToParts(at).map(({ type, value }) => [type, value]),
  );
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  return daysBetween(date, day) * 1440 + Number(parts.hour) * 60 + Number(parts.minute);
}

const momentParts = {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
} as const;

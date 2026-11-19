import { addDays, daysIn } from "./dates";
import { firstDayOfWeek, isIsoDate, isIsoMonth, type PageSize } from "./page";
import { timeOfDay } from "./time";

/** The size of a sticker on a calendar page, of any kind, in points: small enough that a few fit
 *  in a day of a month's page. */
export const calendarStickerSize: PageSize = { width: 200, height: 32 };

/** The space automatic placement leaves between a day's stickers, and around them in its box. */
export const calendarStickerGap = 6;

/** A rectangle on a page, in points from its top-left corner. */
export type Box = { x: number; y: number; width: number; height: number };

/** What's printed on a page's paper, such as a calendar's grid, in the page's own points: shaded
 *  boxes, with lines over them. */
export type Ruling = {
  shaded: readonly Box[];
  lines: readonly { from: { x: number; y: number }; to: { x: number; y: number } }[];
};

const margin = 48;
const weekdayRow = 40;
const weekHeading = 80;
const dayNumber = { width: 48, height: 40 };

/** A day on a calendar page, in its points: where its name or number is printed, if anywhere, the
 *  space that belongs to it, and the part of that space its stickers are placed in. */
export type DayOnPage = { date: string; label: Box | null; box: Box; stickers: Box };

/** What a calendar page prints, in its own points, and where each of its days is. */
export type CalendarLayout = {
  /** Where a month page names each weekday, Monday first, by one of its dates. Empty for a week
   *  page, which names each day in its label, and for a day page. */
  weekdays: { date: string; box: Box }[];
  days: DayOnPage[];
  /** Where height means time on a day page, below the strip for things with no time. Null on a
   *  month or week page. */
  timeline: Timeline | null;
  ruling: Ruling;
};

/** A day page's timeline, where a sticker's top edge is at its item's time, in the page's points.
 *  Times it doesn't show sit at its top or bottom. */
export type Timeline = {
  /** The part of the page it takes, below the strip that holds things without a time. */
  box: Box;
  /** Where stickers on it start across the page, right of the hours printed on it. */
  left: number;
  /** The earliest and latest times it shows, in minutes after midnight. */
  from: number;
  to: number;
  /** The heights of those times. */
  top: number;
  bottom: number;
  /** Each whole hour it shows, such as "06:00", at its height, with the box its name is printed in. */
  hours: { time: string; y: number; label: Box }[];
};

/** How many minutes apart the times are that a sticker snaps to on a day page's timeline. */
export const timelineStep = 15;

/** The height of a time on a timeline, in minutes after midnight, or of the nearest time it
 *  shows. */
export function heightOfTime(timeline: Timeline, minutes: number): number {
  const { from, to, top, bottom } = timeline;
  const shown = Math.min(Math.max(minutes, from), to);
  return top + ((shown - from) * (bottom - top)) / (to - from);
}

/** The time at a height on a timeline, in minutes after midnight, snapped to the nearest
 *  `timelineStep` minutes that it shows. */
export function timeAtHeight(timeline: Timeline, y: number): number {
  const { from, to, top, bottom } = timeline;
  const minutes = from + ((y - top) * (to - from)) / (bottom - top);
  const snapped = Math.round(minutes / timelineStep) * timelineStep;
  return Math.min(Math.max(snapped, from), to);
}

/** Whether a calendar sticker whose top-left corner is at `y` sits in a day page's strip, rather
 *  than on its timeline: whether its middle is above the timeline. */
export function inStrip(timeline: Timeline, y: number): boolean {
  return y + calendarStickerSize.height / 2 < timeline.box.y;
}

/** What kind of calendar page an id names, and its date: a month as "2026-11", a week by its
 *  Monday, or a day. Null for any other page. */
export function calendarPageOf(
  pageId: string,
): { kind: "month" | "week" | "day"; date: string } | null {
  const [kind = "", date = ""] = pageId.split(":");
  const named = kind === "month" ? isIsoMonth(date) : isIsoDate(date);
  if (pageId !== `${kind}:${date}` || !named) return null;
  if (kind === "week" && firstDayOfWeek(date) !== date) return null;
  return kind === "month" || kind === "week" || kind === "day" ? { kind, date } : null;
}

/** The layout of a calendar page from its id, at its size, or null for a page that isn't a
 *  calendar page. */
export function calendarLayout(pageId: string, page: PageSize): CalendarLayout | null {
  const calendar = calendarPageOf(pageId);
  if (!calendar) return null;
  switch (calendar.kind) {
    case "month":
      return monthLayout(calendar.date, page);
    case "week":
      return weekLayout(calendar.date, page);
    case "day":
      return dayLayout(calendar.date, page);
  }
}

/** A day's page: the whole page inside its margins belongs to the day, which the page's title
 *  names. At the top, a strip holds the stickers of things without a time, and below it a
 *  timeline runs from 6:00 to 23:00, with each hour printed beside a line across it. */
export function dayLayout(date: string, page: PageSize): CalendarLayout {
  const box = {
    x: margin,
    y: margin,
    width: page.width - 2 * margin,
    height: page.height - 2 * margin,
  };
  const row = calendarStickerSize.height + calendarStickerGap;
  const strip = { ...box, height: stripRows * row + calendarStickerGap };
  const below = strip.y + strip.height;
  const timeline: Timeline = {
    box: { ...box, y: below, height: box.y + box.height - below },
    left: box.x + hourColumn,
    from: timelineFrom,
    to: timelineTo,
    top: below + hourLabel.height,
    bottom: box.y + box.height - calendarStickerSize.height,
    hours: [],
  };
  for (let hour = timelineFrom; hour <= timelineTo; hour += 60) {
    const y = heightOfTime(timeline, hour);
    const label = { x: box.x, y: y - hourLabel.height / 2, ...hourLabel };
    timeline.hours.push({ time: timeOfDay(hour), y, label });
  }
  const right = box.x + box.width;
  return {
    weekdays: [],
    days: [{ date, label: null, box, stickers: strip }],
    timeline,
    ruling: {
      shaded: [],
      lines: [
        { from: { x: box.x, y: below }, to: { x: right, y: below } },
        ...timeline.hours.map(({ y }) => ({ from: { x: timeline.left, y }, to: { x: right, y } })),
      ],
    },
  };
}

const stripRows = 3;
const hourColumn = 56;
const hourLabel = { width: hourColumn - 8, height: 16 };
const timelineFrom = 6 * 60;
const timelineTo = 23 * 60;

/** A month's page, from the month as "2026-11": a column for each weekday from Monday, and a row
 *  for each week the month touches, with the days of the months around it left blank and shaded.
 *  A day's stickers go below its number. */
export function monthLayout(month: string, page: PageSize): CalendarLayout {
  const first = `${month}-01`;
  const monday = firstDayOfWeek(first);
  const offset = weekdayIndex(first);
  const count = daysIn(month);
  const rows = Math.ceil((offset + count) / 7);
  const top = margin + weekdayRow;
  const width = (page.width - 2 * margin) / 7;
  const height = (page.height - top - margin) / rows;
  const cell = (index: number): Box => ({
    x: margin + (index % 7) * width,
    y: top + Math.floor(index / 7) * height,
    width,
    height,
  });
  const cells = Array.from({ length: rows * 7 }, (_, index) => index);

  return {
    timeline: null,
    weekdays: Array.from({ length: 7 }, (_, column) => ({
      date: addDays(monday, column),
      box: { x: margin + column * width, y: margin, width, height: weekdayRow },
    })),
    days: Array.from({ length: count }, (_, day) => {
      const box = cell(offset + day);
      const stickers = {
        ...box,
        y: box.y + dayNumber.height,
        height: box.height - dayNumber.height,
      };
      return {
        date: addDays(first, day),
        label: { x: box.x, y: box.y, ...dayNumber },
        box,
        stickers,
      };
    }),
    ruling: {
      shaded: cells.filter((index) => index < offset || index >= offset + count).map(cell),
      lines: grid({ x: margin, y: top, width: 7 * width, height: rows * height }, 7, rows),
    },
  };
}

/** A week's page, named by its Monday: a column for each day, with the day's name and number
 *  above it, and its stickers below them. */
export function weekLayout(monday: string, page: PageSize): CalendarLayout {
  const width = (page.width - 2 * margin) / 7;
  const below = margin + weekHeading;
  const height = page.height - margin - below;
  const columns = { x: margin, y: margin, width: 7 * width, height: page.height - 2 * margin };

  return {
    weekdays: [],
    timeline: null,
    days: Array.from({ length: 7 }, (_, column) => {
      const x = margin + column * width;
      const box = { x, y: below, width, height };
      return {
        date: addDays(monday, column),
        label: { x, y: margin, width, height: weekHeading },
        box,
        stickers: box,
      };
    }),
    ruling: {
      shaded: [],
      lines: [
        ...grid(columns, 7, 1),
        { from: { x: margin, y: below }, to: { x: margin + 7 * width, y: below } },
      ],
    },
  };
}

function grid(area: Box, columns: number, rows: number): Ruling["lines"] {
  const { x, y, width, height } = area;
  return [
    ...Array.from({ length: rows + 1 }, (_, row) => {
      const at = y + (row * height) / rows;
      return { from: { x, y: at }, to: { x: x + width, y: at } };
    }),
    ...Array.from({ length: columns + 1 }, (_, column) => {
      const at = x + (column * width) / columns;
      return { from: { x: at, y }, to: { x: at, y: y + height } };
    }),
  ];
}

function weekdayIndex(date: string): number {
  const monday = firstDayOfWeek(date);
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index)).indexOf(date);
}

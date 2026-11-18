import { addDays, daysIn } from "./dates";
import { firstDayOfWeek, isIsoDate, isIsoMonth, type PageSize } from "./page";

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
  ruling: Ruling;
};

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
 *  names, so it prints nothing. */
export function dayLayout(date: string, page: PageSize): CalendarLayout {
  const box = {
    x: margin,
    y: margin,
    width: page.width - 2 * margin,
    height: page.height - 2 * margin,
  };
  return {
    weekdays: [],
    days: [{ date, label: null, box, stickers: box }],
    ruling: { shaded: [], lines: [] },
  };
}

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

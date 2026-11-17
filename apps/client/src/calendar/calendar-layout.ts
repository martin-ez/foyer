import { firstDayOfWeek, type PageSize } from "@foyer/shared";
import { addDays, daysIn } from "../page/calendar-date";
import type { Box, Ruling } from "../page/page-drawing";

const margin = 48;
const weekdayRow = 40;
const weekHeading = 80;
const dayNumber = { width: 48, height: 40 };

/** A day on a month or week page, in its points: where its name or number is printed, and the
 *  space for it below. */
export type DayOnPage = { date: string; label: Box; box: Box };

/** What a month or week page prints, in its own points. */
export type CalendarLayout = {
  /** Where a month page names each weekday, Monday first, by one of its dates. Empty for a week
   *  page, which names each day in its label. */
  weekdays: { date: string; box: Box }[];
  days: DayOnPage[];
  ruling: Ruling;
};

/** A month's page: a column for each weekday from Monday, and a row for each week the month
 *  touches, with the days of the months around it left blank and shaded. */
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
      return { date: addDays(first, day), label: { x: box.x, y: box.y, ...dayNumber }, box };
    }),
    ruling: {
      shaded: cells.filter((index) => index < offset || index >= offset + count).map(cell),
      lines: grid({ x: margin, y: top, width: 7 * width, height: rows * height }, 7, rows),
    },
  };
}

/** A week's page, named by its Monday: a column for each day, with the day's name and number
 *  above it. */
export function weekLayout(monday: string, page: PageSize): CalendarLayout {
  const width = (page.width - 2 * margin) / 7;
  const below = margin + weekHeading;
  const height = page.height - margin - below;
  const columns = { x: margin, y: margin, width: 7 * width, height: page.height - 2 * margin };

  return {
    weekdays: [],
    days: Array.from({ length: 7 }, (_, column) => {
      const x = margin + column * width;
      return {
        date: addDays(monday, column),
        label: { x, y: margin, width, height: weekHeading },
        box: { x, y: below, width, height },
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

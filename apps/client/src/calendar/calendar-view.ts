import { firstDayOfWeek } from "@foyer/shared";
import { addDays, addMonths, monthOf } from "../page/calendar-date";
import type { OpenPage } from "../page/open-page";

/** How much of the calendar one page shows. */
export type CalendarSpan = "month" | "week" | "day";

/** What the Calendar shows: the month, week or day page around a chosen day. Switching span keeps
 *  the day, so the week shown is the one the day falls in. */
export type CalendarView = { span: CalendarSpan; date: string };

/** The page a view shows: a week's page is named by the Monday the week starts on. */
export function calendarPage({ span, date }: CalendarView): OpenPage {
  switch (span) {
    case "month":
      return { kind: "month", month: monthOf(date) };
    case "week":
      return { kind: "week", monday: firstDayOfWeek(date) };
    case "day":
      return { kind: "day", date };
  }
}

/** The view `steps` months, weeks or days later, or earlier when `steps` is negative, by its span. */
export function stepCalendar({ span, date }: CalendarView, steps: number): CalendarView {
  switch (span) {
    case "month":
      return { span, date: addMonths(date, steps) };
    case "week":
      return { span, date: addDays(date, 7 * steps) };
    case "day":
      return { span, date: addDays(date, steps) };
  }
}

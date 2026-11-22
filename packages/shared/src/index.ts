export { calendarName } from "./calendar";
export {
  type Box,
  type CalendarLayout,
  calendarLayout,
  calendarPageOf,
  calendarStickerGap,
  calendarStickerSize,
  type DayOnPage,
  dayLayout,
  heightOfTime,
  inStrip,
  monthLayout,
  type Ruling,
  type Timeline,
  timeAtHeight,
  timelineStep,
  weekLayout,
} from "./calendar-layout";
export {
  afterPlan,
  type CalendarPageKind,
  type CalendarStickerPlan,
  calendarPageId,
  calendarPageKinds,
  dayAt,
  dropOnDayPage,
  keepInDay,
  type PlacedSticker,
  pileStep,
  planCalendarStickers,
  showsDay,
  spotAtTime,
  spotInDay,
  stickerSizeOn,
  timelineOf,
} from "./calendar-stickers";
export { addDays, addMonths, daysBetween, daysIn, monthOf } from "./dates";
export {
  dayIn,
  type EventTime,
  type EventTimeFields,
  eventDate,
  eventTimeFields,
  readEventTime,
  sameEventTime,
} from "./event";
export { isId, newId } from "./id";
export {
  itemDescriptionLimit,
  itemDescriptionProblem,
  itemTitleLimit,
  itemTitleProblem,
  limitItemDescription,
  limitItemTitle,
} from "./item";
export { liveLimitLiftsAt, pointsPerSecond } from "./live";
export {
  a2Landscape,
  a4Portrait,
  dayPageId,
  firstDayOfWeek,
  isIsoDate,
  isIsoMonth,
  isWeekStart,
  itemPageId,
  monthPageId,
  type PageKindName,
  type PageSize,
  pageSizeFor,
  spacePageId,
  weekPageId,
} from "./page";
export {
  firstOccurrence,
  formatRepeat,
  type MonthlyOn,
  nextDate,
  occurrenceAfter,
  parseRepeat,
  type RepeatFrom,
  type RepeatRule,
  repeatIntervalLimit,
  type Weekday,
  weekdayOn,
  weekdays,
} from "./repeat";
export {
  clashingName,
  freeSpaceName,
  limitSpaceName,
  spaceNameLimit,
  spaceNameProblem,
} from "./space-name";
export {
  type NewestSpacePage,
  nextStickerSpot,
  type PagePoint,
  pageMargin,
  type StickerKindName,
  type StickerOnPage,
  stickerGap,
  stickerSizeOf,
  stickerSpotInSpace,
  stickerSpotOnPage,
  taskStickerSize,
  unknownStickerSize,
} from "./sticker-spot";
export { signedOutCloseCode, syncPath } from "./sync";
export {
  mergeRuns,
  orderBetween,
  plainTextOf,
  readBlockMarkdown,
  type TextBlockContent,
  type TextBlockKind,
  type TextRun,
  textBlockLimit,
  textBlockProblem,
  textOrderLimit,
  textOrderProblem,
  writeBlockMarkdown,
} from "./text";
export { isTimeOfDay, minutesIntoDay, minutesOf, timeOfDay } from "./time";

/** The product name, shown by the app and reported by the backend. */
export const appName = "Foyer";

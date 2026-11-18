export { calendarName } from "./calendar";
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
  taskStickerSize,
  unknownStickerSize,
} from "./sticker-spot";
export { signedOutCloseCode, syncPath } from "./sync";

/** The product name, shown by the app and reported by the backend. */
export const appName = "Foyer";

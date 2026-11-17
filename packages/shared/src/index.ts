export { isId, newId } from "./id";
export { itemTitleLimit, itemTitleProblem, limitItemTitle } from "./item";
export { liveLimitLiftsAt, pointsPerSecond } from "./live";
export {
  a2Landscape,
  a4Portrait,
  dayPageId,
  isIsoDate,
  isIsoMonth,
  monthPageId,
  type PageKindName,
  type PageSize,
  pageSizeFor,
  spacePageId,
  weekPageId,
} from "./page";
export {
  clashingName,
  freeSpaceName,
  limitSpaceName,
  spaceNameLimit,
  spaceNameProblem,
} from "./space-name";
export { signedOutCloseCode, syncPath } from "./sync";

/** The product name, shown by the app and reported by the backend. */
export const appName = "Foyer";

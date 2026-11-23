import {
  addDays,
  dayPageId,
  firstDayOfWeek,
  monthOf,
  monthPageId,
  spacePageId,
  weekPageId,
} from "@foyer/shared";
import type { Page } from "@foyer/shared/gen/foyer/page/v1/page_pb";
import type { Space } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import { newestSpacePage } from "../page/sticker-layout";

/** How many of the pages opened most recently on a device it keeps the ink of. */
export const recentPagesKept = 30;

/** The pages whose ink a device keeps, to write on without a connection: this month's page, this
 *  week's and next week's pages and their days, the newest page of each space that isn't archived,
 *  and the pages opened most recently on the device. */
export function keptPages(known: {
  today: string;
  spaces: Iterable<Space>;
  pages: ReadonlyMap<string, Page>;
  /** When each page was last opened on the device, in milliseconds. */
  opened: ReadonlyMap<string, number>;
}): Set<string> {
  const kept = new Set([monthPageId(monthOf(known.today))]);
  const monday = firstDayOfWeek(known.today);
  for (const week of [monday, addDays(monday, 7)]) {
    kept.add(weekPageId(week));
    for (let day = 0; day < 7; day++) kept.add(dayPageId(addDays(week, day)));
  }
  for (const { id, archived } of known.spaces) {
    if (!archived) kept.add(spacePageId(id, newestSpacePage(id, known.pages)));
  }
  const recent = [...known.opened]
    .sort(([a, aAt], [b, bAt]) => bAt - aAt || a.localeCompare(b))
    .slice(0, recentPagesKept);
  for (const [pageId] of recent) kept.add(pageId);
  return kept;
}

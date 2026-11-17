import {
  dayPageId,
  itemPageId,
  monthPageId,
  type PageSize,
  pageSizeFor,
  spacePageId,
  weekPageId,
} from "@foyer/shared";
import type { Item } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import type { Page } from "@foyer/shared/gen/foyer/page/v1/page_pb";
import { type Space, SpaceKind } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import { describeDay, describeMonth, describeWeek } from "./calendar-date";

/** A page someone can open: a month, week or day of the household's calendar, one of a space's
 *  pages, or a task's body page. A week is named by its Monday. */
export type OpenPage =
  | { kind: "month"; month: string }
  | { kind: "week"; monday: string }
  | { kind: "day"; date: string }
  | { kind: "space"; spaceId: string; number: number }
  | { kind: "item"; itemId: string };

/** The id the household knows the page by. */
export function pageIdOf(page: OpenPage): string {
  switch (page.kind) {
    case "month":
      return monthPageId(page.month);
    case "week":
      return weekPageId(page.monday);
    case "day":
      return dayPageId(page.date);
    case "space":
      return spacePageId(page.spaceId, page.number);
    case "item":
      return itemPageId(page.itemId);
  }
}

/** The page's size: the one it was made with, when it has been made, or else the size a new page
 *  of its kind gets. */
export function sizeOf(page: OpenPage, made: ReadonlyMap<string, Page>): PageSize {
  const stored = made.get(pageIdOf(page));
  return stored ? { width: stored.width, height: stored.height } : pageSizeFor(page.kind);
}

/** What the page is, as people read it, such as "November 2026", "Tuesday, November 17, 2026",
 *  "Inbox, page 1", or a task's title for its body page. */
export function describePage(
  page: OpenPage,
  known: { spaces: readonly Space[]; items: ReadonlyMap<string, Item> },
  locale?: string,
): string {
  if (page.kind === "month") return describeMonth(page.month, locale);
  if (page.kind === "week") return describeWeek(page.monday, locale);
  if (page.kind === "day") return describeDay(page.date, locale);
  if (page.kind === "item") return known.items.get(page.itemId)?.title ?? "Task";
  const space = known.spaces.find(({ id }) => id === page.spaceId);
  const name = !space ? "Space" : space.kind === SpaceKind.INBOX ? "Inbox" : space.name;
  return `${name}, page ${page.number}`;
}

import { dayPageId, type PageSize, pageSizeFor, spacePageId } from "@foyer/shared";
import type { Page } from "@foyer/shared/gen/foyer/page/v1/page_pb";
import { type Space, SpaceKind } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import { describeDay } from "./calendar-date";

/** A page someone can open: a day of the household's calendar, or one of a space's pages. */
export type OpenPage =
  | { kind: "day"; date: string }
  | { kind: "space"; spaceId: string; number: number };

/** The id the household knows the page by. */
export function pageIdOf(page: OpenPage): string {
  return page.kind === "day" ? dayPageId(page.date) : spacePageId(page.spaceId, page.number);
}

/** The page's size: the one it was made with, when it has been made, or else the size a new page
 *  of its kind gets. */
export function sizeOf(page: OpenPage, made: ReadonlyMap<string, Page>): PageSize {
  const stored = made.get(pageIdOf(page));
  return stored ? { width: stored.width, height: stored.height } : pageSizeFor(page.kind);
}

/** What the page is, as people read it, such as "Tuesday, November 17, 2026" or "Inbox, page 1". */
export function describePage(page: OpenPage, spaces: Space[], locale?: string): string {
  if (page.kind === "day") return describeDay(page.date, locale);
  const space = spaces.find(({ id }) => id === page.spaceId);
  const name = !space ? "Space" : space.kind === SpaceKind.INBOX ? "Inbox" : space.name;
  return `${name}, page ${page.number}`;
}

import { isId, isIsoDate, isIsoMonth, type PageKindName, spacePageId } from "@foyer/shared";
import { type PageCreate, PageKind } from "@foyer/shared/gen/foyer/page/v1/page_pb";
import type { Applied, Setter } from "./changes";
import { nextSeq, type RowKey } from "./rows";
import { canSee } from "./spaces";

const pageKinds: Partial<Record<PageKind, PageKindName>> = {
  [PageKind.MONTH]: "month",
  [PageKind.WEEK]: "week",
  [PageKind.DAY]: "day",
  [PageKind.SPACE]: "space",
  [PageKind.ITEM]: "item",
};

/** Creates a page the member can see. Creating one that already exists has no effect, so devices
 *  that create the same calendar or space page offline end up writing on one page. */
export function createPage(
  sql: SqlStorage,
  memberId: string,
  setter: Setter,
  page: PageCreate,
): Applied {
  const kind = pageKinds[page.kind];
  if (!kind) return { refused: "A page must be a month, week, day, space or item page." };
  const problem = idProblem(kind, page);
  if (problem) return { refused: problem };
  if (!isSize(page.width) || !isSize(page.height)) {
    return { refused: "A page's width and height must be positive numbers of points." };
  }
  if (kind === "space" && !canSee(sql, memberId, page.spaceId)) {
    return { refused: "There's no such space." };
  }
  if (kind === "item") return { refused: "There's no such item." };

  const key: RowKey = { kind: "page", id: page.pageId };
  if (sql.exec("SELECT 1 FROM pages WHERE id = ?", page.pageId).toArray().length > 0) {
    return { seq: nextSeq(sql), changed: [], unchanged: [key] };
  }
  const seq = nextSeq(sql);
  sql.exec(
    `INSERT INTO pages (id, kind, space_id, number, width, height, created_by, created_at, seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    page.pageId,
    kind,
    kind === "space" ? page.spaceId : null,
    kind === "space" ? page.number : null,
    page.width,
    page.height,
    memberId,
    setter.at,
    seq,
  );
  return { seq, changed: [key], unchanged: [] };
}

/** Whether a member can see a page, from its id, whether or not anything has been put on it yet:
 *  every member sees the household's calendar pages, and only the members who see a space see its
 *  pages. Nobody sees an item's page until items exist. */
export function canSeePage(sql: SqlStorage, memberId: string, pageId: string): boolean {
  const [kind = "", ...rest] = pageId.split(":");
  const named = rest.join(":");
  switch (kind) {
    case "month":
      return isIsoMonth(named);
    case "week":
    case "day":
      return isIsoDate(named);
    case "space": {
      const [spaceId = "", number = ""] = rest;
      const numbered = Number(number);
      return (
        Number.isInteger(numbered) &&
        numbered >= 1 &&
        pageId === spacePageId(spaceId, numbered) &&
        isId(spaceId) &&
        canSee(sql, memberId, spaceId)
      );
    }
    default:
      return false;
  }
}

function idProblem(kind: PageKindName, page: PageCreate): string | null {
  const hasSpace = page.spaceId !== "" || page.number !== 0;
  if ((kind !== "space" && hasSpace) || (kind !== "item" && page.itemId !== "")) {
    return "Only space pages have a space and a number, and only item pages have an item.";
  }
  const namedBy = (isDate: (value: string) => boolean) =>
    page.pageId.startsWith(`${kind}:`) && isDate(page.pageId.slice(kind.length + 1));
  switch (kind) {
    case "month":
      return namedBy(isIsoMonth)
        ? null
        : "A month's page must be named by its month, as in “month:2026-11”.";
    case "week":
      return namedBy(isIsoDate)
        ? null
        : "A week's page must be named by its first day, as in “week:2026-11-09”.";
    case "day":
      return namedBy(isIsoDate)
        ? null
        : "A day's page must be named by its date, as in “day:2026-11-14”.";
    case "space":
      return isId(page.spaceId) &&
        page.number >= 1 &&
        page.pageId === spacePageId(page.spaceId, page.number)
        ? null
        : "A space's page must be named by its space and its number from 1, as in “space:<space id>:1”.";
    case "item":
      return isId(page.pageId) && isId(page.itemId)
        ? null
        : "An item's page and its item must each have a UUID version 7 as their id.";
  }
}

function isSize(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

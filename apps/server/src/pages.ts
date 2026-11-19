import {
  isId,
  isIsoDate,
  isIsoMonth,
  isWeekStart,
  itemPageId,
  type NewestSpacePage,
  type PageKindName,
  type StickerKindName,
  type StickerOnPage,
  spacePageId,
} from "@foyer/shared";
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
 *  that create the same calendar, space or body page offline end up writing on one page. Only a
 *  task's body page can be made for an item, and making one for a deleted task has no effect. */
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
  const key: RowKey = { kind: "page", id: page.pageId };
  if (kind === "item") {
    const item = itemOf(sql, page.itemId);
    if (item === "deleted") return { seq: nextSeq(sql), changed: [], unchanged: [key] };
    if (!item || !canSee(sql, memberId, item.space_id)) return { refused: "There's no such item." };
    if (item.kind !== "task") return { refused: "Only a task's body page can be made for now." };
  }
  if (sql.exec("SELECT 1 FROM pages WHERE id = ?", page.pageId).toArray().length > 0) {
    return { seq: nextSeq(sql), changed: [], unchanged: [key] };
  }
  const seq = nextSeq(sql);
  sql.exec(
    `INSERT INTO pages (id, kind, space_id, number, item_id, width, height, created_by, created_at,
       seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    page.pageId,
    kind,
    kind === "space" ? page.spaceId : null,
    kind === "space" ? page.number : null,
    kind === "item" ? page.itemId : null,
    page.width,
    page.height,
    memberId,
    setter.at,
    seq,
  );
  return { seq, changed: [key], unchanged: [] };
}

/** A space's newest page, with the stickers on it, or null when the space has no page yet. */
export function newestPageOf(sql: SqlStorage, spaceId: string): NewestSpacePage | null {
  const [page] = sql
    .exec<{ id: string; number: number; width: number; height: number }>(
      `SELECT id, number, width, height FROM pages WHERE kind = 'space' AND space_id = ?
       ORDER BY number DESC LIMIT 1`,
      spaceId,
    )
    .toArray();
  if (!page) return null;
  return { number: page.number, size: page, stickers: stickersOnPage(sql, page.id) };
}

/** The stickers on a page, as placing the next one needs them. */
export function stickersOnPage(sql: SqlStorage, pageId: string): StickerOnPage[] {
  return sql
    .exec<{ y: number; kind: StickerKindName }>(
      "SELECT y, kind FROM stickers WHERE page_id = ?",
      pageId,
    )
    .toArray();
}

/** Whether a member can see a page, from its id, whether or not anything has been put on it yet:
 *  every member sees the household's calendar pages, only the members who see a space see its
 *  pages, and only those who see an item see its body page. */
export function canSeePage(sql: SqlStorage, memberId: string, pageId: string): boolean {
  const [kind = "", ...rest] = pageId.split(":");
  const named = rest.join(":");
  switch (kind) {
    case "month":
      return isIsoMonth(named);
    case "week":
      return isWeekStart(named);
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
    case "item": {
      const item = isId(named) && pageId === itemPageId(named) ? itemOf(sql, named) : null;
      return typeof item === "object" && item !== null && canSee(sql, memberId, item.space_id);
    }
    default:
      return false;
  }
}

function itemOf(
  sql: SqlStorage,
  itemId: string,
): { kind: string; space_id: string } | "deleted" | null {
  const [item] = sql
    .exec<{ kind: string; space_id: string }>(
      "SELECT kind, space_id FROM items WHERE id = ?",
      itemId,
    )
    .toArray();
  if (item) return item;
  const deleted = sql
    .exec("SELECT 1 FROM tombstones WHERE kind = 'item' AND id = ?", itemId)
    .toArray().length;
  return deleted > 0 ? "deleted" : null;
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
      return namedBy(isWeekStart)
        ? null
        : "A week's page must be named by its Monday, as in “week:2026-11-16”.";
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
      return isId(page.itemId) && page.pageId === itemPageId(page.itemId)
        ? null
        : "A body page must be named by its item, as in “item:<item id>”.";
  }
}

function isSize(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

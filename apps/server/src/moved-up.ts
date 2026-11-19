import {
  itemPageId,
  newId,
  type PagePoint,
  type PageSize,
  pageSizeFor,
  type StickerKindName,
  spacePageId,
  stickerSpotInSpace,
  stickerSpotOnPage,
} from "@foyer/shared";
import { memberFor } from "./calendar-stickers";
import { newestPageOf, stickersOnPage } from "./pages";
import type { RowKey } from "./rows";

/** An item a delete moved up, out from under the item deleted. */
export type MovedUp = { id: string; kind: StickerKindName; created_by: string | null };

/** Who places the stickers of the items a delete moves up, and when, by the household's clock: the
 *  member who deleted their parent, or if null, the member the household acts for. */
export type Placer = { by: string | null; at: number };

type Spot = {
  at: PagePoint;
  page: { id: string; spaceId: string | null; number: number | null; itemId: string | null };
  size: PageSize;
  isNewPage: boolean;
};

/** Places a sticker for each item moved up, in order, in the next free spot of its new page: its
 *  new parent's body page, made if nobody has put anything on it yet, or its space's newest page,
 *  or a new page after it when that's full. Returns the rows it changed, as part of change `seq`. */
export function stickMovedUp(
  sql: SqlStorage,
  moved: readonly MovedUp[],
  to: { spaceId: string; parentId: string | null },
  placer: Placer,
  seq: number,
): RowKey[] {
  const changeId = newId();
  return moved.flatMap((item): RowKey[] => {
    const by = placer.by ?? memberFor(sql, { ...item, space_id: to.spaceId });
    const { at, page, size, isNewPage } =
      to.parentId === null
        ? spotInSpace(sql, to.spaceId, item.kind)
        : spotOnBody(sql, to.parentId, item.kind);
    const changed: RowKey[] = [];
    if (isNewPage) {
      sql.exec(
        `INSERT INTO pages (id, kind, space_id, number, item_id, width, height, created_by,
           created_at, seq)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        page.id,
        page.itemId === null ? "space" : "item",
        page.spaceId,
        page.number,
        page.itemId,
        size.width,
        size.height,
        by,
        placer.at,
        seq,
      );
      changed.push({ kind: "page", id: page.id });
    }
    const stickerId = newId();
    sql.exec(
      `INSERT INTO stickers (id, page_id, x, y, kind, item_id, placed_at, placed_change_id,
         placed_by, seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      stickerId,
      page.id,
      at.x,
      at.y,
      item.kind,
      item.id,
      placer.at,
      changeId,
      by,
      seq,
    );
    changed.push({ kind: "sticker", id: stickerId });
    return changed;
  });
}

function spotInSpace(sql: SqlStorage, spaceId: string, kind: StickerKindName): Spot {
  const size = pageSizeFor("space");
  const spot = stickerSpotInSpace(newestPageOf(sql, spaceId), kind, size);
  const page = {
    id: spacePageId(spaceId, spot.number),
    spaceId,
    number: spot.number,
    itemId: null,
  };
  return { at: spot.at, page, size, isNewPage: spot.isNewPage };
}

function spotOnBody(sql: SqlStorage, parentId: string, kind: StickerKindName): Spot {
  const page = { id: itemPageId(parentId), spaceId: null, number: null, itemId: parentId };
  const [made] = sql
    .exec<PageSize>("SELECT width, height FROM pages WHERE id = ?", page.id)
    .toArray();
  const size = made ?? pageSizeFor("item");
  const at = stickerSpotOnPage(size, stickersOnPage(sql, page.id), kind);
  return { at, page, size, isNewPage: !made };
}

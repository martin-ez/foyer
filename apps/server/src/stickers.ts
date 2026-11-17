import { isId } from "@foyer/shared";
import {
  StickerKind,
  type StickerMove,
  type StickerPlace,
  type StickerRemove,
} from "@foyer/shared/gen/foyer/sticker/v1/sticker_pb";
import { type Applied, isLater, type Setter } from "./changes";
import { findItem, type ItemKindName } from "./items";
import { canSeePage } from "./pages";
import { nextSeq, type RowKey } from "./rows";
import { canSee } from "./spaces";

const stickerKinds: Partial<Record<StickerKind, ItemKindName>> = {
  [StickerKind.TASK]: "task",
  [StickerKind.EVENT]: "event",
  [StickerKind.NOTE]: "note",
};

type PageRow = { id: string; kind: string; space_id: string | null; width: number; height: number };

/** Places a sticker for an item on a page, where the member sees both. For now, only a space's
 *  page takes stickers, and only for the space's own items. Its corner must be on the page. */
export function placeSticker(
  sql: SqlStorage,
  memberId: string,
  setter: Setter,
  sticker: StickerPlace,
): Applied {
  if (!isId(sticker.stickerId)) return { refused: "A sticker's id must be a UUID version 7." };
  const kind = stickerKinds[sticker.kind];
  if (!kind) return { refused: "A sticker must be a task's, an event's or a note's." };
  if (stickerExisted(sql, sticker.stickerId)) {
    return { refused: "A sticker with this id already exists." };
  }
  const [page] = sql
    .exec<PageRow>(
      "SELECT id, kind, space_id, width, height FROM pages WHERE id = ?",
      sticker.pageId,
    )
    .toArray();
  if (!page || !canSeePage(sql, memberId, page.id)) return { refused: "There's no such page." };
  if (page.kind !== "space") return { refused: "Stickers can only go on a space's pages for now." };
  const item = findItem(sql, sticker.itemId);
  if (!item || !canSee(sql, memberId, item.spaceId)) return { refused: "There's no such item." };
  if (item.kind !== kind) return { refused: "A sticker must be of the same kind as its item." };
  if (item.spaceId !== page.space_id) {
    return { refused: "A space's page only holds the space's own items." };
  }
  if (!isOnPage(sticker, page)) return { refused: offPage };

  const seq = nextSeq(sql);
  sql.exec(
    `INSERT INTO stickers (id, page_id, x, y, kind, item_id, placed_at, placed_change_id, placed_by, seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    sticker.stickerId,
    page.id,
    sticker.x,
    sticker.y,
    kind,
    sticker.itemId,
    setter.at,
    setter.changeId,
    memberId,
    seq,
  );
  return { seq, changed: [{ kind: "sticker", id: sticker.stickerId }], unchanged: [] };
}

/** Moves a sticker within its page and brings it to the top, unless a later move or placing won.
 *  Only a member who sees its item can move it. Moving a removed sticker has no effect. */
export function moveSticker(
  sql: SqlStorage,
  memberId: string,
  setter: Setter,
  move: StickerMove,
): Applied {
  const found = stickerFor(sql, memberId, move.stickerId, "move");
  if ("refused" in found || "removed" in found) return found.applied;
  const { sticker } = found;
  if (!isOnPage(move, sticker)) return { refused: offPage };

  const key: RowKey = { kind: "sticker", id: move.stickerId };
  if (!isLater(setter, { at: sticker.placed_at, changeId: sticker.placed_change_id })) {
    return { seq: nextSeq(sql), changed: [], unchanged: [key] };
  }
  const seq = nextSeq(sql);
  sql.exec(
    `UPDATE stickers SET x = ?, y = ?, placed_at = ?, placed_change_id = ?, placed_by = ?, seq = ?
     WHERE id = ?`,
    move.x,
    move.y,
    setter.at,
    setter.changeId,
    memberId,
    seq,
    move.stickerId,
  );
  return { seq, changed: [key], unchanged: [] };
}

/** Peels a sticker off its page, leaving a tombstone that the members who see the page receive.
 *  Only a member who sees its item can remove it, and a task's sticker stays on its own space's
 *  page. Removing it again has no effect. */
export function removeSticker(sql: SqlStorage, memberId: string, remove: StickerRemove): Applied {
  const found = stickerFor(sql, memberId, remove.stickerId, "remove");
  if ("refused" in found || "removed" in found) return found.applied;
  const { sticker } = found;
  if (sticker.kind === "task" && sticker.page_space_id === sticker.item_space_id) {
    return {
      refused: "A task's sticker stays on its space's page until the task is deleted or moved.",
    };
  }

  const seq = nextSeq(sql);
  sql.exec("DELETE FROM stickers WHERE id = ?", remove.stickerId);
  sql.exec(
    "INSERT INTO tombstones (kind, id, visible_to, seq) VALUES ('sticker', ?, ?, ?)",
    remove.stickerId,
    sticker.page_owner_id,
    seq,
  );
  return { seq, changed: [{ kind: "sticker", id: remove.stickerId }], unchanged: [] };
}

type StickerRow = {
  page_id: string;
  page_space_id: string | null;
  kind: ItemKindName;
  width: number;
  height: number;
  item_space_id: string;
  page_owner_id: string | null;
  placed_at: number;
  placed_change_id: string;
};

type Found =
  | { sticker: StickerRow }
  | { removed: true; applied: Applied }
  | { refused: true; applied: Applied };

function stickerFor(
  sql: SqlStorage,
  memberId: string,
  stickerId: string,
  action: "move" | "remove",
): Found {
  const [sticker] = sql
    .exec<StickerRow>(
      `SELECT stickers.page_id, pages.space_id AS page_space_id, stickers.kind, pages.width,
         pages.height, items.space_id AS item_space_id,
         spaces.owner_id AS page_owner_id, stickers.placed_at, stickers.placed_change_id
       FROM stickers
       JOIN pages ON pages.id = stickers.page_id
       JOIN items ON items.id = stickers.item_id
       LEFT JOIN spaces ON spaces.id = pages.space_id
       WHERE stickers.id = ?`,
      stickerId,
    )
    .toArray();
  if (!sticker || !canSeePage(sql, memberId, sticker.page_id)) {
    const removed =
      sql.exec("SELECT 1 FROM tombstones WHERE kind = 'sticker' AND id = ?", stickerId).toArray()
        .length > 0;
    const key: RowKey = { kind: "sticker", id: stickerId };
    if (removed)
      return { removed: true, applied: { seq: nextSeq(sql), changed: [], unchanged: [key] } };
    return { refused: true, applied: { refused: "There's no such sticker." } };
  }
  if (!canSee(sql, memberId, sticker.item_space_id)) {
    const refused = `Only someone who can see what's on a sticker can ${action} it.`;
    return { refused: true, applied: { refused } };
  }
  return { sticker };
}

function stickerExisted(sql: SqlStorage, stickerId: string): boolean {
  return (
    sql
      .exec(
        "SELECT 1 FROM stickers WHERE id = ? UNION ALL SELECT 1 FROM tombstones WHERE kind = 'sticker' AND id = ?",
        stickerId,
        stickerId,
      )
      .toArray().length > 0
  );
}

const offPage = "A sticker's top-left corner must be on its page.";

function isOnPage(at: { x: number; y: number }, page: { width: number; height: number }): boolean {
  return (
    Number.isFinite(at.x) &&
    Number.isFinite(at.y) &&
    at.x >= 0 &&
    at.y >= 0 &&
    at.x <= page.width &&
    at.y <= page.height
  );
}

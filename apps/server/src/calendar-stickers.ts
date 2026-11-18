import {
  calendarPageId,
  calendarPageKinds,
  newId,
  type PageSize,
  type PlacedSticker,
  planCalendarStickers,
} from "@foyer/shared";
import type { Setter } from "./changes";
import { nextSeq, type RowKey } from "./rows";

type ItemRow = {
  kind: "task" | "event" | "note";
  date: string | null;
  repeat: string | null;
  space_id: string;
  created_by: string | null;
};

/** Keeps some items' calendar stickers on their days, as `planCalendarStickers` plans them, in one
 *  change made by `setter`, and returns the rows it changed. They're placed by `actor`, or if null,
 *  by the holder of an event's Google calendar or the item's creator. */
export function settleCalendarStickers(
  sql: SqlStorage,
  itemIds: Iterable<string>,
  setter: Setter,
  actor: string | null,
): RowKey[] {
  const changed: RowKey[] = [];
  let seq: number | null = null;
  for (const itemId of new Set(itemIds)) {
    const [item] = sql
      .exec<ItemRow>(
        "SELECT kind, date, repeat, space_id, created_by FROM items WHERE id = ?",
        itemId,
      )
      .toArray();
    if (!item || item.kind === "note") continue;
    const targets = item.date
      ? calendarPageKinds.map((kind) => calendarPageId(kind, item.date ?? ""))
      : [];
    const plan = planCalendarStickers({
      itemId,
      date: item.date,
      kept: item.repeat === null ? new Set() : ticked(sql, itemId),
      stickers: stickersFor(sql, itemId, targets),
      pages: pagesAmong(sql, targets),
    });
    const { pages, place, move, remove } = plan;
    if (pages.length + place.length + move.length + remove.length === 0) continue;
    seq ??= nextSeq(sql);
    const member = actor ?? memberFor(sql, item);
    for (const page of pages) {
      sql.exec(
        `INSERT INTO pages (id, kind, width, height, created_by, created_at, seq)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        page.pageId,
        page.kind,
        page.size.width,
        page.size.height,
        member,
        setter.at,
        seq,
      );
      changed.push({ kind: "page", id: page.pageId });
    }
    for (const sticker of place) {
      sql.exec(
        `INSERT INTO stickers (id, page_id, x, y, kind, item_id, occurrence, placed_at,
           placed_change_id, placed_by, seq)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        sticker.stickerId,
        sticker.pageId,
        sticker.x,
        sticker.y,
        item.kind,
        itemId,
        sticker.occurrence,
        setter.at,
        setter.changeId,
        member,
        seq,
      );
      changed.push({ kind: "sticker", id: sticker.stickerId });
    }
    for (const sticker of move) {
      sql.exec(
        `UPDATE stickers SET x = ?, y = ?, occurrence = ?, placed_at = ?, placed_change_id = ?,
           placed_by = ?, seq = ?
         WHERE id = ?`,
        sticker.x,
        sticker.y,
        sticker.occurrence,
        setter.at,
        setter.changeId,
        member,
        seq,
        sticker.stickerId,
      );
      changed.push({ kind: "sticker", id: sticker.stickerId });
    }
    for (const stickerId of remove) {
      sql.exec("DELETE FROM stickers WHERE id = ?", stickerId);
      sql.exec(
        "INSERT INTO tombstones (kind, id, visible_to, seq) VALUES ('sticker', ?, NULL, ?)",
        stickerId,
        seq,
      );
      changed.push({ kind: "sticker", id: stickerId });
    }
  }
  return changed;
}

/** Places the calendar stickers of every dated task and event that the household holds, for items
 *  dated before calendar pages showed them. */
export function placeAllCalendarStickers(storage: DurableObjectStorage): void {
  const { sql } = storage;
  const dated = sql
    .exec<{ id: string }>(
      "SELECT id FROM items WHERE date IS NOT NULL AND kind IN ('task', 'event') ORDER BY id",
    )
    .toArray()
    .map(({ id }) => id);
  settleCalendarStickers(sql, dated, { at: Date.now(), changeId: newId() }, null);
}

/** The ids of the items whose stickers some rows are, or which they are. */
export function itemsOfRows(sql: SqlStorage, rows: readonly RowKey[]): string[] {
  const items = rows.filter(({ kind }) => kind === "item").map(({ id }) => id);
  for (const { id } of rows.filter(({ kind }) => kind === "sticker")) {
    const [sticker] = sql
      .exec<{ item_id: string }>("SELECT item_id FROM stickers WHERE id = ?", id)
      .toArray();
    if (sticker) items.push(sticker.item_id);
  }
  return items;
}

function ticked(sql: SqlStorage, itemId: string): Set<string> {
  return new Set(
    sql
      .exec<{ occurrence: string }>(
        "SELECT occurrence FROM completions WHERE item_id = ? AND occurrence != ''",
        itemId,
      )
      .toArray()
      .map(({ occurrence }) => occurrence),
  );
}

function stickersFor(sql: SqlStorage, itemId: string, pageIds: readonly string[]): PlacedSticker[] {
  const marks = pageIds.map(() => "?").join(", ");
  const onPages = pageIds.length > 0 ? `OR page_id IN (${marks})` : "";
  return sql
    .exec<{
      id: string;
      page_id: string;
      item_id: string;
      x: number;
      y: number;
      occurrence: string;
    }>(
      `SELECT id, page_id, item_id, x, y, occurrence FROM stickers
       WHERE occurrence IS NOT NULL AND (item_id = ? ${onPages})
       ORDER BY placed_at, id`,
      itemId,
      ...pageIds,
    )
    .toArray()
    .map((row) => ({
      id: row.id,
      pageId: row.page_id,
      itemId: row.item_id,
      x: row.x,
      y: row.y,
      occurrence: row.occurrence,
    }));
}

function pagesAmong(sql: SqlStorage, pageIds: readonly string[]): Map<string, PageSize> {
  if (pageIds.length === 0) return new Map();
  const marks = pageIds.map(() => "?").join(", ");
  return new Map(
    sql
      .exec<{ id: string; width: number; height: number }>(
        `SELECT id, width, height FROM pages WHERE id IN (${marks})`,
        ...pageIds,
      )
      .toArray()
      .map(({ id, width, height }) => [id, { width, height }]),
  );
}

function memberFor(sql: SqlStorage, item: ItemRow): string {
  const [holder] = sql
    .exec<{ member_id: string }>(
      "SELECT member_id FROM space_calendars WHERE space_id = ?",
      item.space_id,
    )
    .toArray();
  if (item.kind === "event" && holder) return holder.member_id;
  if (item.created_by) return item.created_by;
  if (holder) return holder.member_id;
  return sql.exec<{ id: string }>("SELECT id FROM members ORDER BY joined_at, id LIMIT 1").one().id;
}

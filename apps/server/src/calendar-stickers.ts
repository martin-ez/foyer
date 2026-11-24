import {
  calendarPageId,
  calendarPageKinds,
  minutesIntoDay,
  minutesOf,
  newId,
  type PageSize,
  type PlacedSticker,
  planCalendarStickers,
} from "@foyer/shared";
import type { Setter } from "./changes";
import { inJson, nextSeq, type RowKey } from "./rows";

type ItemRow = {
  kind: "task" | "event" | "note";
  date: string | null;
  time: string | null;
  starts_at: number | null;
  time_zone: string | null;
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
  const ids = [...new Set(itemIds)];
  const items = itemsAmong(sql, ids);
  const ownStickers = calendarStickersOf(sql, ids);
  const targetsOf = (item: ItemRow) =>
    item.date ? calendarPageKinds.map((kind) => calendarPageId(kind, item.date ?? "")) : [];
  const calendarPages = pagesAmong(sql, [...items.values()].flatMap(targetsOf));
  for (const itemId of ids) {
    const item = items.get(itemId);
    if (!item || item.kind === "note") continue;
    const targets = targetsOf(item);
    const options = {
      itemId,
      date: item.date,
      time: timeOnItsDay(item),
      kept: item.repeat === null ? new Set<string>() : ticked(sql, itemId),
      pages: calendarPages,
    };
    let plan = planCalendarStickers({ ...options, stickers: ownStickers.get(itemId) ?? [] });
    const needsSpots = plan.place.length + plan.move.length > 0;
    if (item.date && needsSpots) {
      const othersOn = { date: item.date, pageIds: targets };
      plan = planCalendarStickers({
        ...options,
        stickers: stickersOnItsDay(sql, itemId, othersOn),
      });
    }
    const { pages, place, move, remove } = plan;
    if (pages.length + place.length + move.length + remove.length === 0) continue;
    seq ??= nextSeq(sql);
    const member = actor ?? memberFor(sql, item);
    for (const page of pages) {
      calendarPages.set(page.pageId, page.size);
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
  const stickers = rows.filter(({ kind }) => kind === "sticker").map(({ id }) => id);
  if (stickers.length === 0) return items;
  const itemOf = new Map(
    sql
      .exec<{ id: string; item_id: string }>(
        `SELECT id, item_id FROM stickers WHERE id IN ${inJson}`,
        JSON.stringify(stickers),
      )
      .toArray()
      .map(({ id, item_id }) => [id, item_id]),
  );
  for (const id of stickers) {
    const item = itemOf.get(id);
    if (item) items.push(item);
  }
  return items;
}

function timeOnItsDay(item: ItemRow): number | null {
  if (item.date === null) return null;
  if (item.time !== null) return minutesOf(item.time);
  if (item.starts_at === null) return null;
  return minutesIntoDay(item.starts_at, item.date, item.time_zone ?? "UTC");
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

function itemsAmong(sql: SqlStorage, itemIds: readonly string[]): Map<string, ItemRow> {
  const items = sql
    .exec<ItemRow & { id: string }>(
      `SELECT items.id, items.kind, items.date, items.time, items.starts_at,
         space_calendars.time_zone, items.repeat, items.space_id, items.created_by
       FROM items LEFT JOIN space_calendars ON space_calendars.space_id = items.space_id
       WHERE items.id IN ${inJson}`,
      JSON.stringify(itemIds),
    )
    .toArray();
  return new Map(items.map((item) => [item.id, item]));
}

type StickerRow = {
  id: string;
  page_id: string;
  item_id: string;
  x: number;
  y: number;
  occurrence: string;
};

function calendarStickersOf(
  sql: SqlStorage,
  itemIds: readonly string[],
): Map<string, PlacedSticker[]> {
  const stickers = sql
    .exec<StickerRow>(
      `SELECT id, page_id, item_id, x, y, occurrence FROM stickers
       WHERE item_id IN ${inJson} AND occurrence IS NOT NULL
       ORDER BY placed_at, id`,
      JSON.stringify(itemIds),
    )
    .toArray();
  const byItem = new Map<string, PlacedSticker[]>();
  for (const row of stickers) {
    const sticker = placedSticker(row);
    const ofItem = byItem.get(sticker.itemId);
    if (ofItem) ofItem.push(sticker);
    else byItem.set(sticker.itemId, [sticker]);
  }
  return byItem;
}

function stickersOnItsDay(
  sql: SqlStorage,
  itemId: string,
  day: { date: string; pageIds: readonly string[] },
): PlacedSticker[] {
  const marks = day.pageIds.map(() => "?").join(", ");
  return sql
    .exec<StickerRow>(
      `SELECT id, page_id, item_id, x, y, occurrence FROM stickers
       WHERE (item_id = ? AND occurrence IS NOT NULL)
         OR (page_id IN (${marks}) AND occurrence = ?)
       ORDER BY placed_at, id`,
      itemId,
      ...day.pageIds,
      day.date,
    )
    .toArray()
    .map(placedSticker);
}

function placedSticker(row: StickerRow): PlacedSticker {
  return {
    id: row.id,
    pageId: row.page_id,
    itemId: row.item_id,
    x: row.x,
    y: row.y,
    occurrence: row.occurrence,
  };
}

function pagesAmong(sql: SqlStorage, pageIds: readonly string[]): Map<string, PageSize> {
  if (pageIds.length === 0) return new Map();
  return new Map(
    sql
      .exec<{ id: string; width: number; height: number }>(
        `SELECT id, width, height FROM pages WHERE id IN ${inJson}`,
        JSON.stringify(pageIds),
      )
      .toArray()
      .map(({ id, width, height }) => [id, { width, height }]),
  );
}

/** The member the household acts for when it places an item's stickers without a member's change:
 *  the holder of an event's Google calendar, or else the item's creator, or else the holder of its
 *  space's calendar, or else the member who joined first. */
export function memberFor(
  sql: SqlStorage,
  item: { kind: string; space_id: string; created_by: string | null },
): string {
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

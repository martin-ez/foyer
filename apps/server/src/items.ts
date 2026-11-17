import { isId, isIsoDate, itemDescriptionProblem, itemTitleProblem } from "@foyer/shared";
import {
  type ItemCreate,
  type ItemDelete,
  ItemKind,
  type ItemMove,
} from "@foyer/shared/gen/foyer/item/v1/item_pb";
import { type Applied, isLater, type Setter } from "./changes";
import { joinPageSpace, nextSeq, type RowKey } from "./rows";
import { canSee } from "./spaces";

const badDate = "A task's date must be a day, as in “2026-11-17”.";

/** What an item is, as the household stores it. */
export type ItemKindName = "task" | "event" | "note";

/** Creates a task in a space the member sees, with a trimmed title that isn't blank or too long,
 *  and a date that's a day or empty. Every field it sets keeps the change that set it. */
export function createItem(
  sql: SqlStorage,
  memberId: string,
  setter: Setter,
  item: ItemCreate,
): Applied {
  if (!isId(item.itemId)) return { refused: "An item's id must be a UUID version 7." };
  if (item.kind !== ItemKind.TASK) return { refused: "Only tasks can be created for now." };
  if (itemExisted(sql, item.itemId)) return { refused: "An item with this id already exists." };
  if (!canSee(sql, memberId, item.spaceId)) return { refused: "There's no such space." };
  const title = item.title.trim();
  const problem = itemTitleProblem(title) ?? itemDescriptionProblem(item.description);
  if (problem) return { refused: problem };
  if (item.date !== "" && !isIsoDate(item.date)) return { refused: badDate };

  const seq = nextSeq(sql);
  const { at, changeId } = setter;
  sql.exec(
    `INSERT INTO items (id, kind, space_id, title, description, date, created_by, created_at, seq,
       space_at, space_change_id, title_at, title_change_id, description_at, description_change_id,
       date_at, date_change_id)
     VALUES (?, 'task', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    item.itemId,
    item.spaceId,
    title,
    item.description,
    item.date === "" ? null : item.date,
    memberId,
    at,
    seq,
    ...[at, changeId, at, changeId, at, changeId, at, changeId],
  );
  return { seq, changed: [{ kind: "item", id: item.itemId }], unchanged: [] };
}

/** An item that exists, with the space it lives in, or null. */
export function findItem(
  sql: SqlStorage,
  itemId: string,
): { kind: ItemKindName; spaceId: string } | null {
  const [item] = sql
    .exec<{ kind: ItemKindName; space_id: string }>(
      "SELECT kind, space_id FROM items WHERE id = ?",
      itemId,
    )
    .toArray();
  return item ? { kind: item.kind, spaceId: item.space_id } : null;
}

function itemExisted(sql: SqlStorage, itemId: string): boolean {
  return (
    sql
      .exec(
        "SELECT 1 FROM items WHERE id = ? UNION ALL SELECT 1 FROM tombstones WHERE kind = 'item' AND id = ?",
        itemId,
        itemId,
      )
      .toArray().length > 0
  );
}

type ItemRow = {
  kind: ItemKindName;
  space_id: string;
  owner_id: string | null;
  space_at: number;
  space_change_id: string;
  title_at: number;
  title_change_id: string;
  description_at: number;
  description_change_id: string;
  date_at: number;
  date_change_id: string;
};

type Field = "title" | "description" | "date";

/** Changes an item's title, description or date, unless a later change to the same field won.
 *  A title is trimmed and must not be blank or too long, a description must not be too long, and a
 *  date must be a day or empty, which clears it. Changing a deleted item has no effect. */
export function setItemField(
  sql: SqlStorage,
  memberId: string,
  setter: Setter,
  itemId: string,
  field: Field,
  value: string,
): Applied {
  const checked = checkField(field, value);
  if ("refused" in checked) return checked;
  const found = itemFor(sql, memberId, itemId);
  if (!("item" in found)) return found.applied;

  const key: RowKey = { kind: "item", id: itemId };
  const last = { at: found.item[`${field}_at`], changeId: found.item[`${field}_change_id`] };
  if (!isLater(setter, last)) return { seq: nextSeq(sql), changed: [], unchanged: [key] };
  const seq = nextSeq(sql);
  sql.exec(
    `UPDATE items SET ${field} = ?, ${field}_at = ?, ${field}_change_id = ?, seq = ? WHERE id = ?`,
    checked.value,
    setter.at,
    setter.changeId,
    seq,
    itemId,
  );
  return { seq, changed: [key], unchanged: [] };
}

/** Moves an item to another space the member sees, unless a later move won. Its completions, its
 *  body page and what's on that page move with it. Members who saw them before and can't see the
 *  new space are told to drop them, and those who can see them again receive them as they now are.
 *  Moving a deleted item has no effect. */
export function moveItem(
  sql: SqlStorage,
  memberId: string,
  setter: Setter,
  move: ItemMove,
): Applied {
  const found = itemFor(sql, memberId, move.itemId);
  if (!("item" in found)) return found.applied;
  if (!canSee(sql, memberId, move.spaceId)) return { refused: "There's no such space." };

  const key: RowKey = { kind: "item", id: move.itemId };
  const last = { at: found.item.space_at, changeId: found.item.space_change_id };
  if (!isLater(setter, last)) return { seq: nextSeq(sql), changed: [], unchanged: [key] };
  const [space] = sql
    .exec<{ owner_id: string | null }>("SELECT owner_id FROM spaces WHERE id = ?", move.spaceId)
    .toArray();
  const ownerAfter = space?.owner_id ?? null;
  const seq = nextSeq(sql);
  sql.exec(
    "UPDATE items SET space_id = ?, space_at = ?, space_change_id = ?, seq = ? WHERE id = ?",
    move.spaceId,
    setter.at,
    setter.changeId,
    seq,
    move.itemId,
  );
  sql.exec("UPDATE completions SET seq = ? WHERE item_id = ?", seq, move.itemId);
  sql.exec("UPDATE pages SET seq = ? WHERE item_id = ?", seq, move.itemId);
  sql.exec(
    "UPDATE stickers SET seq = ? WHERE page_id IN (SELECT id FROM pages WHERE item_id = ?)",
    seq,
    move.itemId,
  );

  const ownerBefore = found.item.owner_id;
  const losing =
    ownerAfter === null || ownerBefore === ownerAfter
      ? []
      : ownerBefore === null
        ? sql
            .exec<{ id: string }>("SELECT id FROM members WHERE id != ?", ownerAfter)
            .toArray()
            .map(({ id }) => id)
        : [ownerBefore];
  const moved = [key, ...carriedBy(sql, move.itemId)];
  for (const row of moved) {
    if (ownerAfter === null) {
      sql.exec("DELETE FROM hidden_rows WHERE kind = ? AND id = ?", row.kind, row.id);
    } else {
      sql.exec(
        "DELETE FROM hidden_rows WHERE kind = ? AND id = ? AND member_id = ?",
        row.kind,
        row.id,
        ownerAfter,
      );
    }
    for (const member of losing) {
      sql.exec(
        `INSERT INTO hidden_rows (kind, id, member_id, seq) VALUES (?, ?, ?, ?)
         ON CONFLICT (kind, id, member_id) DO UPDATE SET seq = excluded.seq`,
        row.kind,
        row.id,
        member,
        seq,
      );
    }
  }
  return { seq, changed: moved, unchanged: [] };
}

/** Deletes an item, its stickers on every page, its completions, and its body page with what's
 *  on it, leaving tombstones that the members who saw them receive. Deleting it again has no
 *  effect. */
export function deleteItem(sql: SqlStorage, memberId: string, remove: ItemDelete): Applied {
  const found = itemFor(sql, memberId, remove.itemId);
  if (!("item" in found)) return found.applied;

  const seq = nextSeq(sql);
  const owner = found.item.owner_id;
  const bury = (kind: RowKey["kind"], id: string, visibleTo: string | null) =>
    sql.exec(
      "INSERT INTO tombstones (kind, id, visible_to, seq) VALUES (?, ?, ?, ?)",
      kind,
      id,
      visibleTo,
      seq,
    );
  const stickers = sql
    .exec<{ id: string; owner_id: string | null }>(
      `SELECT stickers.id, spaces.owner_id FROM stickers
       JOIN pages ON pages.id = stickers.page_id ${joinPageSpace}
       WHERE stickers.item_id = ? OR pages.item_id = ?`,
      remove.itemId,
      remove.itemId,
    )
    .toArray();
  for (const sticker of stickers) {
    sql.exec("DELETE FROM stickers WHERE id = ?", sticker.id);
    bury("sticker", sticker.id, sticker.owner_id);
  }
  const carried = carriedBy(sql, remove.itemId).filter(({ kind }) => kind !== "sticker");
  for (const row of carried) bury(row.kind, row.id, owner);
  sql.exec("DELETE FROM completions WHERE item_id = ?", remove.itemId);
  sql.exec("DELETE FROM last_ticks WHERE item_id = ?", remove.itemId);
  sql.exec("DELETE FROM pages WHERE item_id = ?", remove.itemId);
  sql.exec("DELETE FROM items WHERE id = ?", remove.itemId);
  bury("item", remove.itemId, owner);
  const changed: RowKey[] = [
    { kind: "item", id: remove.itemId },
    ...carried,
    ...stickers.map(({ id }): RowKey => ({ kind: "sticker", id })),
  ];
  return { seq, changed, unchanged: [] };
}

/** The rows that go where an item goes, so that whoever sees the item sees them: its completions,
 *  its body page, and the stickers on that page. */
function carriedBy(sql: SqlStorage, itemId: string): RowKey[] {
  const ids = (query: string) =>
    sql
      .exec<{ id: string }>(query, itemId)
      .toArray()
      .map(({ id }) => id);
  return [
    ...ids("SELECT id FROM completions WHERE item_id = ?").map(
      (id): RowKey => ({ kind: "completion", id }),
    ),
    ...ids("SELECT id FROM pages WHERE item_id = ?").map((id): RowKey => ({ kind: "page", id })),
    ...ids("SELECT id FROM stickers WHERE page_id IN (SELECT id FROM pages WHERE item_id = ?)").map(
      (id): RowKey => ({ kind: "sticker", id }),
    ),
  ];
}

function checkField(field: Field, value: string): { value: string | null } | { refused: string } {
  switch (field) {
    case "title": {
      const title = value.trim();
      const problem = itemTitleProblem(title);
      return problem ? { refused: problem } : { value: title };
    }
    case "description": {
      const problem = itemDescriptionProblem(value);
      return problem ? { refused: problem } : { value };
    }
    case "date":
      if (value === "") return { value: null };
      return isIsoDate(value) ? { value } : { refused: badDate };
  }
}

/** An item the member sees, or else what a change to it does: nothing for a deleted item, and a
 *  refusal for one that never existed or that the member doesn't see. */
export function itemFor(
  sql: SqlStorage,
  memberId: string,
  itemId: string,
): { item: ItemRow } | { applied: Applied } {
  const [item] = sql
    .exec<ItemRow>(
      `SELECT items.kind, items.space_id, spaces.owner_id, items.space_at, items.space_change_id,
         items.title_at, items.title_change_id, items.description_at, items.description_change_id,
         items.date_at, items.date_change_id
       FROM items JOIN spaces ON spaces.id = items.space_id WHERE items.id = ?`,
      itemId,
    )
    .toArray();
  if (item && canSee(sql, memberId, item.space_id)) return { item };
  const deleted =
    !item &&
    sql.exec("SELECT 1 FROM tombstones WHERE kind = 'item' AND id = ?", itemId).toArray().length >
      0;
  if (!deleted) return { applied: { refused: "There's no such item." } };
  const key: RowKey = { kind: "item", id: itemId };
  return { applied: { seq: nextSeq(sql), changed: [], unchanged: [key] } };
}

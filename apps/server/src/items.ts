import { isId, isIsoDate, itemTitleProblem } from "@foyer/shared";
import { type ItemCreate, ItemKind } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import type { Applied, Setter } from "./changes";
import { nextSeq } from "./rows";
import { canSee } from "./spaces";

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
  const problem = itemTitleProblem(title);
  if (problem) return { refused: problem };
  if (item.date !== "" && !isIsoDate(item.date)) {
    return { refused: "A task's date must be a day, as in “2026-11-17”." };
  }

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

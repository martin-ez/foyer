import type { ItemSetParent } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import { type Applied, isLater, type Setter } from "./changes";
import { findItem, itemFor, itemsUnder, moveIntoSpace } from "./items";
import { nextSeq, type RowKey } from "./rows";
import { canSee } from "./spaces";

/** Puts an item the member sees under a task or note they see, or back at the top of its space
 *  when the parent is empty, unless a later change to its parent won. Under a parent in another
 *  space, it moves there with everything under it, unless a later move won. */
export function setItemParent(
  sql: SqlStorage,
  memberId: string,
  setter: Setter,
  change: ItemSetParent,
): Applied {
  const found = itemFor(sql, memberId, change.itemId);
  if (!("item" in found)) return found.applied;
  const { item } = found;
  let parentSpace: string | null = null;
  if (change.parentId !== "") {
    const parent = findItem(sql, change.parentId);
    if (!parent || !canSee(sql, memberId, parent.spaceId)) {
      return { refused: "There's no such item to go under." };
    }
    if (parent.kind === "event") return { refused: "Only tasks and notes can hold items." };
    parentSpace = parent.spaceId;
  }

  const key: RowKey = { kind: "item", id: change.itemId };
  const movesSpace = parentSpace !== null && parentSpace !== item.space_id;
  const lastParent = { at: item.parent_at, changeId: item.parent_change_id };
  const lastSpace = { at: item.space_at, changeId: item.space_change_id };
  if (!isLater(setter, lastParent) || (movesSpace && !isLater(setter, lastSpace))) {
    return { seq: nextSeq(sql), changed: [], unchanged: [key] };
  }
  if (
    change.parentId === change.itemId ||
    itemsUnder(sql, change.itemId).includes(change.parentId)
  ) {
    return { refused: "An item can't go under itself, or under an item that's under it." };
  }
  const seq = nextSeq(sql);
  sql.exec(
    "UPDATE items SET parent_id = ?, parent_at = ?, parent_change_id = ?, seq = ? WHERE id = ?",
    change.parentId === "" ? null : change.parentId,
    setter.at,
    setter.changeId,
    seq,
    change.itemId,
  );
  const changed =
    movesSpace && parentSpace !== null
      ? moveIntoSpace(sql, change.itemId, item.owner_id, parentSpace, setter, seq)
      : [key];
  return { seq, changed, unchanged: [] };
}

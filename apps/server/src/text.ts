import { isId, textBlockProblem, textOrderProblem } from "@foyer/shared";
import type {
  TextBlockCreate,
  TextBlockDelete,
  TextBlockEdit,
  TextBlockMove,
  TextGroupCreate,
  TextGroupDelete,
  TextGroupMove,
  TextGroupResize,
} from "@foyer/shared/gen/foyer/text/v1/text_pb";
import { type Applied, isLater, type Setter } from "./changes";
import { canSeePage } from "./pages";
import { inJson, joinPageSpace, nextSeq, type RowKey } from "./rows";

/** Makes a text group on a page the member sees, which has been created, with its corner on the
 *  page and a width no wider than the page. */
export function createTextGroup(
  sql: SqlStorage,
  memberId: string,
  setter: Setter,
  group: TextGroupCreate,
): Applied {
  if (!isId(group.groupId)) return { refused: "A text group's id must be a UUID version 7." };
  if (existed(sql, "text_group", group.groupId)) {
    return { refused: "A text group with this id already exists." };
  }
  const [page] = sql
    .exec<PageSize>("SELECT width, height FROM pages WHERE id = ?", group.pageId)
    .toArray();
  if (!page || !canSeePage(sql, memberId, group.pageId))
    return { refused: "There's no such page." };
  if (!isOnPage(group, page)) return { refused: offPage };
  if (!fitsOnPage(group.width, page)) return { refused: badWidth };

  const seq = nextSeq(sql);
  sql.exec(
    `INSERT INTO text_groups (id, page_id, x, y, width, placed_at, placed_change_id, placed_by,
       width_at, width_change_id, created_by, created_at, seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    group.groupId,
    group.pageId,
    group.x,
    group.y,
    group.width,
    setter.at,
    setter.changeId,
    memberId,
    setter.at,
    setter.changeId,
    memberId,
    setter.at,
    seq,
  );
  return { seq, changed: [{ kind: "text_group", id: group.groupId }], unchanged: [] };
}

/** Moves a text group within its page and brings it to the top, unless a later move won. Moving a
 *  deleted group has no effect. */
export function moveTextGroup(
  sql: SqlStorage,
  memberId: string,
  setter: Setter,
  move: TextGroupMove,
): Applied {
  const found = groupFor(sql, memberId, move.groupId);
  if (!("group" in found)) return found.applied;
  const { group } = found;
  if (!isOnPage(move, group)) return { refused: offPage };
  const key: RowKey = { kind: "text_group", id: move.groupId };
  if (!isLater(setter, { at: group.placed_at, changeId: group.placed_change_id })) {
    return { seq: nextSeq(sql), changed: [], unchanged: [key] };
  }
  const seq = nextSeq(sql);
  sql.exec(
    `UPDATE text_groups SET x = ?, y = ?, placed_at = ?, placed_change_id = ?, placed_by = ?,
       seq = ?
     WHERE id = ?`,
    move.x,
    move.y,
    setter.at,
    setter.changeId,
    memberId,
    seq,
    move.groupId,
  );
  return { seq, changed: [key], unchanged: [] };
}

/** Changes how wide a text group is, unless a later change won. Resizing a deleted group has no
 *  effect. */
export function resizeTextGroup(
  sql: SqlStorage,
  memberId: string,
  setter: Setter,
  resize: TextGroupResize,
): Applied {
  const found = groupFor(sql, memberId, resize.groupId);
  if (!("group" in found)) return found.applied;
  const { group } = found;
  if (!fitsOnPage(resize.width, group)) return { refused: badWidth };
  const key: RowKey = { kind: "text_group", id: resize.groupId };
  if (!isLater(setter, { at: group.width_at, changeId: group.width_change_id })) {
    return { seq: nextSeq(sql), changed: [], unchanged: [key] };
  }
  const seq = nextSeq(sql);
  sql.exec(
    "UPDATE text_groups SET width = ?, width_at = ?, width_change_id = ?, seq = ? WHERE id = ?",
    resize.width,
    setter.at,
    setter.changeId,
    seq,
    resize.groupId,
  );
  return { seq, changed: [key], unchanged: [] };
}

/** Deletes a text group with its blocks, leaving tombstones that the members who see its page
 *  receive. Deleting it again has no effect. */
export function deleteTextGroup(
  sql: SqlStorage,
  memberId: string,
  remove: TextGroupDelete,
): Applied {
  const found = groupFor(sql, memberId, remove.groupId);
  if (!("group" in found)) return found.applied;
  const seq = nextSeq(sql);
  return {
    seq,
    changed: buryGroups(sql, [remove.groupId], found.group.owner_id, seq),
    unchanged: [],
  };
}

/** Deletes text groups and their blocks as change `seq`, leaving tombstones for the members who saw
 *  them, all of them when `visibleTo` is null, and returns the rows deleted. */
export function buryGroups(
  sql: SqlStorage,
  groupIds: readonly string[],
  visibleTo: string | null,
  seq: number,
): RowKey[] {
  const buried: RowKey[] = [];
  const bury = (kind: "text_group" | "text_block", id: string) => {
    sql.exec(
      "INSERT INTO tombstones (kind, id, visible_to, seq) VALUES (?, ?, ?, ?)",
      kind,
      id,
      visibleTo,
      seq,
    );
    buried.push({ kind, id });
  };
  for (const groupId of groupIds) {
    const blocks = sql
      .exec<{ id: string }>("SELECT id FROM text_blocks WHERE group_id = ?", groupId)
      .toArray();
    sql.exec("DELETE FROM text_blocks WHERE group_id = ?", groupId);
    for (const { id } of blocks) bury("text_block", id);
    sql.exec("DELETE FROM text_groups WHERE id = ?", groupId);
    bury("text_group", groupId);
  }
  return buried;
}

/** The text groups and blocks on some items' pages. */
export function textOnPagesOf(sql: SqlStorage, itemIds: readonly string[]): RowKey[] {
  const ids = JSON.stringify(itemIds);
  const onTheirPages = `text_groups.page_id IN (SELECT id FROM pages WHERE item_id IN ${inJson})`;
  const groups = sql
    .exec<{ id: string }>(`SELECT id FROM text_groups WHERE ${onTheirPages}`, ids)
    .toArray()
    .map(({ id }): RowKey => ({ kind: "text_group", id }));
  const blocks = sql
    .exec<{ id: string }>(
      `SELECT text_blocks.id FROM text_blocks
       JOIN text_groups ON text_groups.id = text_blocks.group_id
       WHERE ${onTheirPages}`,
      ids,
    )
    .toArray()
    .map(({ id }): RowKey => ({ kind: "text_block", id }));
  return [...groups, ...blocks];
}

/** Adds a block to a text group the member sees. Adding to a deleted group has no effect. */
export function createTextBlock(
  sql: SqlStorage,
  memberId: string,
  setter: Setter,
  block: TextBlockCreate,
): Applied {
  if (!isId(block.blockId)) return { refused: "A text block's id must be a UUID version 7." };
  if (existed(sql, "text_block", block.blockId)) {
    return { refused: "A text block with this id already exists." };
  }
  const problem = textOrderProblem(block.order) ?? textBlockProblem(block.markdown);
  if (problem) return { refused: problem };
  const found = groupFor(sql, memberId, block.groupId);
  if (!("group" in found)) {
    if ("refused" in found.applied) return found.applied;
    const key: RowKey = { kind: "text_block", id: block.blockId };
    return { seq: nextSeq(sql), changed: [], unchanged: [key] };
  }

  const seq = nextSeq(sql);
  sql.exec(
    `INSERT INTO text_blocks (id, group_id, block_order, order_at, order_change_id, markdown,
       markdown_at, markdown_change_id, created_by, created_at, seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    block.blockId,
    block.groupId,
    block.order,
    setter.at,
    setter.changeId,
    block.markdown,
    setter.at,
    setter.changeId,
    memberId,
    setter.at,
    seq,
  );
  return { seq, changed: [{ kind: "text_block", id: block.blockId }], unchanged: [] };
}

/** Changes a block's text, unless a later change won. Editing a deleted block has no effect. */
export function editTextBlock(
  sql: SqlStorage,
  memberId: string,
  setter: Setter,
  edit: TextBlockEdit,
): Applied {
  const problem = textBlockProblem(edit.markdown);
  if (problem) return { refused: problem };
  const found = blockFor(sql, memberId, edit.blockId);
  if (!("block" in found)) return found.applied;
  const { block } = found;
  const key: RowKey = { kind: "text_block", id: edit.blockId };
  if (!isLater(setter, { at: block.markdown_at, changeId: block.markdown_change_id })) {
    return { seq: nextSeq(sql), changed: [], unchanged: [key] };
  }
  const seq = nextSeq(sql);
  sql.exec(
    `UPDATE text_blocks SET markdown = ?, markdown_at = ?, markdown_change_id = ?, seq = ?
     WHERE id = ?`,
    edit.markdown,
    setter.at,
    setter.changeId,
    seq,
    edit.blockId,
  );
  return { seq, changed: [key], unchanged: [] };
}

/** Moves a block within its group, or to another group on the same page, unless a later move won.
 *  Moving a deleted block, or to a deleted group, has no effect. */
export function moveTextBlock(
  sql: SqlStorage,
  memberId: string,
  setter: Setter,
  move: TextBlockMove,
): Applied {
  const problem = textOrderProblem(move.order);
  if (problem) return { refused: problem };
  const found = blockFor(sql, memberId, move.blockId);
  if (!("block" in found)) return found.applied;
  const { block } = found;
  const key: RowKey = { kind: "text_block", id: move.blockId };
  const target = groupFor(sql, memberId, move.groupId);
  if (!("group" in target)) {
    if ("refused" in target.applied) return target.applied;
    return { seq: nextSeq(sql), changed: [], unchanged: [key] };
  }
  if (target.group.page_id !== block.page_id) {
    return { refused: "A text block can only move to a group on its own page." };
  }
  if (!isLater(setter, { at: block.order_at, changeId: block.order_change_id })) {
    return { seq: nextSeq(sql), changed: [], unchanged: [key] };
  }
  const seq = nextSeq(sql);
  sql.exec(
    `UPDATE text_blocks SET group_id = ?, block_order = ?, order_at = ?, order_change_id = ?,
       seq = ?
     WHERE id = ?`,
    move.groupId,
    move.order,
    setter.at,
    setter.changeId,
    seq,
    move.blockId,
  );
  return { seq, changed: [key], unchanged: [] };
}

/** Deletes a block, leaving a tombstone that the members who see its page receive. Deleting it
 *  again has no effect. */
export function deleteTextBlock(
  sql: SqlStorage,
  memberId: string,
  remove: TextBlockDelete,
): Applied {
  const found = blockFor(sql, memberId, remove.blockId);
  if (!("block" in found)) return found.applied;
  const seq = nextSeq(sql);
  sql.exec("DELETE FROM text_blocks WHERE id = ?", remove.blockId);
  sql.exec(
    "INSERT INTO tombstones (kind, id, visible_to, seq) VALUES ('text_block', ?, ?, ?)",
    remove.blockId,
    found.block.owner_id,
    seq,
  );
  return { seq, changed: [{ kind: "text_block", id: remove.blockId }], unchanged: [] };
}

type PageSize = { width: number; height: number };

type GroupRow = PageSize & {
  page_id: string;
  owner_id: string | null;
  placed_at: number;
  placed_change_id: string;
  width_at: number;
  width_change_id: string;
};

type BlockRow = {
  page_id: string;
  owner_id: string | null;
  order_at: number;
  order_change_id: string;
  markdown_at: number;
  markdown_change_id: string;
};

type Found<Key extends string, Row> = { [key in Key]: Row } | { applied: Applied };

function groupFor(sql: SqlStorage, memberId: string, groupId: string): Found<"group", GroupRow> {
  const [group] = sql
    .exec<GroupRow>(
      `SELECT text_groups.page_id, pages.width, pages.height, spaces.owner_id,
         text_groups.placed_at, text_groups.placed_change_id, text_groups.width_at,
         text_groups.width_change_id
       FROM text_groups JOIN pages ON pages.id = text_groups.page_id ${joinPageSpace}
       WHERE text_groups.id = ?`,
      groupId,
    )
    .toArray();
  if (group && canSeePage(sql, memberId, group.page_id)) return { group };
  return { applied: missing(sql, "text_group", groupId, "There's no such text group.") };
}

function blockFor(sql: SqlStorage, memberId: string, blockId: string): Found<"block", BlockRow> {
  const [block] = sql
    .exec<BlockRow>(
      `SELECT text_groups.page_id, spaces.owner_id, text_blocks.order_at,
         text_blocks.order_change_id, text_blocks.markdown_at, text_blocks.markdown_change_id
       FROM text_blocks JOIN text_groups ON text_groups.id = text_blocks.group_id
       JOIN pages ON pages.id = text_groups.page_id ${joinPageSpace}
       WHERE text_blocks.id = ?`,
      blockId,
    )
    .toArray();
  if (block && canSeePage(sql, memberId, block.page_id)) return { block };
  return { applied: missing(sql, "text_block", blockId, "There's no such text block.") };
}

function missing(
  sql: SqlStorage,
  kind: "text_group" | "text_block",
  id: string,
  refused: string,
): Applied {
  const deleted =
    sql.exec("SELECT 1 FROM tombstones WHERE kind = ? AND id = ?", kind, id).toArray().length > 0;
  if (!deleted) return { refused };
  return { seq: nextSeq(sql), changed: [], unchanged: [{ kind, id }] };
}

function existed(sql: SqlStorage, kind: "text_group" | "text_block", id: string): boolean {
  const table = kind === "text_group" ? "text_groups" : "text_blocks";
  return (
    sql
      .exec(
        `SELECT 1 FROM ${table} WHERE id = ? UNION ALL SELECT 1 FROM tombstones WHERE kind = ? AND id = ?`,
        id,
        kind,
        id,
      )
      .toArray().length > 0
  );
}

const offPage = "A text group's top-left corner must be on its page.";

const badWidth =
  "A text group's width must be a positive number of points, no wider than its page.";

function isOnPage(at: { x: number; y: number }, page: PageSize): boolean {
  return (
    Number.isFinite(at.x) &&
    Number.isFinite(at.y) &&
    at.x >= 0 &&
    at.y >= 0 &&
    at.x <= page.width &&
    at.y <= page.height
  );
}

function fitsOnPage(width: number, page: PageSize): boolean {
  return Number.isFinite(width) && width > 0 && width <= page.width;
}

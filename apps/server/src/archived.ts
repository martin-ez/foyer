import { PageKind } from "@foyer/shared/gen/foyer/page/v1/page_pb";
import type { Change } from "@foyer/shared/gen/foyer/sync/v1/sync_pb";
import { joinPageSpace } from "./rows";

/** Why the household refuses a change inside an archived space. */
export const spaceIsArchived = "This space is archived. Restore it to change it.";

/** Whether a change would change something inside an archived space the member sees: its name,
 *  its items, their stickers on any page, or what's on its pages and its items' pages, or would
 *  move an item into it or out of it. Spaces the member doesn't see never count. */
export function touchesArchivedSpace(
  sql: SqlStorage,
  memberId: string,
  change: Change["change"],
): boolean {
  const spaceIds = spacesTouchedBy(sql, change).filter((id) => id !== "");
  if (spaceIds.length === 0) return false;
  return (
    sql
      .exec(
        `SELECT 1 FROM spaces
         WHERE id IN (${spaceIds.map(() => "?").join(", ")}) AND archived = 1
           AND (owner_id IS NULL OR owner_id = ?)`,
        ...spaceIds,
        memberId,
      )
      .toArray().length > 0
  );
}

function spacesTouchedBy(sql: SqlStorage, change: Change["change"]): string[] {
  const ofItem = (itemId: string) =>
    spaceIdsOf(sql, "SELECT space_id AS id FROM items WHERE id = ?", itemId);
  const ofSticker = (stickerId: string) =>
    spaceIdsOf(
      sql,
      `SELECT items.space_id AS id FROM stickers JOIN items ON items.id = stickers.item_id
       WHERE stickers.id = ?`,
      stickerId,
    );
  const ofPage = (pageId: string) =>
    spaceIdsOf(sql, `SELECT spaces.id FROM pages ${joinPageSpace} WHERE pages.id = ?`, pageId);
  const ofGroup = (groupId: string) =>
    spaceIdsOf(
      sql,
      `SELECT spaces.id FROM text_groups JOIN pages ON pages.id = text_groups.page_id
       ${joinPageSpace} WHERE text_groups.id = ?`,
      groupId,
    );
  const ofBlock = (blockId: string) =>
    spaceIdsOf(
      sql,
      `SELECT spaces.id FROM text_blocks JOIN text_groups ON text_groups.id = text_blocks.group_id
       JOIN pages ON pages.id = text_groups.page_id ${joinPageSpace} WHERE text_blocks.id = ?`,
      blockId,
    );

  const ofStroke = (strokeId: string) =>
    spaceIdsOf(
      sql,
      `SELECT spaces.id FROM strokes JOIN pages ON pages.id = strokes.page_id ${joinPageSpace}
       WHERE strokes.id = ?`,
      strokeId,
    );

  switch (change.case) {
    case undefined:
    case "spaceCreate":
    case "spaceSetArchived":
      return [];
    case "spaceRename":
      return [change.value.spaceId];
    case "pageCreate": {
      const { kind, spaceId, itemId } = change.value;
      if (kind === PageKind.SPACE) return [spaceId];
      return kind === PageKind.ITEM ? ofItem(itemId) : [];
    }
    case "itemCreate":
      return [change.value.spaceId];
    case "itemMove":
      return [...ofItem(change.value.itemId), change.value.spaceId];
    case "itemSetParent":
      return [...ofItem(change.value.itemId), ...ofItem(change.value.parentId)];
    case "itemSetTitle":
    case "itemSetDescription":
    case "itemSetDate":
    case "itemSetTime":
    case "itemSetRepeat":
    case "itemDelete":
    case "taskTick":
    case "taskUntick":
    case "eventSetTime":
      return ofItem(change.value.itemId);
    case "stickerPlace":
      return [...ofItem(change.value.itemId), ...ofPage(change.value.pageId)];
    case "stickerMove":
    case "stickerRemove":
      return ofSticker(change.value.stickerId);
    case "textGroupCreate":
      return ofPage(change.value.pageId);
    case "textGroupMove":
    case "textGroupResize":
    case "textGroupDelete":
    case "textBlockCreate":
      return ofGroup(change.value.groupId);
    case "textBlockEdit":
    case "textBlockDelete":
      return ofBlock(change.value.blockId);
    case "textBlockMove":
      return [...ofBlock(change.value.blockId), ...ofGroup(change.value.groupId)];
    case "strokeAdd":
      return ofPage(change.value.pageId);
    case "strokeErase":
      return change.value.strokeIds.flatMap(ofStroke);
    default:
      return change satisfies never;
  }
}

function spaceIdsOf(sql: SqlStorage, query: string, id: string): string[] {
  return sql
    .exec<{ id: string | null }>(query, id)
    .toArray()
    .flatMap((row) => (row.id === null ? [] : [row.id]));
}

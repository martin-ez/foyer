import { timestampMs } from "@bufbuild/protobuf/wkt";
import type { TextBlock, TextGroup } from "@foyer/shared/gen/foyer/text/v1/text_pb";

/** A group's blocks, in their order, with equal orders settled by id. */
export function blocksIn(groupId: string, blocks: ReadonlyMap<string, TextBlock>): TextBlock[] {
  return [...blocks.values()]
    .filter((block) => block.groupId === groupId)
    .sort((a, b) => compare(a.order, b.order) || compare(a.id, b.id));
}

/** The text groups on a page, bottom first: in the order they were made or last moved, with equal
 *  times settled by id. */
export function groupsOn(pageId: string, groups: ReadonlyMap<string, TextGroup>): TextGroup[] {
  const placedAt = ({ placedAt }: TextGroup) => (placedAt ? timestampMs(placedAt) : 0);
  return [...groups.values()]
    .filter((group) => group.pageId === pageId)
    .sort((a, b) => placedAt(a) - placedAt(b) || compare(a.id, b.id));
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

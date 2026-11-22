import { timestampMs } from "@bufbuild/protobuf/wkt";
import {
  type PageSize,
  pageMargin,
  plainTextOf,
  readBlockMarkdown,
  type TextBlockContent,
} from "@foyer/shared";
import type { TextBlock, TextGroup } from "@foyer/shared/gen/foyer/text/v1/text_pb";
import type { Point } from "../page/sheet-camera";

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

/** What marks each block of a group as a list item: "•" for a bulleted one, its number for a
 *  numbered one, counted along the items at its level since the list began, or null. */
export function listMarkers(blocks: readonly TextBlockContent[]): (string | null)[] {
  return blocks.map((block, index) => {
    if (block.kind === "bulleted") return "•";
    if (block.kind !== "numbered") return null;
    let number = 1;
    for (let before = index - 1; before >= 0; before -= 1) {
      const earlier = blocks[before];
      if (!earlier || (earlier.kind !== "bulleted" && earlier.kind !== "numbered")) break;
      if (earlier.indent > block.indent) continue;
      if (earlier.indent < block.indent || earlier.kind !== "numbered") break;
      number += 1;
    }
    return `${number}.`;
  });
}

/** A group's text as a screen reader reads it: its blocks, one a line, list items with their
 *  markers. */
export function describeText(blocks: readonly TextBlock[]): string {
  const contents = blocks.map(({ markdown }) => readBlockMarkdown(markdown));
  const markers = listMarkers(contents);
  return contents
    .map((content, index) => {
      const marker = markers[index];
      const text = plainTextOf(content.runs);
      return marker ? `${marker} ${text}` : text;
    })
    .join("\n");
}

/** The widest a new text group is, in points. */
export const newGroupWidth = 320;

/** Where a new text group goes when someone taps a page to put it there, and how wide it is: at the
 *  tap, moved left if it would run off the page's right margin, as wide as fits up to
 *  `newGroupWidth`. */
export function newGroupSpot(tap: Point, page: PageSize): { at: Point; width: number } {
  const width = Math.max(Math.min(newGroupWidth, page.width - 2 * pageMargin), 1);
  const x = Math.max(0, Math.min(tap.x, page.width - pageMargin - width));
  const y = Math.max(0, Math.min(tap.y, page.height));
  return { at: { x, y }, width };
}

/** The group nearest below another on its page, whose top is lower, which joining appends to it,
 *  or null. */
export function groupBelow(group: TextGroup, groups: readonly TextGroup[]): TextGroup | null {
  const below = groups
    .filter(({ id, pageId, y }) => id !== group.id && pageId === group.pageId && y > group.y)
    .sort((a, b) => a.y - b.y || Math.abs(a.x - group.x) - Math.abs(b.x - group.x));
  return below[0] ?? null;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

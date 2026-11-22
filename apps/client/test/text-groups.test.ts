import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import { a4Portrait, pageMargin, readBlockMarkdown } from "@foyer/shared";
import type { TextBlock, TextGroup } from "@foyer/shared/gen/foyer/text/v1/text_pb";
import { describe, expect, it } from "vitest";
import {
  blocksIn,
  describeText,
  groupBelow,
  groupsOn,
  listMarkers,
  newGroupSpot,
  newGroupWidth,
} from "../src/text/text-groups";

function group(id: string, values: Partial<TextGroup> = {}): TextGroup {
  return { id, pageId: "day:2026-11-21", x: 40, y: 40, width: 300, ...values } as TextGroup;
}

function block(id: string, order: string, markdown: string, groupId = "g"): TextBlock {
  return { id, groupId, order, markdown } as TextBlock;
}

const markersOf = (...markdown: string[]) => listMarkers(markdown.map(readBlockMarkdown));

describe("blocksIn", () => {
  it("puts a group's blocks in their order, settling equal orders by id", () => {
    const blocks = new Map(
      [
        block("c", "k", "C"),
        block("b", "V", "B"),
        block("a", "k", "A"),
        block("x", "a", "X", "h"),
      ].map((each) => [each.id, each]),
    );
    expect(blocksIn("g", blocks).map(({ id }) => id)).toEqual(["b", "a", "c"]);
  });
});

describe("groupsOn", () => {
  it("stacks a page's groups by when they were placed, settling equal times by id", () => {
    const groups = new Map(
      [
        group("b", { placedAt: timestampFromMs(1) }),
        group("c", { placedAt: timestampFromMs(2) }),
        group("a", { placedAt: timestampFromMs(1) }),
        group("x", { pageId: "day:2026-11-22" }),
      ].map((each) => [each.id, each]),
    );
    expect(groupsOn("day:2026-11-21", groups).map(({ id }) => id)).toEqual(["a", "b", "c"]);
  });
});

describe("listMarkers", () => {
  it("marks bulleted items with a bullet and numbers numbered ones along their level", () => {
    expect(
      markersOf(
        "# List",
        "1. One",
        "  - Nested",
        "  1. Nested one",
        "  1. Nested two",
        "1. Two",
        "Text",
        "1. One again",
      ),
    ).toEqual([null, "1.", "•", "1.", "2.", "2.", null, "1."]);
  });

  it("starts numbering again after a bulleted item at the same level", () => {
    expect(markersOf("1. One", "- Bullet", "1. One again")).toEqual(["1.", "•", "1."]);
  });
});

describe("describeText", () => {
  it("reads a group's blocks one a line, with list markers and without styles", () => {
    const blocks = [
      block("a", "V", "# Shopping"),
      block("b", "k", "- **Oat** milk"),
      block("c", "l", "1. Bread"),
    ];
    expect(describeText(blocks)).toBe("Shopping\n• Oat milk\n1. Bread");
  });
});

describe("newGroupSpot", () => {
  it("puts a new group at the tap, as wide as it can be up to its width", () => {
    expect(newGroupSpot({ x: 50, y: 120 }, a4Portrait)).toEqual({
      at: { x: 50, y: 120 },
      width: newGroupWidth,
    });
  });

  it("moves it left when it would run past the page's right margin", () => {
    const { at } = newGroupSpot({ x: 500, y: 120 }, a4Portrait);
    expect(at.x).toBe(a4Portrait.width - pageMargin - newGroupWidth);
  });
});

describe("groupBelow", () => {
  it("finds the nearest group below on the same page", () => {
    const top = group("top", { y: 40 });
    const groups = [
      top,
      group("far", { y: 400 }),
      group("near", { y: 200 }),
      group("above", { y: 10 }),
      group("other", { y: 100, pageId: "day:2026-11-22" }),
    ];
    expect(groupBelow(top, groups)?.id).toBe("near");
    expect(groupBelow(group("far", { y: 400 }), groups)).toBe(null);
  });
});

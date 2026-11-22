import { a4Portrait } from "@foyer/shared";
import type { TextBlock, TextGroup } from "@foyer/shared/gen/foyer/text/v1/text_pb";
import { describe, expect, it } from "vitest";
import { PageDrawing } from "../src/page/page-drawing";
import { TextDrawing } from "../src/text/text-drawing";
import { hasEmoji, indentStep, layOutGroup, markerWidth } from "../src/text/text-layout";
import { expectToMatchGoldenImage } from "./golden-image";
import { textFonts } from "./text-fonts";

const { Skia, fonts } = textFonts();

function group(id: string, values: Partial<TextGroup> = {}): TextGroup {
  return { id, pageId: "day:2026-11-21", x: 40, y: 40, width: 300, ...values } as TextGroup;
}

function blocks(...markdown: string[]): TextBlock[] {
  return markdown.map((each, index) => ({ id: `b${index}`, markdown: each }) as TextBlock);
}

const shopping = blocks(
  "# Saturday",
  "Get **oat** milk, *not* the ***dairy*** one 🧺",
  "- Bread",
  "  - Sourdough, if they have it, or else a seeded loaf from the market",
  "1. Call the bank",
  "1. Book the plumber 🔧",
  "### Later",
);

describe("layOutGroup", () => {
  it("stacks blocks from the group's top, each below the last", () => {
    const laidOut = layOutGroup(Skia, fonts, group("g"), shopping);
    const tops = laidOut.blocks.map(({ top }) => top);
    expect(tops[0]).toBe(0);
    for (let index = 1; index < tops.length; index += 1) {
      const above = laidOut.blocks[index - 1];
      expect(tops[index]).toBeGreaterThan((above?.top ?? 0) + (above?.height ?? 0));
    }
    const last = laidOut.blocks.at(-1);
    expect(laidOut.height).toBe((last?.top ?? 0) + (last?.height ?? 0));
    expect(laidOut.text).toContain("• Sourdough");
  });

  it("indents list items by their level, with room for their marker", () => {
    const laidOut = layOutGroup(Skia, fonts, group("g"), shopping);
    expect(laidOut.blocks.map(({ left }) => left)).toEqual([
      0,
      0,
      markerWidth,
      indentStep + markerWidth,
      markerWidth,
      markerWidth,
      0,
    ]);
    expect(laidOut.blocks[3]?.width).toBe(300 - indentStep - markerWidth);
  });

  it("wraps text within the group's width, so a narrower group is taller", () => {
    const wide = layOutGroup(Skia, fonts, group("g", { width: 400 }), shopping);
    const narrow = layOutGroup(Skia, fonts, group("g", { width: 160 }), shopping);
    expect(narrow.height).toBeGreaterThan(wide.height);
  });

  it("gives an empty block a line's height", () => {
    const laidOut = layOutGroup(Skia, fonts, group("g"), blocks(""));
    expect(laidOut.height).toBeGreaterThan(10);
  });
});

describe("hasEmoji", () => {
  it("finds emoji, and only emoji", () => {
    expect(hasEmoji("Basket 🧺")).toBe(true);
    expect(hasEmoji("Café, 1–2 × 3")).toBe(false);
  });
});

describe("TextDrawing", () => {
  const size = { width: Math.ceil(a4Portrait.width), height: Math.ceil(a4Portrait.height) };

  it("draws a page's text groups in their fonts, with emoji in colour, marking one cut off at the bottom", async () => {
    const groups = [
      layOutGroup(Skia, fonts, group("a"), shopping),
      layOutGroup(
        Skia,
        fonts,
        group("b", { x: 340, y: 60, width: 200 }),
        blocks("## Notes", "Short"),
      ),
      layOutGroup(
        Skia,
        fonts,
        group("c", { x: 60, y: 805, width: 240 }),
        blocks(
          "A long paragraph near the bottom of the page, which runs past its edge and is cut off there.",
        ),
      ),
    ];
    const drawing = (
      <PageDrawing size={a4Portrait}>
        <TextDrawing groups={groups} page={a4Portrait} />
      </PageDrawing>
    );
    await expectToMatchGoldenImage("day-page-text", drawing, size);
  });
});

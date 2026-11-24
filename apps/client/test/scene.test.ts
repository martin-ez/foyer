import { create } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import { a4Portrait, encodeSamples } from "@foyer/shared";
import { Input, StrokeSchema, Tool } from "@foyer/shared/gen/foyer/ink/v1/ink_pb";
import type { Item } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import { PageKind, PageSchema } from "@foyer/shared/gen/foyer/page/v1/page_pb";
import { StickerKind, StickerSchema } from "@foyer/shared/gen/foyer/sticker/v1/sticker_pb";
import { describe, expect, it } from "vitest";
import { sceneOf } from "../src/page/scene";

const day = { kind: "day", date: "2026-11-24" } as const;
const dayId = "day:2026-11-24";
const task = { id: "019a8f4e-5c00-7000-8000-0000000000c1", title: "Buy milk" } as Item;

function sticker(id: string, itemId: string, placedAt: number, pageId = dayId) {
  return create(StickerSchema, {
    id,
    pageId,
    itemId,
    kind: StickerKind.TASK,
    x: 40,
    y: 60.5,
    placedAt: timestampFromMs(placedAt),
  });
}

function stroke(id: string, drawnAt: number, pageId = dayId) {
  return create(StrokeSchema, {
    id,
    pageId,
    drawnAt: timestampFromMs(drawnAt),
    input: Input.PENCIL,
    tool: Tool.MONOLINE,
    colour: 0x1f5fd6,
    size: 2,
    samples: encodeSamples({ x: [10, 30, 20], y: [50, 40, 90], time: [0, 8, 16] }),
  });
}

function state(
  stickers: ReturnType<typeof sticker>[] = [],
  items: Item[] = [],
  strokes: ReturnType<typeof stroke>[] = [],
) {
  return {
    pages: new Map(),
    items: new Map(items.map((item) => [item.id, item])),
    stickers: new Map(stickers.map((placed) => [placed.id, placed])),
    strokes: new Map(strokes.map((drawn) => [drawn.id, drawn])),
  };
}

describe("sceneOf", () => {
  it("says which page is open, of what kind and size", () => {
    expect(sceneOf(day, state()).page).toEqual({ id: dayId, kind: "day", ...a4Portrait });
  });

  it("gives the size a page was made with", () => {
    const made = create(PageSchema, { id: dayId, kind: PageKind.DAY, width: 500, height: 700 });
    const known = { ...state(), pages: new Map([[dayId, made]]) };

    expect(sceneOf(day, known).page).toMatchObject({ width: 500, height: 700 });
  });

  it("lists the page's stickers in the order they were placed, and which are hidden", () => {
    const later = sticker("b", task.id, 2_000);
    const earlier = sticker("a", "019a8f4e-5c00-7000-8000-0000000000c9", 1_000);
    const elsewhere = sticker("c", task.id, 500, "day:2026-11-25");

    const { stickers } = sceneOf(day, state([later, earlier, elsewhere], [task]));

    expect(stickers).toEqual([
      { id: "a", kind: "task", itemId: earlier.itemId, x: 40, y: 60.5, hidden: true },
      { id: "b", kind: "task", itemId: task.id, x: 40, y: 60.5, hidden: false },
    ]);
  });

  it("lists the page's strokes in the order they were drawn, with their brush, box and number of samples", () => {
    const drawn = [stroke("second", 2_000), stroke("first", 1_000), stroke("elsewhere", 0, "x")];

    const { strokes } = sceneOf(day, state([], [], drawn));

    expect(strokes.map(({ id }) => id)).toEqual(["first", "second"]);
    expect(strokes[0]).toEqual({
      id: "first",
      input: "pencil",
      brush: { tool: "monoline", colour: 0x1f5fd6, size: 2 },
      bounds: { x: 10, y: 40, width: 20, height: 50 },
      samples: 3,
    });
  });
});

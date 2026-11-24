import { decodeSamples } from "@foyer/shared";
import { Input, type Stroke, Tool } from "@foyer/shared/gen/foyer/ink/v1/ink_pb";
import type { Item } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import type { Page } from "@foyer/shared/gen/foyer/page/v1/page_pb";
import { type Sticker, StickerKind } from "@foyer/shared/gen/foyer/sticker/v1/sticker_pb";
import { type OpenPage, pageIdOf, sizeOf } from "./open-page";

/** A box on a page, in its points from its top-left corner. */
export type SceneBox = { x: number; y: number; width: number; height: number };

/** What's on the open page, as checks read it in development builds. */
export type Scene = {
  page: { id: string; kind: OpenPage["kind"]; width: number; height: number };
  stickers: {
    id: string;
    kind: string;
    itemId: string;
    x: number;
    y: number;
    /** Whether its contents are hidden, because the member can't see its item. */
    hidden: boolean;
  }[];
  strokes: {
    id: string;
    input: string;
    brush: { tool: string; colour: number; size: number };
    /** The box its samples fill, leaving out the brush's width. */
    bounds: SceneBox;
    samples: number;
  }[];
};

/** What's on a page: its stickers in the order they were placed, and its strokes in the order they
 *  were drawn. */
export function sceneOf(
  page: OpenPage,
  state: {
    pages: ReadonlyMap<string, Page>;
    items: ReadonlyMap<string, Item>;
    stickers: ReadonlyMap<string, Sticker>;
    strokes: ReadonlyMap<string, Stroke>;
  },
): Scene {
  const id = pageIdOf(page);
  const placedAt = ({ placedAt }: Sticker) => Number(placedAt?.seconds ?? 0n) + nanos(placedAt);
  const drawnAt = ({ drawnAt }: Stroke) => Number(drawnAt?.seconds ?? 0n) + nanos(drawnAt);
  return {
    page: { id, kind: page.kind, ...sizeOf(page, state.pages) },
    stickers: [...state.stickers.values()]
      .filter((sticker) => sticker.pageId === id)
      .sort((a, b) => placedAt(a) - placedAt(b) || a.id.localeCompare(b.id))
      .map((sticker) => ({
        id: sticker.id,
        kind: nameOf(StickerKind, sticker.kind),
        itemId: sticker.itemId,
        x: sticker.x,
        y: sticker.y,
        hidden: !state.items.has(sticker.itemId),
      })),
    strokes: [...state.strokes.values()]
      .filter((stroke) => stroke.pageId === id)
      .sort((a, b) => drawnAt(a) - drawnAt(b) || a.id.localeCompare(b.id))
      .map((stroke) => {
        const { x, y } = decodeSamples(stroke.samples);
        return {
          id: stroke.id,
          input: nameOf(Input, stroke.input),
          brush: { tool: nameOf(Tool, stroke.tool), colour: stroke.colour, size: stroke.size },
          bounds: boundsOf(x, y),
          samples: x.length,
        };
      }),
  };
}

function boundsOf(xs: readonly number[], ys: readonly number[]): SceneBox {
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function nanos(time: { nanos: number } | undefined): number {
  return (time?.nanos ?? 0) / 1e9;
}

function nameOf(names: Record<string, string | number>, value: number): string {
  const name = names[value];
  return typeof name === "string" ? name.toLowerCase() : "unspecified";
}

import { timestampMs } from "@bufbuild/protobuf/wkt";
import { type PageSize, spacePageId } from "@foyer/shared";
import { type Page, PageKind } from "@foyer/shared/gen/foyer/page/v1/page_pb";
import { type Sticker, StickerKind } from "@foyer/shared/gen/foyer/sticker/v1/sticker_pb";
import type { Point } from "./sheet-camera";

/** The size of a task's sticker, in points: room for a checkbox and two lines of its title. */
export const taskStickerSize: PageSize = { width: 240, height: 48 };

/** The size an app draws a sticker of a kind it doesn't know yet, as a plain outline. */
export const unknownStickerSize: PageSize = { width: 160, height: 48 };

/** The space automatic placement leaves between stickers and the page's edges, in points. */
export const pageMargin = 36;

/** The space automatic placement leaves between one sticker and the next, in points. */
export const stickerGap = 12;

/** The size of a sticker of a kind, in points. Each kind has a fixed size, the same on every page
 *  for now. */
export function stickerSize(kind: StickerKind): PageSize {
  return kind === StickerKind.TASK ? taskStickerSize : unknownStickerSize;
}

/** Stickers in the order they stack, bottom first: by when they were placed or last moved, with
 *  equal times settled by id. */
export function stackOrder(stickers: Iterable<Sticker>): Sticker[] {
  return [...stickers].sort(
    (a, b) => placedAt(a) - placedAt(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** The stickers on a page, in the order they stack, bottom first. */
export function stickersOn(pageId: string, stickers: Iterable<Sticker>): Sticker[] {
  return stackOrder([...stickers].filter((sticker) => sticker.pageId === pageId));
}

/** The next free spot for a sticker of `size` on a page: at the left margin, below the lowest
 *  sticker already there, or at the top when there's none. Null when it wouldn't fit above the
 *  bottom margin. */
export function nextFreeSpot(
  page: PageSize,
  stickers: readonly Pick<Sticker, "y" | "kind">[],
  size: PageSize,
): Point | null {
  const lowest = Math.max(
    pageMargin - stickerGap,
    ...stickers.map(({ y, kind }) => y + stickerSize(kind).height),
  );
  const at = { x: pageMargin, y: lowest + stickerGap };
  return at.y + size.height <= page.height - pageMargin ? at : null;
}

/** The number of a space's newest page the device knows, or 1 when none has been made. */
export function newestSpacePage(spaceId: string, pages: ReadonlyMap<string, Page>): number {
  let newest = 1;
  for (const page of pages.values()) {
    if (page.kind === PageKind.SPACE && page.spaceId === spaceId && page.number > newest) {
      newest = page.number;
    }
  }
  return newest;
}

/** Where a new sticker of `kind` goes in a space: the next free spot on its newest page, or the top
 *  of the page after it when it's full. Says whether that page still has to be created. */
export function spotInSpace(
  spaceId: string,
  kind: StickerKind,
  pages: ReadonlyMap<string, Page>,
  stickers: Iterable<Sticker>,
  newPageSize: PageSize,
): { number: number; pageId: string; at: Point; isNewPage: boolean } {
  const size = stickerSize(kind);
  const newest = newestSpacePage(spaceId, pages);
  const pageId = spacePageId(spaceId, newest);
  const page = pages.get(pageId);
  const spot = nextFreeSpot(page ?? newPageSize, stickersOn(pageId, stickers), size);
  if (spot) return { number: newest, pageId, at: spot, isNewPage: !page };
  const next = spacePageId(spaceId, newest + 1);
  const top = nextFreeSpot(newPageSize, [], size) ?? { x: 0, y: 0 };
  return { number: newest + 1, pageId: next, at: top, isNewPage: true };
}

/** Where a sticker of `size` ends up when dragged to `at`: as close to it as keeps the whole sticker
 *  on the page. */
export function keepOnPage(at: Point, size: PageSize, page: PageSize): Point {
  return {
    x: Math.min(Math.max(at.x, 0), Math.max(page.width - size.width, 0)),
    y: Math.min(Math.max(at.y, 0), Math.max(page.height - size.height, 0)),
  };
}

function placedAt(sticker: Sticker): number {
  return sticker.placedAt ? timestampMs(sticker.placedAt) : 0;
}

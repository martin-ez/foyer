import { timestampMs } from "@bufbuild/protobuf/wkt";
import {
  type PageSize,
  type StickerKindName,
  type StickerOnPage,
  spacePageId,
  stickerSizeOn,
  stickerSpotInSpace,
  stickerSpotOnPage,
} from "@foyer/shared";
import { type Page, PageKind } from "@foyer/shared/gen/foyer/page/v1/page_pb";
import { type Sticker, StickerKind } from "@foyer/shared/gen/foyer/sticker/v1/sticker_pb";
import type { Point } from "./sheet-camera";

const kindNames: Partial<Record<StickerKind, StickerKindName>> = {
  [StickerKind.TASK]: "task",
  [StickerKind.EVENT]: "event",
  [StickerKind.NOTE]: "note",
};

/** The size of a sticker of a kind on a page, in points. Each kind has a fixed size, and every
 *  sticker on a calendar page has the calendar's. */
export function stickerSize(kind: StickerKind, pageId: string): PageSize {
  return stickerSizeOn(pageId, kindNames[kind] ?? null);
}

/** The stickers on a page, in the order they stack, bottom first: by when they were placed or last
 *  moved, with equal times settled by id. */
export function stickersOn(pageId: string, stickers: Iterable<Sticker>): Sticker[] {
  return [...stickers]
    .filter((sticker) => sticker.pageId === pageId)
    .sort((a, b) => placedAt(a) - placedAt(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
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
  const number = newestSpacePage(spaceId, pages);
  const page = pages.get(spacePageId(spaceId, number));
  const newest = page ? { number, size: page, stickers: onPage(page.id, stickers) } : null;
  const spot = stickerSpotInSpace(newest, kindNames[kind] ?? null, newPageSize);
  return { ...spot, pageId: spacePageId(spaceId, spot.number) };
}

/** Where a new sticker of `kind` goes on a page such as a task's body page: the next free spot
 *  below the last one, or the lowest spot on it when it's full. Says whether the page still has to
 *  be created. */
export function spotOnPage(
  pageId: string,
  kind: StickerKind,
  pages: ReadonlyMap<string, Page>,
  stickers: Iterable<Sticker>,
  newPageSize: PageSize,
): { at: Point; isNewPage: boolean } {
  const page = pages.get(pageId) ?? newPageSize;
  const at = stickerSpotOnPage(page, onPage(pageId, stickers), kindNames[kind] ?? null);
  return { at, isNewPage: !pages.has(pageId) };
}

/** Where a sticker of `size` ends up when dragged to `at`: as close to it as keeps the whole sticker
 *  on the page. */
export function keepOnPage(at: Point, size: PageSize, page: PageSize): Point {
  return {
    x: Math.min(Math.max(at.x, 0), Math.max(page.width - size.width, 0)),
    y: Math.min(Math.max(at.y, 0), Math.max(page.height - size.height, 0)),
  };
}

function onPage(pageId: string, stickers: Iterable<Sticker>): StickerOnPage[] {
  return stickersOn(pageId, stickers).map(({ y, kind }) => ({ y, kind: kindNames[kind] ?? null }));
}

function placedAt(sticker: Sticker): number {
  return sticker.placedAt ? timestampMs(sticker.placedAt) : 0;
}

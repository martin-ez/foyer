import type { PageSize } from "./page";

/** What a sticker links to, which sets its size: a task, an event or a note. */
export type StickerKindName = "task" | "event" | "note";

/** The size of a task's sticker, in points: room for a checkbox and two lines of its title. */
export const taskStickerSize: PageSize = { width: 240, height: 48 };

/** The size of a sticker whose kind has no size of its own, drawn as a plain outline. */
export const unknownStickerSize: PageSize = { width: 160, height: 48 };

/** The space automatic placement leaves between stickers and the page's edges, in points. */
export const pageMargin = 36;

/** The space automatic placement leaves between one sticker and the next, in points. */
export const stickerGap = 12;

/** The size of a sticker of a kind, in points, the same on every page. A kind without a size of
 *  its own yet, or one an app doesn't know (null), gets `unknownStickerSize`. */
export function stickerSizeOf(kind: StickerKindName | null): PageSize {
  return kind === "task" ? taskStickerSize : unknownStickerSize;
}

/** A point on a page, in points from its top-left corner. */
export type PagePoint = { x: number; y: number };

/** A sticker already on a page, as placing the next one needs it: its top edge and its kind. */
export type StickerOnPage = { y: number; kind: StickerKindName | null };

/** The next free spot on a page for a sticker of `kind`: at the left margin, below the lowest
 *  sticker on it, or null when it wouldn't fit above the bottom margin. */
export function nextStickerSpot(
  page: PageSize,
  stickers: readonly StickerOnPage[],
  kind: StickerKindName | null,
): PagePoint | null {
  const lowest = Math.max(
    pageMargin - stickerGap,
    ...stickers.map(({ y, kind }) => y + stickerSizeOf(kind).height),
  );
  const at = { x: pageMargin, y: lowest + stickerGap };
  return at.y + stickerSizeOf(kind).height <= page.height - pageMargin ? at : null;
}

/** Where a new sticker of `kind` goes on a page that doesn't continue on another, such as a task's
 *  body page: the next free spot below the last one, or the lowest spot on it when it's full. */
export function stickerSpotOnPage(
  page: PageSize,
  stickers: readonly StickerOnPage[],
  kind: StickerKindName | null,
): PagePoint {
  const lowest = Math.max(page.height - pageMargin - stickerSizeOf(kind).height, 0);
  return nextStickerSpot(page, stickers, kind) ?? { x: pageMargin, y: lowest };
}

/** A space's newest page, as placing a sticker needs it: its number, its size and what's on it. */
export type NewestSpacePage = {
  number: number;
  size: PageSize;
  stickers: readonly StickerOnPage[];
};

/** Where a new sticker of `kind` goes in a space: the next free spot on its newest page, or the
 *  top of the page after it when that one is full, or of page 1 when the space has no page yet.
 *  Says whether that page still has to be created, at `newPageSize`. */
export function stickerSpotInSpace(
  newest: NewestSpacePage | null,
  kind: StickerKindName | null,
  newPageSize: PageSize,
): { number: number; at: PagePoint; isNewPage: boolean } {
  const spot = newest && nextStickerSpot(newest.size, newest.stickers, kind);
  if (newest && spot) return { number: newest.number, at: spot, isNewPage: false };
  const top = nextStickerSpot(newPageSize, [], kind) ?? { x: 0, y: 0 };
  return { number: (newest?.number ?? 0) + 1, at: top, isNewPage: true };
}

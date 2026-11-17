import { create } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import { a4Portrait, spacePageId } from "@foyer/shared";
import { PageKind, PageSchema } from "@foyer/shared/gen/foyer/page/v1/page_pb";
import { StickerKind, StickerSchema } from "@foyer/shared/gen/foyer/sticker/v1/sticker_pb";
import { describe, expect, it } from "vitest";
import {
  keepOnPage,
  newestSpacePage,
  nextFreeSpot,
  pageMargin,
  spotInSpace,
  stackOrder,
  stickerGap,
  stickerSize,
  taskStickerSize,
  unknownStickerSize,
} from "../src/page/sticker-layout";

const spaceId = "019a8f4e-5c00-7000-8000-0000000000a1";

function sticker(id: string, fields: { y?: number; placedAt?: number; pageId?: string } = {}) {
  const { placedAt = 0, pageId = spacePageId(spaceId, 1), y = pageMargin } = fields;
  return create(StickerSchema, {
    id,
    pageId,
    x: pageMargin,
    y,
    kind: StickerKind.TASK,
    placedAt: timestampFromMs(placedAt),
  });
}

function spacePage(number: number) {
  const id = spacePageId(spaceId, number);
  return create(PageSchema, { id, kind: PageKind.SPACE, spaceId, number, ...a4Portrait });
}

describe("stickerSize", () => {
  it("gives each kind its size, and a kind the app doesn't know a default one", () => {
    expect(stickerSize(StickerKind.TASK)).toEqual(taskStickerSize);
    expect(stickerSize(99 as StickerKind)).toEqual(unknownStickerSize);
  });
});

describe("stackOrder", () => {
  it("stacks stickers by when they were placed or moved, bottom first, settling equal times by id", () => {
    const stickers = [
      sticker("019a8f4e-0000-7000-8000-000000000003", { placedAt: 2000 }),
      sticker("019a8f4e-0000-7000-8000-000000000002", { placedAt: 1000 }),
      sticker("019a8f4e-0000-7000-8000-000000000001", { placedAt: 1000 }),
    ];

    expect(stackOrder(stickers).map(({ id }) => id.slice(-1))).toEqual(["1", "2", "3"]);
  });
});

describe("nextFreeSpot", () => {
  it("starts at the top-left margin of an empty page", () => {
    expect(nextFreeSpot(a4Portrait, [], taskStickerSize)).toEqual({ x: pageMargin, y: pageMargin });
  });

  it("goes below the lowest sticker on the page", () => {
    const stickers = [sticker("a", { y: 300 }), sticker("b", { y: 100 })];

    expect(nextFreeSpot(a4Portrait, stickers, taskStickerSize)).toEqual({
      x: pageMargin,
      y: 300 + taskStickerSize.height + stickerGap,
    });
  });

  it("finds nothing when the sticker wouldn't fit above the bottom margin", () => {
    const lastThatFits = a4Portrait.height - pageMargin - taskStickerSize.height;
    const y = lastThatFits - stickerGap - taskStickerSize.height;

    expect(nextFreeSpot(a4Portrait, [sticker("a", { y })], taskStickerSize)).toEqual({
      x: pageMargin,
      y: lastThatFits,
    });
    expect(nextFreeSpot(a4Portrait, [sticker("a", { y: y + 1 })], taskStickerSize)).toBe(null);
  });
});

describe("newestSpacePage", () => {
  it("is the highest number among the space's pages, or 1 when it has none", () => {
    const pages = new Map(
      [spacePage(1), spacePage(3), spacePage(2)].map((page) => [page.id, page]),
    );

    expect(newestSpacePage(spaceId, pages)).toBe(3);
    expect(newestSpacePage("019a8f4e-5c00-7000-8000-0000000000a2", pages)).toBe(1);
  });
});

describe("spotInSpace", () => {
  it("uses the newest page, creating it when the space has none", () => {
    expect(spotInSpace(spaceId, StickerKind.TASK, new Map(), [], a4Portrait)).toEqual({
      number: 1,
      pageId: spacePageId(spaceId, 1),
      at: { x: pageMargin, y: pageMargin },
      isNewPage: true,
    });
  });

  it("moves on to the next page when the newest is full", () => {
    const pages = new Map([[spacePageId(spaceId, 1), spacePage(1)]]);
    const full = [sticker("a", { y: a4Portrait.height - pageMargin - taskStickerSize.height })];

    expect(spotInSpace(spaceId, StickerKind.TASK, pages, full, a4Portrait)).toEqual({
      number: 2,
      pageId: spacePageId(spaceId, 2),
      at: { x: pageMargin, y: pageMargin },
      isNewPage: true,
    });
  });
});

describe("keepOnPage", () => {
  it("keeps the whole sticker on the page", () => {
    expect(keepOnPage({ x: -20, y: 900 }, taskStickerSize, a4Portrait)).toEqual({
      x: 0,
      y: a4Portrait.height - taskStickerSize.height,
    });
    expect(keepOnPage({ x: 100, y: 200 }, taskStickerSize, a4Portrait)).toEqual({ x: 100, y: 200 });
  });
});

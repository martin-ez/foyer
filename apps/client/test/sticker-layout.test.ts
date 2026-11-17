import { create } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import { a4Portrait, spacePageId } from "@foyer/shared";
import { PageKind, PageSchema } from "@foyer/shared/gen/foyer/page/v1/page_pb";
import { StickerKind, StickerSchema } from "@foyer/shared/gen/foyer/sticker/v1/sticker_pb";
import { describe, expect, it } from "vitest";
import {
  keepOnPage,
  newestSpacePage,
  pageMargin,
  spotInSpace,
  stickerGap,
  stickerSize,
  stickersOn,
  taskStickerSize,
  unknownStickerSize,
} from "../src/page/sticker-layout";

const spaceId = "019a8f4e-5c00-7000-8000-0000000000a1";
const firstPage = spacePageId(spaceId, 1);

function sticker(id: string, fields: { y?: number; placedAt?: number; pageId?: string } = {}) {
  const { placedAt = 0, pageId = firstPage, y = pageMargin } = fields;
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

const onlyFirstPage = new Map([[firstPage, spacePage(1)]]);

describe("stickerSize", () => {
  it("gives each kind its size, and a kind the app doesn't know a default one", () => {
    expect(stickerSize(StickerKind.TASK)).toEqual(taskStickerSize);
    expect(stickerSize(99 as StickerKind)).toEqual(unknownStickerSize);
  });
});

describe("stickersOn", () => {
  it("lists a page's stickers bottom first, by when they were placed or moved, settling equal times by id", () => {
    const stickers = [
      sticker("019a8f4e-0000-7000-8000-000000000003", { placedAt: 2000 }),
      sticker("019a8f4e-0000-7000-8000-000000000002", { placedAt: 1000 }),
      sticker("019a8f4e-0000-7000-8000-000000000001", { placedAt: 1000 }),
      sticker("019a8f4e-0000-7000-8000-000000000004", { pageId: spacePageId(spaceId, 2) }),
    ];

    expect(stickersOn(firstPage, stickers).map(({ id }) => id.slice(-1))).toEqual(["1", "2", "3"]);
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
  it("starts at the top-left margin of the first page, creating it when the space has none", () => {
    expect(spotInSpace(spaceId, StickerKind.TASK, new Map(), [], a4Portrait)).toEqual({
      number: 1,
      pageId: firstPage,
      at: { x: pageMargin, y: pageMargin },
      isNewPage: true,
    });
  });

  it("goes below the lowest sticker on the newest page", () => {
    const stickers = [sticker("a", { y: 300 }), sticker("b", { y: 100 })];

    expect(spotInSpace(spaceId, StickerKind.TASK, onlyFirstPage, stickers, a4Portrait)).toEqual({
      number: 1,
      pageId: firstPage,
      at: { x: pageMargin, y: 300 + taskStickerSize.height + stickerGap },
      isNewPage: false,
    });
  });

  it("uses the last spot that fits above the bottom margin", () => {
    const lastThatFits = a4Portrait.height - pageMargin - taskStickerSize.height;
    const above = [sticker("a", { y: lastThatFits - stickerGap - taskStickerSize.height })];

    const spot = spotInSpace(spaceId, StickerKind.TASK, onlyFirstPage, above, a4Portrait);

    expect(spot).toMatchObject({ number: 1, at: { x: pageMargin, y: lastThatFits } });
  });

  it("moves on to the top of the next page when the newest is full", () => {
    const full = [sticker("a", { y: a4Portrait.height - pageMargin - taskStickerSize.height })];

    expect(spotInSpace(spaceId, StickerKind.TASK, onlyFirstPage, full, a4Portrait)).toEqual({
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

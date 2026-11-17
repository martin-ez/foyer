import {
  a4Portrait,
  nextStickerSpot,
  pageMargin,
  stickerGap,
  stickerSizeOf,
  stickerSpotInSpace,
  taskStickerSize,
  unknownStickerSize,
} from "@foyer/shared";
import { describe, expect, it } from "vitest";

const top = { x: pageMargin, y: pageMargin };
const lastThatFits = a4Portrait.height - pageMargin - taskStickerSize.height;

describe("stickerSizeOf", () => {
  it("gives a task's sticker its size, and kinds without one a default size", () => {
    expect(stickerSizeOf("task")).toEqual(taskStickerSize);
    expect(stickerSizeOf("note")).toEqual(unknownStickerSize);
    expect(stickerSizeOf(null)).toEqual(unknownStickerSize);
  });
});

describe("nextStickerSpot", () => {
  it("starts at the top-left margin of an empty page", () => {
    expect(nextStickerSpot(a4Portrait, [], "task")).toEqual(top);
  });

  it("goes below the lowest sticker, whatever order they come in", () => {
    const stickers = [
      { y: 300, kind: "task" as const },
      { y: 400, kind: null },
      { y: 100, kind: "task" as const },
    ];

    expect(nextStickerSpot(a4Portrait, stickers, "task")).toEqual({
      x: pageMargin,
      y: 400 + unknownStickerSize.height + stickerGap,
    });
  });

  it("takes the last spot that fits above the bottom margin, and none below it", () => {
    const above = lastThatFits - stickerGap - taskStickerSize.height;

    expect(nextStickerSpot(a4Portrait, [{ y: above, kind: "task" }], "task")).toEqual({
      x: pageMargin,
      y: lastThatFits,
    });
    expect(nextStickerSpot(a4Portrait, [{ y: lastThatFits, kind: "task" }], "task")).toBeNull();
  });
});

describe("stickerSpotInSpace", () => {
  it("starts at the top of page 1, to be created, when the space has no page", () => {
    expect(stickerSpotInSpace(null, "task", a4Portrait)).toEqual({
      number: 1,
      at: top,
      isNewPage: true,
    });
  });

  it("goes in the next free spot on the newest page", () => {
    const newest = { number: 3, size: a4Portrait, stickers: [{ y: 100, kind: "task" as const }] };

    expect(stickerSpotInSpace(newest, "task", a4Portrait)).toEqual({
      number: 3,
      at: { x: pageMargin, y: 100 + taskStickerSize.height + stickerGap },
      isNewPage: false,
    });
  });

  it("moves on to the top of the next page, to be created, when the newest is full", () => {
    const newest = {
      number: 3,
      size: a4Portrait,
      stickers: [{ y: lastThatFits, kind: "task" as const }],
    };

    expect(stickerSpotInSpace(newest, "task", a4Portrait)).toEqual({
      number: 4,
      at: top,
      isNewPage: true,
    });
  });
});

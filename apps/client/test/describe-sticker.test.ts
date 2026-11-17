import { create } from "@bufbuild/protobuf";
import { ItemKind, ItemSchema } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import { StickerKind, StickerSchema } from "@foyer/shared/gen/foyer/sticker/v1/sticker_pb";
import { describe, expect, it } from "vitest";
import { describeSticker } from "../src/page/describe-sticker";

const task = create(ItemSchema, {
  id: "019a8f4e-5c00-7000-8000-0000000000c1",
  kind: ItemKind.TASK,
  title: "Buy milk",
});

function sticker(kind: StickerKind) {
  return create(StickerSchema, {
    id: "019a8f4e-5c00-7000-8000-0000000000d1",
    kind,
    itemId: task.id,
  });
}

describe("describeSticker", () => {
  it("names a task's sticker by its title", () => {
    expect(describeSticker(sticker(StickerKind.TASK), task)).toBe("Task: Buy milk");
  });

  it("hides the title of a task the member can't see, without calling it private", () => {
    expect(describeSticker(sticker(StickerKind.TASK), undefined)).toBe("Task, hidden");
  });

  it("calls a sticker of a kind the app can't draw yet a sticker", () => {
    expect(describeSticker(sticker(99 as StickerKind), undefined)).toBe("Sticker");
  });
});

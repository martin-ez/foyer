import { create } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
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

  it("says when a task repeats, and its next date", () => {
    const repeating = { ...task, repeat: "FREQ=WEEKLY;BYDAY=TU", date: "2026-11-24" };

    expect(describeSticker(sticker(StickerKind.TASK), repeating)).toBe(
      "Task: Buy milk, repeats, next on 2026-11-24",
    );
  });

  it("says a task's time", () => {
    const timed = { ...task, time: "19:30", date: "2026-11-24" };

    expect(describeSticker(sticker(StickerKind.TASK), timed, "en-US")).toBe(
      "Task: Buy milk, at 7:30 PM",
    );
    expect(describeSticker(sticker(StickerKind.TASK), timed, "en-GB")).toBe(
      "Task: Buy milk, at 19:30",
    );
  });

  it("hides the title of a task the member can't see, without calling it private", () => {
    expect(describeSticker(sticker(StickerKind.TASK), undefined)).toBe("Task, hidden");
  });

  it("names an event's sticker by its title, and hides it from a member who can't see it", () => {
    const event = { ...task, kind: ItemKind.EVENT, title: "Dinner" };

    expect(describeSticker(sticker(StickerKind.EVENT), event)).toBe("Event: Dinner");
    expect(describeSticker(sticker(StickerKind.EVENT), undefined)).toBe("Event, hidden");
  });

  it("says when an event with times starts and ends on the device's clock", () => {
    const startsAt = new Date(2026, 10, 20, 19, 0).getTime();
    const event = {
      ...task,
      kind: ItemKind.EVENT,
      title: "Dinner",
      startsAt: timestampFromMs(startsAt),
      endsAt: timestampFromMs(startsAt + 90 * 60_000),
    };

    expect(describeSticker(sticker(StickerKind.EVENT), event, "en-US")).toBe(
      "Event: Dinner, 7:00 PM to 8:30 PM",
    );
  });

  it("calls a sticker of a kind the app can't draw yet a sticker", () => {
    expect(describeSticker(sticker(99 as StickerKind), undefined)).toBe("Sticker");
  });
});

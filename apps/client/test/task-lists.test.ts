import { create } from "@bufbuild/protobuf";
import { spacePageId } from "@foyer/shared";
import { ItemKind, ItemSchema } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import { SpaceKind, SpaceSchema } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import { StickerKind, StickerSchema } from "@foyer/shared/gen/foyer/sticker/v1/sticker_pb";
import { CompletionSchema } from "@foyer/shared/gen/foyer/task/v1/task_pb";
import { describe, expect, it } from "vitest";
import { doneTasks, spaceList, todayList } from "../src/tasks/task-lists";

const inbox = create(SpaceSchema, {
  id: "019a8f4e-5c00-7000-8000-0000000000a1",
  kind: SpaceKind.INBOX,
});
const home = create(SpaceSchema, {
  id: "019a8f4e-5c00-7000-8000-0000000000a2",
  kind: SpaceKind.SHARED,
});

function task(id: string, spaceId: string, date = "") {
  return create(ItemSchema, { id, kind: ItemKind.TASK, spaceId, title: `Task ${id}`, date });
}

function sticker(itemId: string, spaceId: string, page: number, y: number, x = 36) {
  const pageId = spacePageId(spaceId, page);
  return create(StickerSchema, { id: `s${itemId}`, pageId, itemId, x, y, kind: StickerKind.TASK });
}

describe("spaceList", () => {
  it("lists a space's tasks page by page, top to bottom, then left to right", () => {
    const items = ["a", "b", "c", "d"].map((id) => task(id, inbox.id));
    const stickers = [
      sticker("a", inbox.id, 2, 36),
      sticker("b", inbox.id, 1, 300),
      sticker("c", inbox.id, 1, 100, 300),
      sticker("d", inbox.id, 1, 100, 36),
    ];

    expect(spaceList(inbox.id, items, stickers).map(({ id }) => id)).toEqual(["d", "c", "b", "a"]);
  });

  it("leaves out other spaces' tasks, and lists a task without a sticker on its space's pages last", () => {
    const items = [task("a", inbox.id), task("b", inbox.id), task("c", home.id)];
    const stickers = [sticker("b", inbox.id, 1, 36), sticker("a", home.id, 1, 36)];

    expect(spaceList(inbox.id, items, stickers).map(({ id }) => id)).toEqual(["b", "a"]);
  });
});

describe("todayList", () => {
  it("lists tasks dated today or earlier, overdue first, each group in space and list order", () => {
    const items = [
      task("a", home.id, "2026-11-17"),
      task("b", inbox.id, "2026-11-17"),
      task("c", home.id, "2026-11-10"),
      task("d", inbox.id, "2026-11-18"),
      task("e", inbox.id),
      task("f", inbox.id, "2026-11-16"),
    ];
    const stickers = ["a", "c"].map((id, index) => sticker(id, home.id, 1, 36 + index * 60));

    const listed = todayList("2026-11-17", [inbox, home], items, stickers, new Set());

    expect(listed.map(({ id }) => id)).toEqual(["f", "c", "b", "a"]);
  });

  it("leaves out tasks that are done", () => {
    const items = [task("a", inbox.id, "2026-11-17"), task("b", inbox.id, "2026-11-16")];

    const listed = todayList("2026-11-17", [inbox], items, [], new Set(["b"]));

    expect(listed.map(({ id }) => id)).toEqual(["a"]);
  });
});

describe("doneTasks", () => {
  const completion = (itemId: string, occurrence = "") =>
    create(CompletionSchema, { id: `c${itemId}${occurrence}`, itemId, occurrence });
  const tasks = (...items: ReturnType<typeof task>[]) =>
    new Map(items.map((item) => [item.id, item]));

  it("counts a task that doesn't repeat as done when it has a completion", () => {
    const items = tasks(task("a", inbox.id), task("b", inbox.id), task("c", inbox.id));

    const done = doneTasks(items, [completion("a"), completion("a"), completion("b")]);

    expect(done).toEqual(new Set(["a", "b"]));
  });

  it("counts a repeating task as done only when its current occurrence has a completion", () => {
    const repeating = (id: string, date: string) =>
      create(ItemSchema, { ...task(id, inbox.id, date), repeat: "FREQ=WEEKLY;BYDAY=TU" });
    const items = tasks(repeating("a", "2026-11-24"), repeating("b", "2026-11-17"));

    const done = doneTasks(items, [
      completion("a", "2026-11-17"),
      completion("a"),
      completion("b", "2026-11-17"),
    ]);

    expect(done).toEqual(new Set(["b"]));
  });

  it("counts a task that stopped repeating as open, whatever occurrences were ticked", () => {
    const items = tasks(task("a", inbox.id, "2026-11-24"));

    expect(doneTasks(items, [completion("a", "2026-11-17")])).toEqual(new Set());
  });

  it("leaves out completions of tasks the device doesn't hold", () => {
    expect(doneTasks(tasks(), [completion("a")])).toEqual(new Set());
  });
});

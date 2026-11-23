import { create } from "@bufbuild/protobuf";
import { itemPageId, spacePageId } from "@foyer/shared";
import { ItemKind, ItemSchema } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import { CalendarState, SpaceKind, SpaceSchema } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import { StickerKind, StickerSchema } from "@foyer/shared/gen/foyer/sticker/v1/sticker_pb";
import { CompletionSchema } from "@foyer/shared/gen/foyer/task/v1/task_pb";
import { describe, expect, it } from "vitest";
import {
  canMoveTo,
  doneTasks,
  isStickerDone,
  itemsUnder,
  openTasksUnder,
  spaceList,
  spaceTree,
  todayList,
} from "../src/tasks/task-lists";

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

describe("isStickerDone", () => {
  const completion = (itemId: string, occurrence = "") =>
    create(CompletionSchema, { id: `c${itemId}${occurrence}`, itemId, occurrence });
  const onDay = (itemId: string, occurrence: string) =>
    create(StickerSchema, {
      id: `s${itemId}${occurrence}`,
      pageId: `day:${occurrence}`,
      itemId,
      occurrence,
    });
  const bins = create(ItemSchema, {
    ...task("a", inbox.id, "2026-11-24"),
    repeat: "FREQ=WEEKLY;BYDAY=TU",
  });

  it("shows a repeating task's sticker as done on a day it was ticked, and open on its next date", () => {
    const completions = [completion("a", "2026-11-17")];

    expect(isStickerDone(onDay("a", "2026-11-17"), bins, completions)).toBe(true);
    expect(isStickerDone(onDay("a", "2026-11-24"), bins, completions)).toBe(false);
  });

  it("shows a repeating task's sticker on a space's page as done when its next date is ticked", () => {
    const onSpace = sticker("a", inbox.id, 1, 36);

    expect(isStickerDone(onSpace, bins, [completion("a", "2026-11-17")])).toBe(false);
    expect(isStickerDone(onSpace, bins, [completion("a", "2026-11-24")])).toBe(true);
  });

  it("shows every sticker of a task that doesn't repeat as done once it's ticked", () => {
    const once = task("b", inbox.id, "2026-11-20");

    expect(isStickerDone(onDay("b", "2026-11-20"), once, [completion("b")])).toBe(true);
    expect(isStickerDone(sticker("b", inbox.id, 1, 36), once, [completion("b")])).toBe(true);
    expect(isStickerDone(onDay("b", "2026-11-20"), once, [])).toBe(false);
  });

  it("never shows a sticker done when the member can't see its item, or it isn't a task", () => {
    const event = create(ItemSchema, { id: "e", kind: ItemKind.EVENT, title: "Dinner" });

    expect(
      isStickerDone(onDay("a", "2026-11-17"), undefined, [completion("a", "2026-11-17")]),
    ).toBe(false);
    expect(isStickerDone(onDay("e", "2026-11-20"), event, [completion("e")])).toBe(false);
  });
});

describe("spaceTree", () => {
  const under = (id: string, parentId: string, spaceId = inbox.id) =>
    create(ItemSchema, { ...task(id, spaceId), parentId });
  const onBody = (itemId: string, parentId: string, y: number) =>
    create(StickerSchema, {
      id: `s${itemId}`,
      pageId: itemPageId(parentId),
      itemId,
      x: 36,
      y,
      kind: StickerKind.TASK,
    });

  it("lists each task's children after it, in the order of their stickers on its body page", () => {
    const items = [
      task("a", inbox.id),
      task("b", inbox.id),
      under("c", "a"),
      under("d", "a"),
      under("e", "d"),
    ];
    const stickers = [
      sticker("a", inbox.id, 1, 36),
      sticker("b", inbox.id, 1, 100),
      onBody("c", "a", 200),
      onBody("d", "a", 36),
      onBody("e", "d", 36),
    ];

    const tree = spaceTree(inbox.id, items, stickers);

    expect(tree.map(({ item, depth }) => [item.id, depth])).toEqual([
      ["a", 0],
      ["d", 1],
      ["e", 2],
      ["c", 1],
      ["b", 0],
    ]);
    expect(spaceList(inbox.id, items, stickers).map(({ id }) => id)).toEqual([
      "a",
      "d",
      "e",
      "c",
      "b",
    ]);
  });

  it("ignores a child's sticker on another task's body page, listing it last among its siblings", () => {
    const items = [task("a", inbox.id), under("b", "a"), under("c", "a"), task("d", inbox.id)];
    const stickers = [onBody("b", "d", 36), onBody("c", "a", 100)];

    expect(spaceTree(inbox.id, items, stickers).map(({ item }) => item.id)).toEqual([
      "a",
      "c",
      "b",
      "d",
    ]);
  });

  it("lists the events under a task among its children, and leaves out events at the top", () => {
    const event = (id: string, parentId = "") =>
      create(ItemSchema, {
        id,
        kind: ItemKind.EVENT,
        spaceId: inbox.id,
        title: `Event ${id}`,
        parentId,
      });
    const items = [task("a", inbox.id), under("b", "a"), event("c", "a"), event("d")];
    const stickers = [
      sticker("a", inbox.id, 1, 36),
      onBody("b", "a", 100),
      { ...onBody("c", "a", 36), kind: StickerKind.EVENT },
      { ...sticker("d", inbox.id, 1, 100), kind: StickerKind.EVENT },
    ];

    expect(spaceTree(inbox.id, items, stickers).map(({ item, depth }) => [item.id, depth])).toEqual(
      [
        ["a", 0],
        ["c", 1],
        ["b", 1],
      ],
    );
  });

  it("lists a task whose parent isn't in the space at the top", () => {
    const items = [under("a", "z")];

    expect(spaceTree(inbox.id, items, [])).toEqual([{ item: items[0], depth: 0 }]);
  });
});

describe("itemsUnder and openTasksUnder", () => {
  const under = (id: string, parentId: string) =>
    create(ItemSchema, { ...task(id, inbox.id), parentId });
  const items = new Map(
    [
      task("a", inbox.id),
      under("b", "a"),
      under("c", "b"),
      under("d", "a"),
      task("e", inbox.id),
    ].map((item) => [item.id, item]),
  );

  it("finds the items under an item, at any depth", () => {
    expect(itemsUnder("a", items.values()).sort()).toEqual(["b", "c", "d"]);
    expect(itemsUnder("b", items.values())).toEqual(["c"]);
    expect(itemsUnder("e", items.values())).toEqual([]);
  });

  it("finds the tasks under an item that aren't done", () => {
    expect(
      openTasksUnder("a", items, new Set(["c"]))
        .map(({ id }) => id)
        .sort(),
    ).toEqual(["b", "d"]);
  });
});

describe("canMoveTo", () => {
  const space = (id: string, calendarState: CalendarState) =>
    create(SpaceSchema, { id, kind: SpaceKind.SHARED, calendarState });
  const garden = space("019a8f4e-5c00-7000-8000-0000000000a3", CalendarState.SYNCING);
  const trips = space("019a8f4e-5c00-7000-8000-0000000000a4", CalendarState.PAUSED);
  const notes = space("019a8f4e-5c00-7000-8000-0000000000a5", CalendarState.NONE);
  const kitchen = space("019a8f4e-5c00-7000-8000-0000000000a6", CalendarState.SYNCING);
  const spaces = [garden, trips, notes, kitchen];
  const item = (id: string, parentId: string, kind = ItemKind.TASK, seriesId = "") =>
    create(ItemSchema, { id, kind, spaceId: garden.id, title: id, parentId, seriesId });
  const tree = (...items: ReturnType<typeof item>[]) =>
    new Map(items.map((found) => [found.id, found]));

  it("lets a task holding an event at any depth move only into a space with a Google calendar", () => {
    const items = tree(item("a", ""), item("b", "a"), item("c", "b", ItemKind.EVENT));
    const a = items.get("a") ?? item("a", "");

    expect(canMoveTo(a, kitchen.id, items, spaces)).toBe(true);
    expect(canMoveTo(a, trips.id, items, spaces)).toBe(true);
    expect(canMoveTo(a, notes.id, items, spaces)).toBe(false);
    expect(canMoveTo(a, inbox.id, items, spaces)).toBe(false);
  });

  it("lets a task holding no event move into any space", () => {
    const items = tree(item("a", ""), item("b", "a"));
    const a = items.get("a") ?? item("a", "");

    expect(canMoveTo(a, notes.id, items, spaces)).toBe(true);
    expect(canMoveTo(a, inbox.id, items, spaces)).toBe(true);
  });

  it("keeps a task holding an occurrence of a repeating event in its own space", () => {
    const items = tree(item("a", ""), item("b", "a", ItemKind.EVENT, "series"));
    const a = items.get("a") ?? item("a", "");

    expect(canMoveTo(a, garden.id, items, spaces)).toBe(true);
    expect(canMoveTo(a, trips.id, items, spaces)).toBe(false);
  });

  it("lets an event move only into a space with a Google calendar", () => {
    const event = item("e", "", ItemKind.EVENT);
    const items = tree(event);

    expect(canMoveTo(event, trips.id, items, spaces)).toBe(true);
    expect(canMoveTo(event, notes.id, items, spaces)).toBe(false);
  });
});

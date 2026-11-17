import { a2Landscape, a4Portrait, itemPageId } from "@foyer/shared";
import type { Item } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import { type Page, PageKind } from "@foyer/shared/gen/foyer/page/v1/page_pb";
import { type Space, SpaceKind } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import { describe, expect, it } from "vitest";
import { describePage, pageIdOf, sizeOf } from "../src/page/open-page";

const spaceId = "019a8f4e-5c00-7000-8000-0000000000a1";
const inbox = { id: spaceId, kind: SpaceKind.INBOX, name: "" } as Space;
const garden = { id: spaceId, kind: SpaceKind.SHARED, name: "Garden" } as Space;
const task = { id: "019a8f4e-5c00-7000-8000-0000000000c1", title: "Buy milk" } as Item;

function known(spaces: Space[] = [], items: Item[] = []) {
  return { spaces, items: new Map(items.map((item) => [item.id, item])) };
}

describe("pageIdOf", () => {
  it("names a month's page by its month, and a week's by its Monday", () => {
    expect(pageIdOf({ kind: "month", month: "2026-11" })).toBe("month:2026-11");
    expect(pageIdOf({ kind: "week", monday: "2026-11-16" })).toBe("week:2026-11-16");
  });

  it("names a day's page by its date, and a space's by its space and number", () => {
    expect(pageIdOf({ kind: "day", date: "2026-11-17" })).toBe("day:2026-11-17");
    expect(pageIdOf({ kind: "space", spaceId, number: 1 })).toBe(`space:${spaceId}:1`);
  });

  it("names a task's body page by its task", () => {
    expect(pageIdOf({ kind: "item", itemId: task.id })).toBe(itemPageId(task.id));
  });
});

describe("sizeOf", () => {
  const day = { kind: "day", date: "2026-11-17" } as const;

  it("gives a page that hasn't been made the size of its kind", () => {
    expect(sizeOf({ kind: "month", month: "2026-11" }, new Map())).toEqual(a2Landscape);
    expect(sizeOf({ kind: "week", monday: "2026-11-16" }, new Map())).toEqual(a2Landscape);
    expect(sizeOf(day, new Map())).toEqual(a4Portrait);
    expect(sizeOf({ kind: "item", itemId: task.id }, new Map())).toEqual(a4Portrait);
  });

  it("gives a page that has been made the size it was made with", () => {
    const made = { id: "day:2026-11-17", kind: PageKind.DAY, ...a2Landscape } as Page;

    expect(sizeOf(day, new Map([[made.id, made]]))).toEqual(a2Landscape);
  });
});

describe("describePage", () => {
  it("names a month's page by its month, and a week's by its first and last days", () => {
    expect(describePage({ kind: "month", month: "2026-11" }, known(), "en-US")).toBe(
      "November 2026",
    );
    expect(describePage({ kind: "week", monday: "2026-11-16" }, known(), "en-US")).toBe(
      "November 16, 2026 – November 22, 2026",
    );
  });

  it("names a day's page by its day", () => {
    expect(describePage({ kind: "day", date: "2026-11-17" }, known(), "en-US")).toBe(
      "Tuesday, November 17, 2026",
    );
  });

  it("names a space's page by its space and number", () => {
    const page = { kind: "space", spaceId, number: 1 } as const;

    expect(describePage(page, known([garden]))).toBe("Garden, page 1");
    expect(describePage(page, known([inbox]))).toBe("Inbox, page 1");
    expect(describePage(page, known())).toBe("Space, page 1");
  });

  it("names a task's body page by its task's title", () => {
    const page = { kind: "item", itemId: task.id } as const;

    expect(describePage(page, known([], [task]))).toBe("Buy milk");
    expect(describePage(page, known())).toBe("Task");
  });
});

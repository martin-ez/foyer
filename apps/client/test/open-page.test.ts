import { a2Landscape, a4Portrait } from "@foyer/shared";
import { type Page, PageKind } from "@foyer/shared/gen/foyer/page/v1/page_pb";
import { type Space, SpaceKind } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import { describe, expect, it } from "vitest";
import { describePage, pageIdOf, sizeOf } from "../src/page/open-page";

const spaceId = "019a8f4e-5c00-7000-8000-0000000000a1";
const inbox = { id: spaceId, kind: SpaceKind.INBOX, name: "" } as Space;
const garden = { id: spaceId, kind: SpaceKind.SHARED, name: "Garden" } as Space;

describe("pageIdOf", () => {
  it("names a day's page by its date, and a space's by its space and number", () => {
    expect(pageIdOf({ kind: "day", date: "2026-11-17" })).toBe("day:2026-11-17");
    expect(pageIdOf({ kind: "space", spaceId, number: 1 })).toBe(`space:${spaceId}:1`);
  });
});

describe("sizeOf", () => {
  const day = { kind: "day", date: "2026-11-17" } as const;

  it("gives a page that hasn't been made the size of its kind", () => {
    expect(sizeOf(day, new Map())).toEqual(a4Portrait);
  });

  it("gives a page that has been made the size it was made with", () => {
    const made = { id: "day:2026-11-17", kind: PageKind.DAY, ...a2Landscape } as Page;

    expect(sizeOf(day, new Map([[made.id, made]]))).toEqual(a2Landscape);
  });
});

describe("describePage", () => {
  it("names a day's page by its day", () => {
    expect(describePage({ kind: "day", date: "2026-11-17" }, [], "en-US")).toBe(
      "Tuesday, November 17, 2026",
    );
  });

  it("names a space's page by its space and number", () => {
    const page = { kind: "space", spaceId, number: 1 } as const;

    expect(describePage(page, [garden])).toBe("Garden, page 1");
    expect(describePage(page, [inbox])).toBe("Inbox, page 1");
    expect(describePage(page, [])).toBe("Space, page 1");
  });
});

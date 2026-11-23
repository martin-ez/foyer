import { create } from "@bufbuild/protobuf";
import { dayPageId, itemPageId, monthPageId, spacePageId, weekPageId } from "@foyer/shared";
import { type Page, PageKind, PageSchema } from "@foyer/shared/gen/foyer/page/v1/page_pb";
import { SpaceKind, SpaceSchema } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import { describe, expect, it } from "vitest";
import { keptPages, recentPagesKept } from "../src/sync/kept-pages";

const wednesday = "2026-11-25";
const inbox = create(SpaceSchema, {
  id: "019a8f4e-5c00-7000-8000-0000000000a1",
  kind: SpaceKind.INBOX,
});
const home = create(SpaceSchema, { id: "019a8f4e-5c00-7000-8000-0000000000a2", name: "Home" });
const old = create(SpaceSchema, {
  id: "019a8f4e-5c00-7000-8000-0000000000a3",
  name: "Old",
  archived: true,
});

function spacePage(spaceId: string, number: number): [string, Page] {
  const id = spacePageId(spaceId, number);
  return [id, create(PageSchema, { id, kind: PageKind.SPACE, spaceId, number })];
}

function kept(known: Partial<Parameters<typeof keptPages>[0]> = {}) {
  return keptPages({ today: wednesday, spaces: [], pages: new Map(), opened: new Map(), ...known });
}

describe("the pages whose ink a device keeps", () => {
  it("keeps this month's page, this week's and next week's pages, and their days", () => {
    const days = Array.from({ length: 14 }, (_, day) =>
      dayPageId(`2026-${day < 8 ? `11-${23 + day}` : `12-0${day - 7}`}`),
    );

    expect([...kept()].sort()).toEqual(
      [monthPageId("2026-11"), weekPageId("2026-11-23"), weekPageId("2026-11-30"), ...days].sort(),
    );
  });

  it("keeps each space's newest page, or its first while it has none", () => {
    const pages = new Map([spacePage(home.id, 1), spacePage(home.id, 3), spacePage(home.id, 2)]);

    const pageIds = kept({ spaces: [inbox, home], pages });

    expect(pageIds.has(spacePageId(home.id, 3))).toBe(true);
    expect(pageIds.has(spacePageId(home.id, 2))).toBe(false);
    expect(pageIds.has(spacePageId(inbox.id, 1))).toBe(true);
  });

  it("leaves out the pages of archived spaces", () => {
    expect(kept({ spaces: [old] }).has(spacePageId(old.id, 1))).toBe(false);
  });

  it("keeps the pages opened most recently on the device, up to a limit", () => {
    const opened = new Map(
      Array.from({ length: recentPagesKept + 1 }, (_, index) => [
        itemPageId(`019a8f4e-5c00-7000-8000-${String(index).padStart(12, "0")}`),
        1_000 + index,
      ]),
    );
    const oldest = itemPageId(`019a8f4e-5c00-7000-8000-${"0".repeat(12)}`);

    const pageIds = kept({ opened });

    expect(pageIds.has(oldest)).toBe(false);
    expect([...opened.keys()].filter((pageId) => pageIds.has(pageId))).toHaveLength(
      recentPagesKept,
    );
  });

  it("moves on with the date", () => {
    const pageIds = kept({ today: "2026-12-07" });

    expect(pageIds.has(monthPageId("2026-12"))).toBe(true);
    expect(pageIds.has(monthPageId("2026-11"))).toBe(false);
    expect(pageIds.has(dayPageId(wednesday))).toBe(false);
    expect(pageIds.has(dayPageId("2026-12-20"))).toBe(true);
  });
});

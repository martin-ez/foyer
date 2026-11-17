import { reset } from "cloudflare:test";
import { a2Landscape, a4Portrait, dayPageId, itemPageId, newId, spacePageId } from "@foyer/shared";
import { PageKind } from "@foyer/shared/gen/foyer/page/v1/page_pb";
import { SpaceKind } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import type { ChangeResult, Row } from "@foyer/shared/gen/foyer/sync/v1/sync_pb";
import { afterEach, describe, expect, it } from "vitest";
import {
  Device,
  idOf,
  itemCreate,
  itemDelete,
  madeAt,
  pageCreate,
  signIn,
  spaceCreate,
} from "./sync-device";

const alex = "member@example.com";
const sam = "housemate@example.com";

const devices: Device[] = [];

async function connect(email: string): Promise<Device> {
  const device = await Device.connect((await signIn(email)).token);
  devices.push(device);
  await device.welcome();
  return device;
}

afterEach(async () => {
  for (const device of devices.splice(0)) device.close();
  await reset();
});

function dayPage(date: string) {
  return { pageId: dayPageId(date), kind: PageKind.DAY, ...a4Portrait };
}

function spacePage(spaceId: string, number = 1) {
  return {
    pageId: spacePageId(spaceId, number),
    kind: PageKind.SPACE,
    spaceId,
    number,
    ...a4Portrait,
  };
}

function bodyPage(itemId: string) {
  return { pageId: itemPageId(itemId), kind: PageKind.ITEM, itemId, ...a4Portrait };
}

async function newTask(device: Device, spaceId: string): Promise<string> {
  const create = itemCreate({ spaceId });
  await device.push(create);
  await device.updates();
  return idOf(create);
}

function pagesIn(rows: Row[]) {
  return rows.flatMap(({ row }) =>
    row.case === "page"
      ? [{ id: row.value.id, width: row.value.width, height: row.value.height }]
      : [],
  );
}

async function pagesCaughtUpBy(device: Device) {
  return pagesIn((await device.catchUp()).flatMap(({ rows }) => rows));
}

async function spaceOwnedBy(device: Device, kind: SpaceKind): Promise<string> {
  const rows = (await device.catchUp()).flatMap(({ rows }) => rows);
  const space = rows.flatMap(({ row }) => (row.case === "space" ? [row.value] : []));
  return space.find((each) => each.kind === kind)?.id ?? "";
}

async function newSharedSpace(device: Device): Promise<string> {
  const create = spaceCreate({ name: "Home", kind: SpaceKind.SHARED });
  await device.push(create);
  await device.updates();
  return create.change?.case === "spaceCreate" ? (create.change.value.spaceId ?? "") : "";
}

function resultOf(result: ChangeResult | undefined) {
  if (result?.result.case === "refused") return { refused: result.result.value.reason };
  return { committed: result?.result.case === "seq" };
}

describe("creating pages", () => {
  it("creates a day page and sends it to every member's devices", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    await alexDevice.updates();

    const committed = await alexDevice.push(pageCreate(dayPage("2026-11-17")));

    expect(resultOf(committed.results[0])).toEqual({ committed: true });
    for (const device of [alexDevice, samDevice]) {
      const rows = await device.updates();
      expect(rows.map(({ row }) => row.case === "page" && row.value)).toEqual([
        expect.objectContaining({
          id: "day:2026-11-17",
          kind: PageKind.DAY,
          spaceId: "",
          number: 0,
          itemId: "",
          ...a4Portrait,
        }),
      ]);
    }
  });

  it("creates month and week pages, named by their month and their first day", async () => {
    const device = await connect(alex);

    const committed = await device.push(
      pageCreate({ pageId: "month:2026-11", kind: PageKind.MONTH, ...a2Landscape }),
      pageCreate({ pageId: "week:2026-11-16", kind: PageKind.WEEK, ...a2Landscape }),
    );

    expect(committed.results.map(resultOf)).toEqual([{ committed: true }, { committed: true }]);
    expect(await pagesCaughtUpBy(device)).toEqual([
      { id: "month:2026-11", ...a2Landscape },
      { id: "week:2026-11-16", ...a2Landscape },
    ]);
  });

  it("keeps one calendar page when two devices create it offline, as the first made it", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    await alexDevice.updates();
    await alexDevice.push(pageCreate(dayPage("2026-11-17")));
    await Promise.all([alexDevice.updates(), samDevice.updates()]);

    const earlier = madeAt(Date.now() - 60_000);
    const sameDay = { ...dayPage("2026-11-17"), ...a2Landscape };
    const committed = await samDevice.push(pageCreate(sameDay, { at: earlier }));

    expect(resultOf(committed.results[0])).toEqual({ committed: true });
    const asItIs = { id: "day:2026-11-17", ...a4Portrait };
    expect(pagesIn(await samDevice.updates())).toEqual([asItIs]);
    expect(await alexDevice.updates()).toEqual([]);
    expect(await pagesCaughtUpBy(samDevice)).toEqual([asItIs]);
  });

  it("keeps one space page when two devices create it offline", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const spaceId = await newSharedSpace(alexDevice);
    await samDevice.updates();

    await alexDevice.push(pageCreate(spacePage(spaceId)));
    const committed = await samDevice.push(pageCreate(spacePage(spaceId)));

    expect(resultOf(committed.results[0])).toEqual({ committed: true });
    const page = { id: spacePageId(spaceId, 1), ...a4Portrait };
    expect(await pagesCaughtUpBy(alexDevice)).toEqual([page]);
    expect(await pagesCaughtUpBy(samDevice)).toEqual([page]);
  });

  it("gives a space more pages, numbered from 1", async () => {
    const device = await connect(alex);
    const spaceId = await newSharedSpace(device);

    await device.push(pageCreate(spacePage(spaceId, 1)), pageCreate(spacePage(spaceId, 2)));

    expect((await pagesCaughtUpBy(device)).map(({ id }) => id)).toEqual([
      spacePageId(spaceId, 1),
      spacePageId(spaceId, 2),
    ]);
  });
});

describe("body pages", () => {
  it("creates a task's body page, named by its task, for every device that sees the task", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const itemId = await newTask(alexDevice, await newSharedSpace(alexDevice));
    await samDevice.updates();

    const committed = await samDevice.push(pageCreate(bodyPage(itemId)));

    expect(resultOf(committed.results[0])).toEqual({ committed: true });
    for (const device of [alexDevice, samDevice]) {
      const rows = await device.updates();
      expect(rows.map(({ row }) => row.case === "page" && row.value)).toEqual([
        expect.objectContaining({
          id: `item:${itemId}`,
          kind: PageKind.ITEM,
          spaceId: "",
          number: 0,
          itemId,
          ...a4Portrait,
        }),
      ]);
      expect(await pagesCaughtUpBy(device)).toEqual([{ id: `item:${itemId}`, ...a4Portrait }]);
    }
  });

  it("sends a personal task's body page only to its owner's devices", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const itemId = await newTask(alexDevice, await spaceOwnedBy(alexDevice, SpaceKind.PERSONAL));

    await alexDevice.push(pageCreate(bodyPage(itemId)));

    expect(pagesIn(await alexDevice.updates())).toHaveLength(1);
    expect(await samDevice.updates()).toEqual([]);
    expect(await pagesCaughtUpBy(samDevice)).toEqual([]);
  });

  it("keeps one body page when two devices create it offline", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const itemId = await newTask(alexDevice, await newSharedSpace(alexDevice));
    await samDevice.updates();

    await alexDevice.push(pageCreate(bodyPage(itemId)));
    const committed = await samDevice.push(pageCreate(bodyPage(itemId)));

    expect(resultOf(committed.results[0])).toEqual({ committed: true });
    const page = { id: itemPageId(itemId), ...a4Portrait };
    expect(await pagesCaughtUpBy(alexDevice)).toEqual([page]);
    expect(await pagesCaughtUpBy(samDevice)).toEqual([page]);
  });

  it("refuses a body page of a task the member doesn't see, as if it didn't exist", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const itemId = await newTask(alexDevice, await spaceOwnedBy(alexDevice, SpaceKind.INBOX));

    const committed = await samDevice.push(pageCreate(bodyPage(itemId)));

    expect(resultOf(committed.results[0])).toEqual({ refused: "There's no such item." });
    expect(await alexDevice.updates()).toEqual([]);
  });

  it("has no effect for a deleted task", async () => {
    const device = await connect(alex);
    const itemId = await newTask(device, await spaceOwnedBy(device, SpaceKind.INBOX));
    await device.push(itemDelete(itemId));
    await device.updates();

    const committed = await device.push(pageCreate(bodyPage(itemId)));

    expect(resultOf(committed.results[0])).toEqual({ committed: true });
    expect(await device.updates()).toEqual([]);
    expect(await pagesCaughtUpBy(device)).toEqual([]);
  });
});

describe("who receives pages", () => {
  it("sends a shared space's pages to every member, and a personal space's to its owner only", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const personal = await spaceOwnedBy(alexDevice, SpaceKind.PERSONAL);
    const inbox = await spaceOwnedBy(alexDevice, SpaceKind.INBOX);
    const shared = await newSharedSpace(alexDevice);
    await samDevice.updates();

    await alexDevice.push(
      pageCreate(spacePage(personal)),
      pageCreate(spacePage(inbox)),
      pageCreate(spacePage(shared)),
    );

    const own = [spacePageId(personal, 1), spacePageId(inbox, 1), spacePageId(shared, 1)];
    expect(pagesIn(await alexDevice.updates()).map(({ id }) => id)).toEqual(own);
    expect(pagesIn(await samDevice.updates()).map(({ id }) => id)).toEqual([
      spacePageId(shared, 1),
    ]);
    expect((await pagesCaughtUpBy(alexDevice)).map(({ id }) => id)).toEqual(own);
    expect((await pagesCaughtUpBy(samDevice)).map(({ id }) => id)).toEqual([
      spacePageId(shared, 1),
    ]);
  });

  it("sends calendar pages to every member when they catch up, members who join later included", async () => {
    const alexDevice = await connect(alex);
    await alexDevice.push(pageCreate(dayPage("2026-11-17")));

    const samDevice = await connect(sam);

    expect(await pagesCaughtUpBy(samDevice)).toEqual([{ id: "day:2026-11-17", ...a4Portrait }]);
  });
});

describe("refused pages", () => {
  const notFound = "There's no such space.";

  it.each([
    [
      "a page of no kind",
      () => ({ ...dayPage("2026-11-17"), kind: PageKind.UNSPECIFIED }),
      "A page must be a month, week, day, space or item page.",
    ],
    [
      "a day page named by a day that doesn't exist",
      () => dayPage("2026-02-30"),
      "A day's page must be named by its date, as in “day:2026-11-14”.",
    ],
    [
      "a day page named as another kind",
      () => ({ ...dayPage("2026-11-17"), pageId: "week:2026-11-17" }),
      "A day's page must be named by its date, as in “day:2026-11-14”.",
    ],
    [
      "a week page not named by a day",
      () => ({ pageId: "week:2026-11", kind: PageKind.WEEK, ...a2Landscape }),
      "A week's page must be named by its first day, as in “week:2026-11-09”.",
    ],
    [
      "a month page named by a month that doesn't exist",
      () => ({ pageId: "month:2026-13", kind: PageKind.MONTH, ...a2Landscape }),
      "A month's page must be named by its month, as in “month:2026-11”.",
    ],
    [
      "a calendar page with a space",
      () => ({ ...dayPage("2026-11-17"), spaceId: newId(), number: 1 }),
      "Only space pages have a space and a number, and only item pages have an item.",
    ],
    [
      "a space page numbered 0",
      () => ({ ...spacePage(newId()), number: 0 }),
      "A space's page must be named by its space and its number from 1, as in “space:<space id>:1”.",
    ],
    [
      "a space page named after another space",
      () => ({ ...spacePage(newId()), pageId: spacePageId(newId(), 1) }),
      "A space's page must be named by its space and its number from 1, as in “space:<space id>:1”.",
    ],
    ["a page of a space that doesn't exist", () => spacePage(newId()), notFound],
    [
      "a body page not named by its item",
      () => ({ ...bodyPage(newId()), pageId: newId() }),
      "A body page must be named by its item, as in “item:<item id>”.",
    ],
    [
      "a body page named after another item",
      () => ({ ...bodyPage(newId()), pageId: itemPageId(newId()) }),
      "A body page must be named by its item, as in “item:<item id>”.",
    ],
    ["a body page of an item that doesn't exist", () => bodyPage(newId()), "There's no such item."],
    [
      "a page with no width",
      () => ({ ...dayPage("2026-11-17"), width: 0 }),
      "A page's width and height must be positive numbers of points.",
    ],
    [
      "a page of endless height",
      () => ({ ...dayPage("2026-11-17"), height: Number.POSITIVE_INFINITY }),
      "A page's width and height must be positive numbers of points.",
    ],
  ])("refuses %s, sending nothing", async (_, page, reason) => {
    const device = await connect(alex);
    await device.catchUp();

    const committed = await device.push(pageCreate(page()));

    expect(resultOf(committed.results[0])).toEqual({ refused: reason });
    expect(await device.updates()).toEqual([]);
  });

  it.each([
    ["personal space", SpaceKind.PERSONAL],
    ["Inbox", SpaceKind.INBOX],
  ])("refuses a page of someone else's %s, as if it didn't exist", async (_, kind) => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const samsSpace = await spaceOwnedBy(samDevice, kind);

    const committed = await alexDevice.push(pageCreate(spacePage(samsSpace)));

    expect(resultOf(committed.results[0])).toEqual({ refused: notFound });
    expect(await samDevice.updates()).toEqual([]);
  });
});

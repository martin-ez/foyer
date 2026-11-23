import { reset } from "cloudflare:test";
import { a4Portrait, dayPageId, itemPageId, spacePageId } from "@foyer/shared";
import { PageKind } from "@foyer/shared/gen/foyer/page/v1/page_pb";
import { type Space, SpaceKind } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import type { ChangeResult, Row } from "@foyer/shared/gen/foyer/sync/v1/sync_pb";
import { afterEach, describe, expect, it } from "vitest";
import {
  type ChangeInit,
  Device,
  idOf,
  itemCreate,
  itemDelete,
  itemMove,
  itemSetDate,
  itemSetDescription,
  itemSetParent,
  itemSetRepeat,
  itemSetTime,
  itemSetTitle,
  madeAt,
  pageCreate,
  signIn,
  spaceCreate,
  spaceRename,
  spaceSetArchived,
  stickerMove,
  stickerPlace,
  stickerRemove,
  taskTick,
  taskUntick,
  textBlockCreate,
  textChange,
  textGroupCreate,
} from "./sync-device";

const alex = "member@example.com";
const sam = "housemate@example.com";
const archived = "This space is archived. Restore it to change it.";

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

function resultOf(result: ChangeResult | undefined) {
  if (result?.result.case === "refused") return { refused: result.result.value.reason };
  return { committed: result?.result.case === "seq" };
}

function spacesIn(rows: Row[]): Space[] {
  return rows.flatMap(({ row }) => (row.case === "space" ? [row.value] : []));
}

async function caughtUp(device: Device): Promise<Row[]> {
  return (await device.catchUp()).flatMap(({ rows }) => rows);
}

async function spaceOwnedBy(device: Device, kind: SpaceKind): Promise<string> {
  return spacesIn(await caughtUp(device)).find((space) => space.kind === kind)?.id ?? "";
}

async function newSharedSpace(device: Device, name: string): Promise<string> {
  const create = spaceCreate({ name });
  await device.push(create);
  return idOf(create);
}

const day = "2026-11-21";

async function spaceWithThingsInIt(device: Device) {
  const spaceId = await newSharedSpace(device, "Home");
  const task = itemCreate({ spaceId, date: day });
  const taskId = idOf(task);
  const bodyId = itemPageId(taskId);
  const body = pageCreate({ pageId: bodyId, kind: PageKind.ITEM, itemId: taskId, ...a4Portrait });
  const spacePage = pageCreate({
    pageId: spacePageId(spaceId, 1),
    kind: PageKind.SPACE,
    spaceId,
    number: 1,
    ...a4Portrait,
  });
  const group = textGroupCreate({ pageId: bodyId });
  const block = textBlockCreate({ groupId: idOf(group) });
  await device.push(task, body, spacePage, group, block);
  const otherSpaceId = await newSharedSpace(device, "Garden");
  const otherTask = itemCreate({ spaceId: otherSpaceId, title: "Weed the beds" });
  await device.push(otherTask);
  const calendarSticker = (await caughtUp(device)).flatMap(({ row }) =>
    row.case === "sticker" && row.value.pageId === dayPageId(day) ? [row.value.id] : [],
  )[0];
  return {
    spaceId,
    taskId,
    bodyId,
    groupId: idOf(group),
    blockId: idOf(block),
    calendarStickerId: calendarSticker ?? "",
    otherSpaceId,
    otherTaskId: idOf(otherTask),
  };
}

type Things = Awaited<ReturnType<typeof spaceWithThingsInIt>>;

describe("archiving a space", () => {
  it("archives a shared space for every member, keeping its items, and restores it", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const { spaceId, taskId } = await spaceWithThingsInIt(alexDevice);
    await Promise.all([alexDevice.updates(), samDevice.updates()]);

    const archiving = await alexDevice.push(spaceSetArchived(spaceId, true));
    const whileArchived = await Promise.all([alexDevice.updates(), samDevice.updates()]);
    const kept = await caughtUp(samDevice);
    const restoring = await samDevice.push(spaceSetArchived(spaceId, false));
    const afterRestoring = await Promise.all([alexDevice.updates(), samDevice.updates()]);

    expect([archiving, restoring].map(({ results }) => resultOf(results[0]))).toEqual([
      { committed: true },
      { committed: true },
    ]);
    for (const rows of whileArchived) {
      expect(rows.map(({ row }) => row.case)).toEqual(["space"]);
      expect(spacesIn(rows)).toEqual([expect.objectContaining({ id: spaceId, archived: true })]);
    }
    expect(kept.some(({ row }) => row.case === "item" && row.value.id === taskId)).toBe(true);
    for (const rows of afterRestoring) {
      expect(spacesIn(rows)).toEqual([expect.objectContaining({ id: spaceId, archived: false })]);
    }
  });

  it("lets only its owner archive a personal space, and never the Inbox", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const personal = await spaceOwnedBy(alexDevice, SpaceKind.PERSONAL);
    const inbox = await spaceOwnedBy(alexDevice, SpaceKind.INBOX);

    const bySam = await samDevice.push(spaceSetArchived(personal, true));
    const byAlex = await alexDevice.push(
      spaceSetArchived(inbox, true),
      spaceSetArchived(personal, true),
    );

    expect(resultOf(bySam.results[0])).toEqual({ refused: "There's no such space." });
    expect(byAlex.results.map(resultOf)).toEqual([
      { refused: "The Inbox can't be archived." },
      { committed: true },
    ]);
  });

  it("keeps the archiving or restoring made last, even when an older one arrives after it", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const spaceId = await newSharedSpace(alexDevice, "Home");
    const monday = Date.UTC(2026, 10, 16, 9);
    await samDevice.push(spaceSetArchived(spaceId, true, { at: madeAt(monday) }));
    await samDevice.push(spaceSetArchived(spaceId, false, { at: madeAt(monday + 2) }));
    await Promise.all([alexDevice.updates(), samDevice.updates()]);

    const late = await alexDevice.push(spaceSetArchived(spaceId, true, { at: madeAt(monday + 1) }));

    expect(resultOf(late.results[0])).toEqual({ committed: true });
    expect(spacesIn(await alexDevice.updates())).toEqual([
      expect.objectContaining({ id: spaceId, archived: false }),
    ]);
    expect(await samDevice.updates()).toEqual([]);
  });
});

describe("changes inside an archived space", () => {
  it.each<[string, (things: Things) => ChangeInit[]]>([
    ["adding a task to it", ({ spaceId }) => [itemCreate({ spaceId })]],
    ["renaming it", ({ spaceId }) => [spaceRename(spaceId, "Our home")]],
    [
      "changing a task's fields",
      ({ taskId }) => [
        itemSetTitle(taskId, "Buy oat milk"),
        itemSetDescription(taskId, "From the corner shop"),
        itemSetDate(taskId, "2026-11-22"),
        itemSetTime(taskId, "19:00"),
        itemSetRepeat(taskId, "FREQ=WEEKLY"),
      ],
    ],
    [
      "ticking and unticking a task",
      ({ taskId }) => [taskTick({ itemId: taskId }), taskUntick({ itemId: taskId })],
    ],
    ["deleting a task", ({ taskId }) => [itemDelete(taskId)]],
    [
      "moving a task out of it or into it",
      ({ taskId, otherTaskId, spaceId, otherSpaceId }) => [
        itemMove(taskId, otherSpaceId),
        itemMove(otherTaskId, spaceId),
      ],
    ],
    [
      "putting a task under one in another space, or one from another space under its task",
      ({ taskId, otherTaskId }) => [
        itemSetParent(taskId, otherTaskId),
        itemSetParent(otherTaskId, taskId),
      ],
    ],
    [
      "placing, moving and removing its items' stickers on calendar pages",
      ({ taskId, calendarStickerId }) => [
        stickerPlace({ pageId: dayPageId(day), itemId: taskId, occurrence: day }),
        stickerMove(calendarStickerId, 60, 60),
        stickerRemove(calendarStickerId),
      ],
    ],
    [
      "making its items' body pages",
      ({ taskId, bodyId }) => [
        pageCreate({ pageId: bodyId, kind: PageKind.ITEM, itemId: taskId, ...a4Portrait }),
      ],
    ],
    [
      "making another of its pages",
      ({ spaceId }) => [
        pageCreate({
          pageId: spacePageId(spaceId, 2),
          kind: PageKind.SPACE,
          spaceId,
          number: 2,
          ...a4Portrait,
        }),
      ],
    ],
    [
      "writing on its pages and its items' body pages",
      ({ spaceId, bodyId, groupId, blockId }) => [
        textGroupCreate({ pageId: spacePageId(spaceId, 1) }),
        textGroupCreate({ pageId: bodyId }),
        textBlockCreate({ groupId, order: "W" }),
        textChange({ case: "textBlockEdit", value: { blockId, markdown: "Buy bread" } }),
        textChange({ case: "textGroupMove", value: { groupId, x: 60, y: 60 } }),
        textChange({ case: "textGroupResize", value: { groupId, width: 200 } }),
        textChange({ case: "textBlockMove", value: { blockId, groupId, order: "W" } }),
        textChange({ case: "textBlockDelete", value: { blockId } }),
        textChange({ case: "textGroupDelete", value: { groupId } }),
      ],
    ],
  ])("refuses %s, sending nothing", async (_, changes) => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const things = await spaceWithThingsInIt(alexDevice);
    await alexDevice.push(spaceSetArchived(things.spaceId, true));
    await Promise.all([alexDevice.updates(), samDevice.updates()]);

    const committed = await samDevice.push(...changes(things));

    expect(committed.results.map(resultOf)).toEqual(
      changes(things).map(() => ({ refused: archived })),
    );
    expect(await alexDevice.updates()).toEqual([]);
    expect(await samDevice.updates()).toEqual([]);
  });

  it("takes them again once the space is restored", async () => {
    const device = await connect(alex);
    const { spaceId, taskId } = await spaceWithThingsInIt(device);
    await device.push(spaceSetArchived(spaceId, true), spaceSetArchived(spaceId, false));

    const committed = await device.push(itemSetTitle(taskId, "Buy oat milk"));

    expect(resultOf(committed.results[0])).toEqual({ committed: true });
  });

  it("still takes changes around its stickers on calendar pages, which belong to the household", async () => {
    const device = await connect(alex);
    const { spaceId } = await spaceWithThingsInIt(device);
    await device.push(spaceSetArchived(spaceId, true));

    const committed = await device.push(textGroupCreate({ pageId: dayPageId(day) }));

    expect(resultOf(committed.results[0])).toEqual({ committed: true });
  });

  it("refuses a change in someone else's archived personal space as for any space one doesn't see", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const personal = await spaceOwnedBy(alexDevice, SpaceKind.PERSONAL);
    const task = itemCreate({ spaceId: personal });
    await alexDevice.push(task, spaceSetArchived(personal, true));

    const committed = await samDevice.push(itemSetTitle(idOf(task), "Mine now"));

    expect(resultOf(committed.results[0])).toEqual({ refused: "There's no such item." });
  });
});

describe("archived spaces' names", () => {
  it("numbers a new space named as an archived one, refuses renaming one to its name, and restores it as it was", async () => {
    const device = await connect(alex);
    const home = await newSharedSpace(device, "Home");
    const garden = await newSharedSpace(device, "Garden");
    await device.push(spaceSetArchived(home, true));

    const renamed = await device.push(spaceRename(garden, "home"));
    await newSharedSpace(device, "Home");
    await device.push(spaceSetArchived(home, false));

    expect(resultOf(renamed.results[0])).toEqual({
      refused: "An archived space is called “Home”.",
    });
    const names = spacesIn(await caughtUp(device))
      .filter(({ kind }) => kind === SpaceKind.SHARED)
      .map(({ name, archived }) => ({ name, archived }));
    expect(names).toEqual([
      { name: "Garden", archived: false },
      { name: "Home 2", archived: false },
      { name: "Home", archived: false },
    ]);
  });
});

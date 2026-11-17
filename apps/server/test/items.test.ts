import { reset } from "cloudflare:test";
import { timestampMs } from "@bufbuild/protobuf/wkt";
import { a4Portrait, newId, spacePageId } from "@foyer/shared";
import { ItemKind } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import { PageKind } from "@foyer/shared/gen/foyer/page/v1/page_pb";
import { SpaceKind } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import { type ChangeResult, type Row, RowKind } from "@foyer/shared/gen/foyer/sync/v1/sync_pb";
import { afterEach, describe, expect, it } from "vitest";
import {
  Device,
  idOf,
  itemCreate,
  itemDelete,
  itemMove,
  itemSetDate,
  itemSetDescription,
  itemSetTitle,
  madeAt,
  pageCreate,
  signIn,
  spaceCreate,
  stickerPlace,
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

function itemsIn(rows: Row[]) {
  return rows.flatMap(({ row }) => (row.case === "item" ? [row.value] : []));
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
  return idOf(create);
}

function resultOf(result: ChangeResult | undefined) {
  if (result?.result.case === "refused") return { refused: result.result.value.reason };
  return { committed: result?.result.case === "seq" };
}

describe("creating tasks", () => {
  it("creates a task with a trimmed title and sends it to the devices that see its space", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const { memberId } = await signIn(alex);
    const spaceId = await newSharedSpace(alexDevice);
    await samDevice.updates();
    const madeOn = Date.UTC(2026, 10, 17, 9, 30);

    const create = itemCreate(
      { spaceId, title: "  Buy milk ", description: "Oat, if they have it", date: "2026-11-18" },
      { at: madeAt(madeOn) },
    );
    const committed = await alexDevice.push(create);

    expect(resultOf(committed.results[0])).toEqual({ committed: true });
    for (const device of [alexDevice, samDevice]) {
      const [item] = itemsIn(await device.updates());
      expect(item).toEqual(
        expect.objectContaining({
          id: idOf(create),
          kind: ItemKind.TASK,
          spaceId,
          title: "Buy milk",
          description: "Oat, if they have it",
          date: "2026-11-18",
          createdBy: memberId,
        }),
      );
      expect(item?.createdAt && timestampMs(item.createdAt)).toBe(madeOn);
    }
  });

  it("sends a task in an Inbox or a personal space only to its owner's devices", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const inbox = await spaceOwnedBy(alexDevice, SpaceKind.INBOX);
    const personal = await spaceOwnedBy(alexDevice, SpaceKind.PERSONAL);
    await samDevice.updates();

    const creates = [itemCreate({ spaceId: inbox }), itemCreate({ spaceId: personal })];
    await alexDevice.push(...creates);

    expect(itemsIn(await alexDevice.updates()).map(({ id }) => id)).toEqual(creates.map(idOf));
    expect(itemsIn(await samDevice.updates())).toEqual([]);
    const caughtUp = async (device: Device) =>
      itemsIn((await device.catchUp()).flatMap(({ rows }) => rows)).map(({ id }) => id);
    expect(await caughtUp(alexDevice)).toEqual(creates.map(idOf));
    expect(await caughtUp(samDevice)).toEqual([]);
  });

  it("leaves a task without a date with an empty date", async () => {
    const device = await connect(alex);
    const inbox = await spaceOwnedBy(device, SpaceKind.INBOX);

    await device.push(itemCreate({ spaceId: inbox }));

    expect(itemsIn(await device.updates())).toEqual([
      expect.objectContaining({ title: "Buy milk", description: "", date: "" }),
    ]);
  });

  it.each([
    ["a blank title", { title: "   " }, "A task's title can't be blank."],
    [
      "a title over 500 characters",
      { title: "a".repeat(501) },
      "A task's title can't be longer than 500 characters.",
    ],
    [
      "a date that isn't a day",
      { date: "2026-02-30" },
      "A task's date must be a day, as in “2026-11-17”.",
    ],
    ["an event, for now", { kind: ItemKind.EVENT }, "Only tasks can be created for now."],
    [
      "an id that isn't a UUID version 7",
      { itemId: "task-1" },
      "An item's id must be a UUID version 7.",
    ],
  ])("refuses %s", async (_, change, reason) => {
    const device = await connect(alex);
    const inbox = await spaceOwnedBy(device, SpaceKind.INBOX);

    const committed = await device.push(itemCreate({ spaceId: inbox, ...change }));

    expect(resultOf(committed.results[0])).toEqual({ refused: reason });
    expect(await device.updates()).toEqual([]);
  });

  it("refuses a task in a space the member doesn't see, or one that doesn't exist", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const alexsInbox = await spaceOwnedBy(alexDevice, SpaceKind.INBOX);

    const committed = await samDevice.push(
      itemCreate({ spaceId: alexsInbox }),
      itemCreate({ spaceId: newId() }),
    );

    expect(committed.results.map(resultOf)).toEqual([
      { refused: "There's no such space." },
      { refused: "There's no such space." },
    ]);
    expect(itemsIn(await alexDevice.updates())).toEqual([]);
  });

  it("refuses a task whose id another item has", async () => {
    const device = await connect(alex);
    const inbox = await spaceOwnedBy(device, SpaceKind.INBOX);
    const first = itemCreate({ spaceId: inbox });
    await device.push(first);

    const committed = await device.push(itemCreate({ spaceId: inbox, itemId: idOf(first) }));

    expect(resultOf(committed.results[0])).toEqual({
      refused: "An item with this id already exists.",
    });
  });
});

function deletedIn(rows: Row[], kind: RowKind) {
  return rows.flatMap(({ row }) =>
    row.case === "deleted" && row.value.kind === kind ? [row.value.id] : [],
  );
}

async function rowsCaughtUpBy(device: Device, cursor = 0) {
  return (await device.catchUp(cursor)).flatMap(({ rows }) => rows);
}

async function newTask(device: Device, spaceId: string, title = "Buy milk") {
  const create = itemCreate({ spaceId, title }, { at: madeAt(Date.now() - 60_000) });
  await device.push(create);
  await device.updates();
  return idOf(create);
}

describe("editing tasks", () => {
  it("changes a task's title, description and date for every device that sees its space", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const spaceId = await newSharedSpace(alexDevice);
    const itemId = await newTask(alexDevice, spaceId);
    await samDevice.updates();

    const committed = await samDevice.push(
      itemSetTitle(itemId, " Buy oat milk  "),
      itemSetDescription(itemId, "From the corner shop"),
      itemSetDate(itemId, "2026-11-20"),
    );

    expect(committed.results.map(resultOf)).toEqual([
      { committed: true },
      { committed: true },
      { committed: true },
    ]);
    for (const device of [alexDevice, samDevice]) {
      expect(itemsIn(await device.updates()).at(-1)).toEqual(
        expect.objectContaining({
          title: "Buy oat milk",
          description: "From the corner shop",
          date: "2026-11-20",
        }),
      );
    }
  });

  it("clears a task's date", async () => {
    const device = await connect(alex);
    const inbox = await spaceOwnedBy(device, SpaceKind.INBOX);
    const create = itemCreate(
      { spaceId: inbox, date: "2026-11-20" },
      { at: madeAt(Date.now() - 1000) },
    );
    await device.push(create);

    await device.push(itemSetDate(idOf(create), ""));

    expect(itemsIn(await device.updates()).at(-1)).toEqual(expect.objectContaining({ date: "" }));
  });

  it("keeps both changes when two devices change different fields offline", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const spaceId = await newSharedSpace(alexDevice);
    const itemId = await newTask(alexDevice, spaceId);
    await samDevice.updates();

    await alexDevice.push(itemSetDate(itemId, "2026-11-20", { at: madeAt(Date.now() - 20_000) }));
    await samDevice.push(itemSetTitle(itemId, "Buy oat milk", { at: madeAt(Date.now() - 30_000) }));

    const [item] = itemsIn(await rowsCaughtUpBy(alexDevice));
    expect(item).toEqual(expect.objectContaining({ title: "Buy oat milk", date: "2026-11-20" }));
  });

  it("keeps the change made last when two devices change the same field offline", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const spaceId = await newSharedSpace(alexDevice);
    const itemId = await newTask(alexDevice, spaceId);
    await samDevice.updates();
    await alexDevice.push(itemSetTitle(itemId, "Later", { at: madeAt(Date.now() - 10_000) }));
    await Promise.all([alexDevice.updates(), samDevice.updates()]);

    const committed = await samDevice.push(
      itemSetTitle(itemId, "Earlier", { at: madeAt(Date.now() - 20_000) }),
    );

    expect(resultOf(committed.results[0])).toEqual({ committed: true });
    expect(itemsIn(await samDevice.updates())).toEqual([
      expect.objectContaining({ title: "Later" }),
    ]);
    expect(await alexDevice.updates()).toEqual([]);
  });

  it.each([
    ["a blank title", itemSetTitle, "  ", "A task's title can't be blank."],
    [
      "a title over 500 characters",
      itemSetTitle,
      "a".repeat(501),
      "A task's title can't be longer than 500 characters.",
    ],
    [
      "a description over 10,000 characters",
      itemSetDescription,
      "a".repeat(10_001),
      "A task's description can't be longer than 10,000 characters.",
    ],
    [
      "a date that isn't a day",
      itemSetDate,
      "tomorrow",
      "A task's date must be a day, as in “2026-11-17”.",
    ],
  ])("refuses %s", async (_, change, value, reason) => {
    const device = await connect(alex);
    const inbox = await spaceOwnedBy(device, SpaceKind.INBOX);
    const itemId = await newTask(device, inbox);

    const committed = await device.push(change(itemId, value));

    expect(resultOf(committed.results[0])).toEqual({ refused: reason });
  });

  it("refuses a new task with a description over 10,000 characters", async () => {
    const device = await connect(alex);
    const inbox = await spaceOwnedBy(device, SpaceKind.INBOX);

    const committed = await device.push(
      itemCreate({ spaceId: inbox, description: "a".repeat(10_001) }),
    );

    expect(resultOf(committed.results[0])).toEqual({
      refused: "A task's description can't be longer than 10,000 characters.",
    });
  });

  it("refuses changing a task in a space the member doesn't see, as if it didn't exist", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const inbox = await spaceOwnedBy(alexDevice, SpaceKind.INBOX);
    const itemId = await newTask(alexDevice, inbox);

    const committed = await samDevice.push(itemSetTitle(itemId, "Mine now"), itemDelete(itemId));

    expect(committed.results.map(resultOf)).toEqual([
      { refused: "There's no such item." },
      { refused: "There's no such item." },
    ]);
  });

  it("has no effect on a deleted task, and sends the device its deletion", async () => {
    const device = await connect(alex);
    const inbox = await spaceOwnedBy(device, SpaceKind.INBOX);
    const itemId = await newTask(device, inbox);
    await device.push(itemDelete(itemId));
    await device.updates();

    const committed = await device.push(itemSetTitle(itemId, "Too late"));

    expect(resultOf(committed.results[0])).toEqual({ committed: true });
    expect(deletedIn(await device.updates(), RowKind.ITEM)).toEqual([itemId]);
  });
});

describe("moving tasks", () => {
  it("moves a task between shared spaces for every member", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const from = await newSharedSpace(alexDevice);
    const to = await newSharedSpace(alexDevice);
    const itemId = await newTask(alexDevice, from);
    await samDevice.updates();

    const committed = await samDevice.push(itemMove(itemId, to));

    expect(resultOf(committed.results[0])).toEqual({ committed: true });
    for (const device of [alexDevice, samDevice]) {
      expect(itemsIn(await device.updates())).toEqual([
        expect.objectContaining({ id: itemId, spaceId: to }),
      ]);
    }
  });

  it("tells other members' devices to drop a task moved into someone's own space", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const shared = await newSharedSpace(alexDevice);
    const inbox = await spaceOwnedBy(alexDevice, SpaceKind.INBOX);
    const itemId = await newTask(alexDevice, shared);
    await samDevice.updates();
    const [samCaughtUp] = (await samDevice.catchUp()).slice(-1);

    await alexDevice.push(itemMove(itemId, inbox));

    expect(itemsIn(await alexDevice.updates())).toEqual([
      expect.objectContaining({ id: itemId, spaceId: inbox }),
    ]);
    const live = await samDevice.updates();
    expect(itemsIn(live)).toEqual([]);
    expect(deletedIn(live, RowKind.ITEM)).toEqual([itemId]);
    const caughtUp = await rowsCaughtUpBy(samDevice, Number(samCaughtUp?.cursor));
    expect(itemsIn(caughtUp)).toEqual([]);
    expect(deletedIn(caughtUp, RowKind.ITEM)).toEqual([itemId]);
    expect(itemsIn(await rowsCaughtUpBy(alexDevice)).map(({ id }) => id)).toEqual([itemId]);
  });

  it("sends a task back to other members' devices when it moves back to a shared space", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const shared = await newSharedSpace(alexDevice);
    const personal = await spaceOwnedBy(alexDevice, SpaceKind.PERSONAL);
    const itemId = await newTask(alexDevice, shared);
    await alexDevice.push(itemMove(itemId, personal, { at: madeAt(Date.now() - 20_000) }));
    await samDevice.updates();
    const [hidden] = (await samDevice.catchUp()).slice(-1);

    await alexDevice.push(itemMove(itemId, shared));

    expect(itemsIn(await samDevice.updates())).toEqual([
      expect.objectContaining({ id: itemId, spaceId: shared }),
    ]);
    const caughtUp = await rowsCaughtUpBy(samDevice, Number(hidden?.cursor));
    expect(itemsIn(caughtUp).map(({ id }) => id)).toEqual([itemId]);
    expect(deletedIn(caughtUp, RowKind.ITEM)).toEqual([]);
  });

  it("refuses moving a task to a space the member doesn't see", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const shared = await newSharedSpace(alexDevice);
    const alexsInbox = await spaceOwnedBy(alexDevice, SpaceKind.INBOX);
    const itemId = await newTask(alexDevice, shared);

    const committed = await samDevice.push(itemMove(itemId, alexsInbox));

    expect(resultOf(committed.results[0])).toEqual({ refused: "There's no such space." });
  });

  it("keeps the move made last when two devices move a task offline", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const from = await newSharedSpace(alexDevice);
    const later = await newSharedSpace(alexDevice);
    const earlier = await newSharedSpace(alexDevice);
    const itemId = await newTask(alexDevice, from);
    await samDevice.updates();

    await alexDevice.push(itemMove(itemId, later, { at: madeAt(Date.now() - 10_000) }));
    await samDevice.push(itemMove(itemId, earlier, { at: madeAt(Date.now() - 20_000) }));

    expect(itemsIn(await rowsCaughtUpBy(samDevice))).toEqual([
      expect.objectContaining({ id: itemId, spaceId: later }),
    ]);
  });
});

describe("deleting tasks", () => {
  it("deletes a task and its stickers for every device that sees them", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const spaceId = await newSharedSpace(alexDevice);
    const task = itemCreate({ spaceId });
    const pageId = spacePageId(spaceId, 1);
    const place = stickerPlace({ pageId, itemId: idOf(task) });
    await alexDevice.push(
      pageCreate({ pageId, kind: PageKind.SPACE, spaceId, number: 1, ...a4Portrait }),
      task,
      place,
    );
    await samDevice.updates();

    const committed = await samDevice.push(itemDelete(idOf(task)));

    expect(resultOf(committed.results[0])).toEqual({ committed: true });
    for (const device of [alexDevice, samDevice]) {
      const live = await device.updates();
      expect(deletedIn(live, RowKind.ITEM)).toEqual([idOf(task)]);
      expect(deletedIn(live, RowKind.STICKER)).toEqual([idOf(place)]);
      const rows = await rowsCaughtUpBy(device);
      expect(itemsIn(rows)).toEqual([]);
      expect(rows.some(({ row }) => row.case === "sticker")).toBe(false);
    }
  });

  it("sends a personal task's deletion only to its owner's devices", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const personal = await spaceOwnedBy(alexDevice, SpaceKind.PERSONAL);
    const itemId = await newTask(alexDevice, personal);
    await samDevice.updates();

    await alexDevice.push(itemDelete(itemId));

    expect(deletedIn(await alexDevice.updates(), RowKind.ITEM)).toEqual([itemId]);
    expect(await samDevice.updates()).toEqual([]);
    expect(deletedIn(await rowsCaughtUpBy(samDevice), RowKind.ITEM)).toEqual([]);
  });

  it("has no effect when the task was already deleted", async () => {
    const device = await connect(alex);
    const inbox = await spaceOwnedBy(device, SpaceKind.INBOX);
    const itemId = await newTask(device, inbox);
    await device.push(itemDelete(itemId));
    await device.updates();

    const committed = await device.push(itemDelete(itemId));

    expect(resultOf(committed.results[0])).toEqual({ committed: true });
    expect(deletedIn(await device.updates(), RowKind.ITEM)).toEqual([itemId]);
  });
});

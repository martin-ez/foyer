import { reset } from "cloudflare:test";
import { timestampMs } from "@bufbuild/protobuf/wkt";
import { a4Portrait, dayPageId, newId, spacePageId } from "@foyer/shared";
import { PageKind } from "@foyer/shared/gen/foyer/page/v1/page_pb";
import { SpaceKind } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import { StickerKind } from "@foyer/shared/gen/foyer/sticker/v1/sticker_pb";
import { type ChangeResult, type Row, RowKind } from "@foyer/shared/gen/foyer/sync/v1/sync_pb";
import { afterEach, describe, expect, it } from "vitest";
import { pullReplyRowLimit } from "../src/rows";
import {
  Device,
  idOf,
  itemCreate,
  madeAt,
  pageCreate,
  signIn,
  spaceCreate,
  stickerMove,
  stickerPlace,
  stickerRemove,
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

function stickersIn(rows: Row[]) {
  return rows.flatMap(({ row }) => (row.case === "sticker" ? [row.value] : []));
}

function removedIn(rows: Row[]) {
  return rows.flatMap(({ row }) =>
    row.case === "deleted" && row.value.kind === RowKind.STICKER ? [row.value.id] : [],
  );
}

async function stickersCaughtUpBy(device: Device) {
  return stickersIn((await device.catchUp()).flatMap(({ rows }) => rows));
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

function spacePage(spaceId: string, number = 1) {
  const pageId = spacePageId(spaceId, number);
  return { pageId, kind: PageKind.SPACE, spaceId, number, ...a4Portrait };
}

async function newTaskWithoutSticker(device: Device, spaceId: string) {
  const task = itemCreate({ spaceId });
  await device.push(pageCreate(spacePage(spaceId)), task);
  await device.updates();
  return { itemId: idOf(task), pageId: spacePageId(spaceId, 1) };
}

async function newTaskWithSticker(device: Device, spaceId: string, made = {}) {
  const { itemId, pageId } = await newTaskWithoutSticker(device, spaceId);
  const place = stickerPlace({ pageId, itemId }, made);
  await device.push(place);
  await device.updates();
  return { itemId, pageId, stickerId: idOf(place) };
}

function resultOf(result: ChangeResult | undefined) {
  if (result?.result.case === "refused") return { refused: result.result.value.reason };
  return { committed: result?.result.case === "seq" };
}

describe("placing stickers", () => {
  it("places a task's sticker on its space's page and sends it to the devices that see the page", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const { memberId } = await signIn(alex);
    const spaceId = await newSharedSpace(alexDevice);
    const { itemId, pageId } = await newTaskWithoutSticker(alexDevice, spaceId);
    await samDevice.updates();
    const placedOn = Date.UTC(2026, 10, 17, 9, 30);

    const place = stickerPlace({ pageId, itemId, x: 36.25, y: 120.5 }, { at: madeAt(placedOn) });
    const committed = await alexDevice.push(place);

    expect(resultOf(committed.results[0])).toEqual({ committed: true });
    for (const device of [alexDevice, samDevice]) {
      const [sticker] = stickersIn(await device.updates());
      expect(sticker).toEqual(
        expect.objectContaining({
          id: idOf(place),
          pageId,
          x: 36.25,
          y: 120.5,
          kind: StickerKind.TASK,
          itemId,
          placedBy: memberId,
        }),
      );
      expect(sticker?.placedAt && timestampMs(sticker.placedAt)).toBe(placedOn);
    }
  });

  it("places a page, a task and its sticker in one push, as a device adding a task does", async () => {
    const device = await connect(alex);
    const inbox = await spaceOwnedBy(device, SpaceKind.INBOX);
    const task = itemCreate({ spaceId: inbox });
    const place = stickerPlace({ pageId: spacePageId(inbox, 1), itemId: idOf(task) });

    const committed = await device.push(pageCreate(spacePage(inbox)), task, place);

    expect(committed.results.map(resultOf)).toEqual([
      { committed: true },
      { committed: true },
      { committed: true },
    ]);
    expect((await stickersCaughtUpBy(device)).map(({ id }) => id)).toEqual([idOf(place)]);
  });

  it("sends a personal space's stickers only to its owner's devices", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const personal = await spaceOwnedBy(alexDevice, SpaceKind.PERSONAL);
    await samDevice.updates();

    const { stickerId } = await newTaskWithSticker(alexDevice, personal);

    expect((await stickersCaughtUpBy(alexDevice)).map(({ id }) => id)).toEqual([stickerId]);
    expect(await stickersCaughtUpBy(samDevice)).toEqual([]);
    expect(stickersIn(await samDevice.updates())).toEqual([]);
  });

  it.each([
    [
      "at a corner off the page",
      { x: a4Portrait.width + 1 },
      "A sticker's top-left corner must be on its page.",
    ],
    ["at a negative position", { y: -1 }, "A sticker's top-left corner must be on its page."],
    [
      "of no kind",
      { kind: StickerKind.UNSPECIFIED },
      "A sticker must be a task's, an event's or a note's.",
    ],
    [
      "of another kind than its item",
      { kind: StickerKind.NOTE },
      "A sticker must be of the same kind as its item.",
    ],
    [
      "with an id that isn't a UUID version 7",
      { stickerId: "sticker-1" },
      "A sticker's id must be a UUID version 7.",
    ],
    ["for an item that doesn't exist", { itemId: newId() }, "There's no such item."],
  ])("refuses a sticker %s", async (_, change, reason) => {
    const device = await connect(alex);
    const inbox = await spaceOwnedBy(device, SpaceKind.INBOX);
    const { itemId, pageId } = await newTaskWithoutSticker(device, inbox);

    const committed = await device.push(stickerPlace({ pageId, itemId, ...change }));

    expect(resultOf(committed.results[0])).toEqual({ refused: reason });
    expect(await stickersCaughtUpBy(device)).toEqual([]);
  });

  it("refuses a sticker on a page that hasn't been created", async () => {
    const device = await connect(alex);
    const inbox = await spaceOwnedBy(device, SpaceKind.INBOX);
    const { itemId } = await newTaskWithoutSticker(device, inbox);

    const committed = await device.push(stickerPlace({ pageId: spacePageId(inbox, 2), itemId }));

    expect(resultOf(committed.results[0])).toEqual({ refused: "There's no such page." });
  });

  it("refuses a sticker on a calendar page, for now", async () => {
    const device = await connect(alex);
    const inbox = await spaceOwnedBy(device, SpaceKind.INBOX);
    const { itemId } = await newTaskWithoutSticker(device, inbox);
    const day = { pageId: dayPageId("2026-11-17"), kind: PageKind.DAY, ...a4Portrait };
    await device.push(pageCreate(day));

    const committed = await device.push(stickerPlace({ pageId: day.pageId, itemId }));

    expect(resultOf(committed.results[0])).toEqual({
      refused: "Stickers can only go on a space's pages for now.",
    });
  });

  it("refuses a sticker for another space's item on a space's page", async () => {
    const device = await connect(alex);
    const inbox = await spaceOwnedBy(device, SpaceKind.INBOX);
    const shared = await newSharedSpace(device);
    const { itemId } = await newTaskWithoutSticker(device, inbox);
    await device.push(pageCreate(spacePage(shared)));

    const committed = await device.push(stickerPlace({ pageId: spacePageId(shared, 1), itemId }));

    expect(resultOf(committed.results[0])).toEqual({
      refused: "A space's page only holds the space's own items.",
    });
  });

  it("refuses a sticker on a page the member doesn't see", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const inbox = await spaceOwnedBy(alexDevice, SpaceKind.INBOX);
    const { itemId, pageId } = await newTaskWithoutSticker(alexDevice, inbox);

    const committed = await samDevice.push(stickerPlace({ pageId, itemId }));

    expect(resultOf(committed.results[0])).toEqual({ refused: "There's no such page." });
  });

  it("refuses a sticker whose id another sticker has, even one that was removed", async () => {
    const device = await connect(alex);
    const inbox = await spaceOwnedBy(device, SpaceKind.INBOX);
    const { itemId, pageId, stickerId } = await newTaskWithSticker(device, inbox);
    await device.push(stickerRemove(stickerId));

    const committed = await device.push(stickerPlace({ pageId, itemId, stickerId }));

    expect(resultOf(committed.results[0])).toEqual({
      refused: "A sticker with this id already exists.",
    });
  });
});

describe("moving stickers", () => {
  it("moves a sticker and brings it to the top, for every device that sees its page", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const { memberId: samId } = await signIn(sam);
    const spaceId = await newSharedSpace(alexDevice);
    const { stickerId } = await newTaskWithSticker(alexDevice, spaceId, {
      at: madeAt(Date.now() - 60_000),
    });
    await samDevice.updates();
    const movedOn = Date.now();

    const committed = await samDevice.push(
      stickerMove(stickerId, 200, 300, { at: madeAt(movedOn) }),
    );

    expect(resultOf(committed.results[0])).toEqual({ committed: true });
    for (const device of [alexDevice, samDevice]) {
      const [sticker] = stickersIn(await device.updates());
      expect(sticker).toEqual(
        expect.objectContaining({ id: stickerId, x: 200, y: 300, placedBy: samId }),
      );
      expect(sticker?.placedAt && timestampMs(sticker.placedAt)).toBe(movedOn);
    }
  });

  it("keeps the move made last when two devices move a sticker offline", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const spaceId = await newSharedSpace(alexDevice);
    const { stickerId } = await newTaskWithSticker(alexDevice, spaceId, {
      at: madeAt(Date.now() - 60_000),
    });
    await samDevice.updates();

    await alexDevice.push(stickerMove(stickerId, 100, 100, { at: madeAt(Date.now() - 10_000) }));
    await Promise.all([alexDevice.updates(), samDevice.updates()]);
    const committed = await samDevice.push(
      stickerMove(stickerId, 400, 400, { at: madeAt(Date.now() - 20_000) }),
    );

    expect(resultOf(committed.results[0])).toEqual({ committed: true });
    expect(stickersIn(await samDevice.updates())).toEqual([
      expect.objectContaining({ id: stickerId, x: 100, y: 100 }),
    ]);
    expect(await alexDevice.updates()).toEqual([]);
    expect(await stickersCaughtUpBy(alexDevice)).toEqual([
      expect.objectContaining({ id: stickerId, x: 100, y: 100 }),
    ]);
  });

  it("refuses moving a sticker off its page", async () => {
    const device = await connect(alex);
    const inbox = await spaceOwnedBy(device, SpaceKind.INBOX);
    const { stickerId } = await newTaskWithSticker(device, inbox);

    const committed = await device.push(stickerMove(stickerId, 10, a4Portrait.height + 1));

    expect(resultOf(committed.results[0])).toEqual({
      refused: "A sticker's top-left corner must be on its page.",
    });
  });

  it("has no effect on a sticker that was removed, and sends the device its removal", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const spaceId = await newSharedSpace(alexDevice);
    const { stickerId } = await newTaskWithSticker(alexDevice, spaceId);
    await samDevice.updates();
    await alexDevice.push(stickerRemove(stickerId));
    await Promise.all([alexDevice.updates(), samDevice.updates()]);

    const committed = await samDevice.push(stickerMove(stickerId, 200, 200));

    expect(resultOf(committed.results[0])).toEqual({ committed: true });
    expect(removedIn(await samDevice.updates())).toEqual([stickerId]);
    expect(await alexDevice.updates()).toEqual([]);
  });

  it("refuses moving a sticker that doesn't exist", async () => {
    const device = await connect(alex);

    const committed = await device.push(stickerMove(newId(), 10, 10));

    expect(resultOf(committed.results[0])).toEqual({ refused: "There's no such sticker." });
  });
});

describe("removing stickers", () => {
  it("peels a sticker off for every device that sees its page, and keeps its task", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const spaceId = await newSharedSpace(alexDevice);
    const { itemId, stickerId } = await newTaskWithSticker(alexDevice, spaceId);
    await samDevice.updates();

    const committed = await samDevice.push(stickerRemove(stickerId));

    expect(resultOf(committed.results[0])).toEqual({ committed: true });
    for (const device of [alexDevice, samDevice]) {
      expect(removedIn(await device.updates())).toEqual([stickerId]);
      const rows = (await device.catchUp()).flatMap(({ rows }) => rows);
      expect(stickersIn(rows)).toEqual([]);
      expect(rows.some(({ row }) => row.case === "item" && row.value.id === itemId)).toBe(true);
    }
  });

  it("sends a personal space's removed sticker only to its owner's devices", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const personal = await spaceOwnedBy(alexDevice, SpaceKind.PERSONAL);
    const { stickerId } = await newTaskWithSticker(alexDevice, personal);
    await samDevice.updates();

    await alexDevice.push(stickerRemove(stickerId));

    expect(removedIn(await alexDevice.updates())).toEqual([stickerId]);
    expect(await samDevice.updates()).toEqual([]);
    expect(removedIn((await samDevice.catchUp()).flatMap(({ rows }) => rows))).toEqual([]);
  });

  it("has no effect when the sticker was already removed", async () => {
    const device = await connect(alex);
    const inbox = await spaceOwnedBy(device, SpaceKind.INBOX);
    const { stickerId } = await newTaskWithSticker(device, inbox);
    await device.push(stickerRemove(stickerId));
    await device.updates();

    const committed = await device.push(stickerRemove(stickerId));

    expect(resultOf(committed.results[0])).toEqual({ committed: true });
    expect(removedIn(await device.updates())).toEqual([stickerId]);
  });
});

describe("who can move and remove stickers", () => {
  it("lets every member who sees a shared space move and remove its stickers", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const spaceId = await newSharedSpace(alexDevice);
    const first = await newTaskWithSticker(alexDevice, spaceId);
    await samDevice.updates();

    const committed = await samDevice.push(
      stickerMove(first.stickerId, 50, 50),
      stickerRemove(first.stickerId),
    );

    expect(committed.results.map(resultOf)).toEqual([{ committed: true }, { committed: true }]);
  });

  it("refuses moving or removing a sticker in someone else's personal space, as if it didn't exist", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const personal = await spaceOwnedBy(alexDevice, SpaceKind.PERSONAL);
    const { stickerId } = await newTaskWithSticker(alexDevice, personal);

    const committed = await samDevice.push(
      stickerMove(stickerId, 50, 50),
      stickerRemove(stickerId),
    );

    expect(committed.results.map(resultOf)).toEqual([
      { refused: "There's no such sticker." },
      { refused: "There's no such sticker." },
    ]);
    expect(await stickersCaughtUpBy(alexDevice)).toEqual([
      expect.objectContaining({ id: stickerId, x: 36, y: 36 }),
    ]);
  });

  it("doesn't tell a member about a removed sticker they couldn't see", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const personal = await spaceOwnedBy(alexDevice, SpaceKind.PERSONAL);
    const { stickerId } = await newTaskWithSticker(alexDevice, personal);
    await alexDevice.push(stickerRemove(stickerId));

    const committed = await samDevice.push(stickerMove(stickerId, 50, 50));

    expect(resultOf(committed.results[0])).toEqual({ committed: true });
    expect(await samDevice.updates()).toEqual([]);
  });
});

describe("catching up with tasks and stickers", () => {
  it("sends spaces, tasks and stickers in the order they changed, in replies within the limit", async () => {
    const device = await connect(alex);
    const inbox = await spaceOwnedBy(device, SpaceKind.INBOX);
    const pageId = spacePageId(inbox, 1);
    await device.push(pageCreate(spacePage(inbox)));
    const changes = Array.from({ length: 200 }, (_, index) => {
      const task = itemCreate({ spaceId: inbox, title: `Task ${index}` });
      const place = stickerPlace({ pageId, itemId: idOf(task) });
      return [spaceCreate({ name: `Space ${index}` }), task, place];
    }).flat();
    await device.push(...changes);

    const replies = await device.catchUp();

    expect(replies.length).toBeGreaterThan(1);
    for (const reply of replies) expect(reply.rows.length).toBeLessThanOrEqual(pullReplyRowLimit);
    const rows = replies.flatMap(({ rows }) => rows);
    const seqs = rows.map(({ seq }) => Number(seq));
    expect(seqs).toEqual(seqs.toSorted((a, b) => a - b));
    expect(new Set(rows.map(({ row }) => row.value?.id)).size).toBe(rows.length);
    expect(stickersIn(rows)).toHaveLength(200);
    expect(rows.filter(({ row }) => row.case === "item")).toHaveLength(200);
  });
});

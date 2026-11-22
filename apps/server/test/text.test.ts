import { reset } from "cloudflare:test";
import { timestampMs } from "@bufbuild/protobuf/wkt";
import { a4Portrait, dayPageId, itemPageId } from "@foyer/shared";
import { PageKind } from "@foyer/shared/gen/foyer/page/v1/page_pb";
import { SpaceKind } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import { type ChangeResult, type Row, RowKind } from "@foyer/shared/gen/foyer/sync/v1/sync_pb";
import { afterEach, describe, expect, it } from "vitest";
import {
  type ChangeInit,
  Device,
  idOf,
  itemCreate,
  itemDelete,
  itemMove,
  madeAt,
  pageCreate,
  signIn,
  spaceCreate,
  textBlockCreate,
  textChange,
  textGroupCreate,
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

const day = dayPageId("2026-11-21");
const dayPage = pageCreate({ pageId: day, kind: PageKind.DAY, ...a4Portrait });

function groupsIn(rows: Row[]) {
  return rows.flatMap(({ row }) => (row.case === "textGroup" ? [row.value] : []));
}

function blocksIn(rows: Row[]) {
  return rows.flatMap(({ row }) => (row.case === "textBlock" ? [row.value] : []));
}

function deletedIn(rows: Row[], kind: RowKind) {
  return rows
    .flatMap(({ row }) => (row.case === "deleted" && row.value.kind === kind ? [row.value.id] : []))
    .sort();
}

async function rowsCaughtUpBy(device: Device, cursor = 0) {
  return (await device.catchUp(cursor)).flatMap(({ rows }) => rows);
}

function resultOf(result: ChangeResult | undefined) {
  if (result?.result.case === "refused") return { refused: result.result.value.reason };
  return { committed: result?.result.case === "seq" };
}

async function spaceOwnedBy(device: Device, kind: SpaceKind): Promise<string> {
  const rows = await rowsCaughtUpBy(device);
  const spaces = rows.flatMap(({ row }) => (row.case === "space" ? [row.value] : []));
  return spaces.find((each) => each.kind === kind)?.id ?? "";
}

async function newText(device: Device, pageId: string, ...first: ChangeInit[]) {
  const group = textGroupCreate({ pageId });
  const block = textBlockCreate({ groupId: idOf(group), markdown: "# Shopping" });
  await device.push(...first, group, block);
  await device.updates();
  return { groupId: idOf(group), blockId: idOf(block) };
}

async function newTaskWithBodyPage(device: Device, spaceId: string) {
  const task = itemCreate({ spaceId });
  const pageId = itemPageId(idOf(task));
  const body = pageCreate({ pageId, kind: PageKind.ITEM, itemId: idOf(task), ...a4Portrait });
  await device.push(task, body);
  await device.updates();
  return { itemId: idOf(task), pageId };
}

describe("text groups", () => {
  it("makes a group with its first block on a calendar page, which every member receives", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const { memberId } = await signIn(alex);
    const madeOn = Date.UTC(2026, 10, 21, 9, 30);
    const group = textGroupCreate({ pageId: day, x: 48, y: 60.5, width: 320 });
    const block = textBlockCreate(
      { groupId: idOf(group), order: "V", markdown: "Get **oat** milk" },
      { at: madeAt(madeOn) },
    );

    const committed = await alexDevice.push(dayPage, group, block);

    expect(committed.results.map(resultOf)).toEqual([
      { committed: true },
      { committed: true },
      { committed: true },
    ]);
    for (const rows of [
      await alexDevice.updates(),
      await samDevice.updates(),
      await rowsCaughtUpBy(samDevice),
    ]) {
      expect(groupsIn(rows)).toEqual([
        expect.objectContaining({
          id: idOf(group),
          pageId: day,
          x: 48,
          y: 60.5,
          width: 320,
          placedBy: memberId,
          createdBy: memberId,
        }),
      ]);
      const [received] = blocksIn(rows);
      expect(received).toEqual(
        expect.objectContaining({
          id: idOf(block),
          groupId: idOf(group),
          order: "V",
          markdown: "Get **oat** milk",
          createdBy: memberId,
        }),
      );
      expect(received?.createdAt && timestampMs(received.createdAt)).toBe(madeOn);
    }
  });

  it("sends the text on a personal task's body page only to its owner's devices", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const personal = await spaceOwnedBy(alexDevice, SpaceKind.PERSONAL);
    const { pageId } = await newTaskWithBodyPage(alexDevice, personal);
    await samDevice.updates();

    const { groupId, blockId } = await newText(alexDevice, pageId);

    expect(await samDevice.updates()).toEqual([]);
    const caughtUp = await rowsCaughtUpBy(samDevice);
    expect([...groupsIn(caughtUp), ...blocksIn(caughtUp)]).toEqual([]);
    const committed = await samDevice.push(
      textGroupCreate({ pageId }),
      textBlockCreate({ groupId }),
      textChange({ case: "textBlockEdit", value: { blockId, markdown: "Mine" } }),
    );
    expect(committed.results.map(resultOf)).toEqual([
      { refused: "There's no such page." },
      { refused: "There's no such text group." },
      { refused: "There's no such text block." },
    ]);
  });

  it("refuses a group on a page that hasn't been created, off its page, or of a bad width", async () => {
    const device = await connect(alex);
    await device.push(dayPage);

    const committed = await device.push(
      textGroupCreate({ pageId: dayPageId("2026-11-22") }),
      textGroupCreate({ pageId: day, x: -1 }),
      textGroupCreate({ pageId: day, y: a4Portrait.height + 1 }),
      textGroupCreate({ pageId: day, width: 0 }),
      textGroupCreate({ pageId: day, width: a4Portrait.width + 1 }),
      textGroupCreate({ pageId: day, groupId: "not-an-id" }),
    );

    expect(committed.results.map(resultOf)).toEqual([
      { refused: "There's no such page." },
      { refused: "A text group's top-left corner must be on its page." },
      { refused: "A text group's top-left corner must be on its page." },
      {
        refused:
          "A text group's width must be a positive number of points, no wider than its page.",
      },
      {
        refused:
          "A text group's width must be a positive number of points, no wider than its page.",
      },
      { refused: "A text group's id must be a UUID version 7." },
    ]);
  });

  it("refuses a group or a block with an id that was used before, even once deleted", async () => {
    const device = await connect(alex);
    const { groupId, blockId } = await newText(device, day, dayPage);
    await device.push(textChange({ case: "textGroupDelete", value: { groupId } }));
    const { groupId: other } = await newText(device, day);

    const committed = await device.push(
      textGroupCreate({ pageId: day, groupId }),
      textBlockCreate({ groupId: other, blockId }),
    );

    expect(committed.results.map(resultOf)).toEqual([
      { refused: "A text group with this id already exists." },
      { refused: "A text block with this id already exists." },
    ]);
  });

  it("keeps the move and the width made last, each on its own", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const { groupId } = await newText(alexDevice, day, dayPage);
    await samDevice.updates();
    const now = Date.now();

    await alexDevice.push(
      textChange(
        { case: "textGroupMove", value: { groupId, x: 100, y: 200 } },
        { at: madeAt(now) },
      ),
      textChange(
        { case: "textGroupResize", value: { groupId, width: 200 } },
        { at: madeAt(now - 5_000) },
      ),
    );
    await samDevice.push(
      textChange(
        { case: "textGroupMove", value: { groupId, x: 10, y: 20 } },
        { at: madeAt(now - 10_000) },
      ),
      textChange({ case: "textGroupResize", value: { groupId, width: 250 } }, { at: madeAt(now) }),
    );

    for (const device of [alexDevice, samDevice]) {
      const [group] = groupsIn(await rowsCaughtUpBy(device));
      expect(group).toEqual(expect.objectContaining({ x: 100, y: 200, width: 250 }));
    }
  });

  it("deletes a group with its blocks, which then can't be changed or added to", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const { groupId, blockId } = await newText(alexDevice, day, dayPage);
    await samDevice.updates();

    await samDevice.push(textChange({ case: "textGroupDelete", value: { groupId } }));

    for (const rows of [await alexDevice.updates(), await rowsCaughtUpBy(alexDevice)]) {
      expect(deletedIn(rows, RowKind.TEXT_GROUP)).toEqual([groupId]);
      expect(deletedIn(rows, RowKind.TEXT_BLOCK)).toEqual([blockId]);
      expect([...groupsIn(rows), ...blocksIn(rows)]).toEqual([]);
    }
    const late = textBlockCreate({ groupId });
    const committed = await alexDevice.push(
      textChange({ case: "textGroupMove", value: { groupId, x: 1, y: 1 } }),
      textChange({ case: "textBlockEdit", value: { blockId, markdown: "Too late" } }),
      late,
      textChange({ case: "textGroupDelete", value: { groupId } }),
    );
    expect(committed.results.map(resultOf)).toEqual([
      { committed: true },
      { committed: true },
      { committed: true },
      { committed: true },
    ]);
    expect(blocksIn(await rowsCaughtUpBy(alexDevice))).toEqual([]);
  });
});

describe("text blocks", () => {
  it("adds blocks at their order, and keeps the edit made last on a whole block", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const { groupId, blockId } = await newText(alexDevice, day, dayPage);
    const now = Date.now();
    const second = textBlockCreate({ groupId, order: "k", markdown: "- Oat milk" });

    await alexDevice.push(
      second,
      textChange(
        { case: "textBlockEdit", value: { blockId, markdown: "# Groceries" } },
        { at: madeAt(now) },
      ),
    );
    await samDevice.push(
      textChange(
        { case: "textBlockEdit", value: { blockId, markdown: "# Shops" } },
        { at: madeAt(now - 1_000) },
      ),
    );

    for (const device of [alexDevice, samDevice]) {
      const blocks = blocksIn(await rowsCaughtUpBy(device)).sort((a, b) =>
        a.order < b.order ? -1 : 1,
      );
      expect(blocks.map(({ id, order, markdown }) => ({ id, order, markdown }))).toEqual([
        { id: blockId, order: "V", markdown: "# Groceries" },
        { id: idOf(second), order: "k", markdown: "- Oat milk" },
      ]);
    }
  });

  it("refuses Markdown that's more than a block holds, and orders that aren't orders", async () => {
    const device = await connect(alex);
    const { groupId, blockId } = await newText(device, day, dayPage);

    const committed = await device.push(
      textBlockCreate({ groupId, markdown: "[a link](https://example.com)" }),
      textBlockCreate({ groupId, markdown: "one\ntwo" }),
      textBlockCreate({ groupId, order: "a0" }),
      textChange({ case: "textBlockEdit", value: { blockId, markdown: "a".repeat(10_001) } }),
      textChange({ case: "textBlockMove", value: { blockId, groupId, order: "" } }),
    );

    expect(committed.results.map(resultOf)).toEqual([
      {
        refused:
          "A block's Markdown can only hold its type, bold and italic, with anything else escaped.",
      },
      { refused: "A block's text can't hold line breaks." },
      {
        refused:
          "A block's order must be made of 0-9, A-Z and a-z, not end in 0, and be at most 1,000 characters.",
      },
      { refused: "A block can't be longer than 10,000 characters." },
      {
        refused:
          "A block's order must be made of 0-9, A-Z and a-z, not end in 0, and be at most 1,000 characters.",
      },
    ]);
  });

  it("moves blocks to a new group and back, as splitting and joining groups do", async () => {
    const device = await connect(alex);
    const { groupId, blockId } = await newText(device, day, dayPage);
    const second = textBlockCreate({ groupId, order: "k", markdown: "Second" });
    await device.push(second);
    const split = textGroupCreate({ pageId: day, y: 300 });

    const committed = await device.push(
      split,
      textChange({
        case: "textBlockMove",
        value: { blockId: idOf(second), groupId: idOf(split), order: "V" },
      }),
    );

    expect(committed.results.map(resultOf)).toEqual([{ committed: true }, { committed: true }]);
    let blocks = blocksIn(await rowsCaughtUpBy(device));
    expect(blocks.find(({ id }) => id === idOf(second))?.groupId).toBe(idOf(split));

    await device.push(
      textChange({
        case: "textBlockMove",
        value: { blockId: idOf(second), groupId, order: "k" },
      }),
      textChange({ case: "textGroupDelete", value: { groupId: idOf(split) } }),
    );

    const rows = await rowsCaughtUpBy(device);
    blocks = blocksIn(rows);
    expect(blocks.map(({ id, groupId }) => ({ id, groupId }))).toEqual([
      { id: blockId, groupId },
      { id: idOf(second), groupId },
    ]);
    expect(groupsIn(rows).map(({ id }) => id)).toEqual([groupId]);
  });

  it("ignores resizing a deleted group and moving a block to one", async () => {
    const device = await connect(alex);
    const { blockId } = await newText(device, day, dayPage);
    const { groupId: deleted } = await newText(device, day);
    await device.push(textChange({ case: "textGroupDelete", value: { groupId: deleted } }));

    const committed = await device.push(
      textChange({ case: "textGroupResize", value: { groupId: deleted, width: 100 } }),
      textChange({ case: "textBlockMove", value: { blockId, groupId: deleted, order: "k" } }),
    );

    expect(committed.results.map(resultOf)).toEqual([{ committed: true }, { committed: true }]);
    const rows = await rowsCaughtUpBy(device);
    expect(groupsIn(rows).map(({ id }) => id)).not.toContain(deleted);
    expect(blocksIn(rows).find(({ id }) => id === blockId)?.groupId).not.toBe(deleted);
  });

  it("refuses moving a block to a group on another page", async () => {
    const device = await connect(alex);
    const { blockId } = await newText(device, day, dayPage);
    const other = dayPageId("2026-11-22");
    const { groupId } = await newText(
      device,
      other,
      pageCreate({ pageId: other, kind: PageKind.DAY, ...a4Portrait }),
    );

    const committed = await device.push(
      textChange({ case: "textBlockMove", value: { blockId, groupId, order: "k" } }),
    );

    expect(resultOf(committed.results[0])).toEqual({
      refused: "A text block can only move to a group on its own page.",
    });
  });

  it("deletes a block, and deleting it again has no effect", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const { blockId } = await newText(alexDevice, day, dayPage);
    await samDevice.updates();

    await alexDevice.push(textChange({ case: "textBlockDelete", value: { blockId } }));

    expect(deletedIn(await samDevice.updates(), RowKind.TEXT_BLOCK)).toEqual([blockId]);
    const again = await samDevice.push(textChange({ case: "textBlockDelete", value: { blockId } }));
    expect(resultOf(again.results[0])).toEqual({ committed: true });
    expect(blocksIn(await rowsCaughtUpBy(samDevice))).toEqual([]);
  });
});

describe("text on an item's pages", () => {
  it("is deleted with its item", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const shared = await newSharedSpace(alexDevice);
    const { itemId, pageId } = await newTaskWithBodyPage(alexDevice, shared);
    const { groupId, blockId } = await newText(alexDevice, pageId);
    await samDevice.updates();

    await samDevice.push(itemDelete(itemId));

    for (const device of [alexDevice, samDevice]) {
      const live = await device.updates();
      expect(deletedIn(live, RowKind.TEXT_GROUP)).toEqual([groupId]);
      expect(deletedIn(live, RowKind.TEXT_BLOCK)).toEqual([blockId]);
      const caughtUp = await rowsCaughtUpBy(device);
      expect([...groupsIn(caughtUp), ...blocksIn(caughtUp)]).toEqual([]);
    }
  });

  it("moves out of other members' sight with its item, and back", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const shared = await newSharedSpace(alexDevice);
    const inbox = await spaceOwnedBy(alexDevice, SpaceKind.INBOX);
    const { itemId, pageId } = await newTaskWithBodyPage(alexDevice, shared);
    const { groupId, blockId } = await newText(alexDevice, pageId);
    await samDevice.updates();
    const [before] = (await samDevice.catchUp()).slice(-1);

    await alexDevice.push(itemMove(itemId, inbox));

    for (const rows of [
      await samDevice.updates(),
      await rowsCaughtUpBy(samDevice, Number(before?.cursor)),
    ]) {
      expect(deletedIn(rows, RowKind.TEXT_GROUP)).toEqual([groupId]);
      expect(deletedIn(rows, RowKind.TEXT_BLOCK)).toEqual([blockId]);
    }

    await alexDevice.push(itemMove(itemId, shared));

    const back = await samDevice.updates();
    expect(groupsIn(back).map(({ id }) => id)).toEqual([groupId]);
    expect(blocksIn(back).map(({ id }) => id)).toEqual([blockId]);
    expect(blocksIn(await rowsCaughtUpBy(samDevice)).map(({ id }) => id)).toEqual([blockId]);
  });
});

async function newSharedSpace(device: Device): Promise<string> {
  const create = spaceCreate({ name: "Home", kind: SpaceKind.SHARED });
  await device.push(create);
  await device.updates();
  return idOf(create);
}

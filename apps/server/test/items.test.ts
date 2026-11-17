import { reset } from "cloudflare:test";
import { timestampMs } from "@bufbuild/protobuf/wkt";
import { newId } from "@foyer/shared";
import { ItemKind } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import { SpaceKind } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import type { ChangeResult, Row } from "@foyer/shared/gen/foyer/sync/v1/sync_pb";
import { afterEach, describe, expect, it } from "vitest";
import { Device, idOf, itemCreate, madeAt, signIn, spaceCreate } from "./sync-device";

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

import { reset } from "cloudflare:test";
import { timestampMs } from "@bufbuild/protobuf/wkt";
import { newId } from "@foyer/shared";
import { SpaceKind } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import { type ChangeResult, type Row, RowKind } from "@foyer/shared/gen/foyer/sync/v1/sync_pb";
import { afterEach, describe, expect, it } from "vitest";
import {
  Device,
  idOf,
  itemCreate,
  itemDelete,
  madeAt,
  signIn,
  spaceCreate,
  taskTick,
  taskUntick,
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

function completionsIn(rows: Row[]) {
  return rows.flatMap(({ row }) =>
    row.case === "completion"
      ? [
          {
            id: row.value.id,
            itemId: row.value.itemId,
            occurrence: row.value.occurrence,
            doneAt: row.value.doneAt ? timestampMs(row.value.doneAt) : null,
            doneBy: row.value.doneBy,
          },
        ]
      : [],
  );
}

function deletedIn(rows: Row[], kind: RowKind) {
  return rows.flatMap(({ row }) =>
    row.case === "deleted" && row.value.kind === kind ? [row.value.id] : [],
  );
}

async function rowsCaughtUpBy(device: Device) {
  return (await device.catchUp()).flatMap(({ rows }) => rows);
}

async function spaceOwnedBy(device: Device, kind: SpaceKind): Promise<string> {
  const rows = await rowsCaughtUpBy(device);
  const space = rows.flatMap(({ row }) => (row.case === "space" ? [row.value] : []));
  return space.find((each) => each.kind === kind)?.id ?? "";
}

async function newSharedSpace(device: Device): Promise<string> {
  const create = spaceCreate({ name: "Home", kind: SpaceKind.SHARED });
  await device.push(create);
  await device.updates();
  return idOf(create);
}

async function newTask(device: Device, spaceId: string) {
  const create = itemCreate({ spaceId }, { at: madeAt(Date.now() - 60_000) });
  await device.push(create);
  await device.updates();
  return idOf(create);
}

function resultOf(result: ChangeResult | undefined) {
  if (result?.result.case === "refused") return { refused: result.result.value.reason };
  return { committed: result?.result.case === "seq" };
}

function secondsAgo(seconds: number) {
  return { at: madeAt(Date.now() - seconds * 1000) };
}

describe("ticking tasks", () => {
  it("adds a completion and sends it to every device that sees the task", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const { memberId: samId } = await signIn(sam);
    const itemId = await newTask(alexDevice, await newSharedSpace(alexDevice));
    await samDevice.updates();
    const tickedAt = Date.now() - 5_000;

    const tick = taskTick({ itemId }, { at: madeAt(tickedAt) });
    const committed = await samDevice.push(tick);

    expect(resultOf(committed.results[0])).toEqual({ committed: true });
    const completion = { id: idOf(tick), itemId, occurrence: "", doneAt: tickedAt, doneBy: samId };
    for (const device of [alexDevice, samDevice]) {
      expect(completionsIn(await device.updates())).toEqual([completion]);
      expect(completionsIn(await rowsCaughtUpBy(device))).toEqual([completion]);
    }
  });

  it("sends a personal task's completion only to its owner's devices", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const itemId = await newTask(alexDevice, await spaceOwnedBy(alexDevice, SpaceKind.PERSONAL));

    await alexDevice.push(taskTick({ itemId }));

    expect(completionsIn(await alexDevice.updates())).toHaveLength(1);
    expect(await samDevice.updates()).toEqual([]);
    expect(completionsIn(await rowsCaughtUpBy(samDevice))).toEqual([]);
  });

  it("keeps the first completion when two devices tick a task offline", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const itemId = await newTask(alexDevice, await newSharedSpace(alexDevice));
    const first = taskTick({ itemId }, secondsAgo(20));
    await alexDevice.push(first);
    await samDevice.updates();

    const committed = await samDevice.push(taskTick({ itemId }, secondsAgo(10)));

    expect(resultOf(committed.results[0])).toEqual({ committed: true });
    expect(completionsIn(await samDevice.updates()).map(({ id }) => id)).toEqual([idOf(first)]);
    expect(completionsIn(await rowsCaughtUpBy(alexDevice)).map(({ id }) => id)).toEqual([
      idOf(first),
    ]);
  });

  it("refuses ticking a task the member doesn't see, or one that doesn't exist", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const itemId = await newTask(alexDevice, await spaceOwnedBy(alexDevice, SpaceKind.INBOX));

    const committed = await samDevice.push(taskTick({ itemId }), taskTick({ itemId: newId() }));

    expect(committed.results.map(resultOf)).toEqual([
      { refused: "There's no such item." },
      { refused: "There's no such item." },
    ]);
    expect(await alexDevice.updates()).toEqual([]);
  });

  it("refuses an occurrence, since tasks don't repeat yet", async () => {
    const device = await connect(alex);
    const itemId = await newTask(device, await spaceOwnedBy(device, SpaceKind.INBOX));

    const committed = await device.push(
      taskTick({ itemId, occurrence: "2026-11-17" }),
      taskUntick({ itemId, occurrence: "2026-11-17" }),
    );

    const refused = { refused: "Tasks don't repeat yet, so they have no occurrences." };
    expect(committed.results.map(resultOf)).toEqual([refused, refused]);
  });

  it("refuses a completion whose id another completion has, even one that was unticked", async () => {
    const device = await connect(alex);
    const itemId = await newTask(device, await spaceOwnedBy(device, SpaceKind.INBOX));
    const tick = taskTick({ itemId }, secondsAgo(20));
    await device.push(tick, taskUntick({ itemId }, secondsAgo(10)));
    const committed = await device.push(taskTick({ itemId, completionId: idOf(tick) }));

    expect(resultOf(committed.results[0])).toEqual({
      refused: "A completion with this id already exists.",
    });
  });

  it("has no effect on a deleted task, and sends the device its deletion", async () => {
    const device = await connect(alex);
    const itemId = await newTask(device, await spaceOwnedBy(device, SpaceKind.INBOX));
    await device.push(itemDelete(itemId));
    await device.updates();

    const committed = await device.push(taskTick({ itemId }), taskUntick({ itemId }));

    expect(committed.results.map(resultOf)).toEqual([{ committed: true }, { committed: true }]);
    expect(deletedIn(await device.updates(), RowKind.ITEM)).toEqual([itemId]);
  });
});

describe("unticking tasks", () => {
  it("removes the completion for every device, whoever ticked the task", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const itemId = await newTask(alexDevice, await newSharedSpace(alexDevice));
    const tick = taskTick({ itemId }, secondsAgo(10));
    await alexDevice.push(tick);
    await samDevice.updates();

    const committed = await samDevice.push(taskUntick({ itemId }));

    expect(resultOf(committed.results[0])).toEqual({ committed: true });
    for (const device of [alexDevice, samDevice]) {
      expect(deletedIn(await device.updates(), RowKind.COMPLETION)).toEqual([idOf(tick)]);
      const rows = await rowsCaughtUpBy(device);
      expect(completionsIn(rows)).toEqual([]);
      expect(deletedIn(rows, RowKind.COMPLETION)).toEqual([idOf(tick)]);
    }
  });

  it("ticks a task again with a new completion", async () => {
    const device = await connect(alex);
    const itemId = await newTask(device, await spaceOwnedBy(device, SpaceKind.INBOX));
    await device.push(taskTick({ itemId }, secondsAgo(30)), taskUntick({ itemId }, secondsAgo(20)));
    await device.updates();

    const again = taskTick({ itemId }, secondsAgo(10));
    await device.push(again);

    expect(completionsIn(await rowsCaughtUpBy(device)).map(({ id }) => id)).toEqual([idOf(again)]);
  });

  it("has no effect on a task that isn't ticked", async () => {
    const device = await connect(alex);
    const itemId = await newTask(device, await spaceOwnedBy(device, SpaceKind.INBOX));

    const committed = await device.push(taskUntick({ itemId }));

    expect(resultOf(committed.results[0])).toEqual({ committed: true });
    expect(await device.updates()).toEqual([]);
  });
});

describe("ticking and unticking offline", () => {
  it("keeps a task unticked when the untick was made after a tick that arrives later", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const itemId = await newTask(alexDevice, await newSharedSpace(alexDevice));
    await alexDevice.push(taskTick({ itemId }, secondsAgo(40)));
    await samDevice.push(taskUntick({ itemId }, secondsAgo(10)));
    await alexDevice.updates();

    const committed = await alexDevice.push(taskTick({ itemId }, secondsAgo(20)));

    expect(resultOf(committed.results[0])).toEqual({ committed: true });
    expect(await alexDevice.updates()).toEqual([]);
    expect(completionsIn(await rowsCaughtUpBy(samDevice))).toEqual([]);
  });

  it("keeps a task ticked when a tick was made after an untick that arrives later", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const itemId = await newTask(alexDevice, await newSharedSpace(alexDevice));
    const tick = taskTick({ itemId }, secondsAgo(40));
    await alexDevice.push(tick);
    await samDevice.push(taskTick({ itemId }, secondsAgo(10)));
    await samDevice.updates();
    await alexDevice.updates();

    const committed = await alexDevice.push(taskUntick({ itemId }, secondsAgo(20)));

    expect(resultOf(committed.results[0])).toEqual({ committed: true });
    expect(completionsIn(await alexDevice.updates()).map(({ id }) => id)).toEqual([idOf(tick)]);
    expect(completionsIn(await rowsCaughtUpBy(samDevice)).map(({ id }) => id)).toEqual([
      idOf(tick),
    ]);
  });
});

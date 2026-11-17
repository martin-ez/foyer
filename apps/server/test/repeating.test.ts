import { reset } from "cloudflare:test";
import { RepeatFrom } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import { SpaceKind } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import { type ChangeResult, type Row, RowKind } from "@foyer/shared/gen/foyer/sync/v1/sync_pb";
import { afterEach, describe, expect, it } from "vitest";
import {
  Device,
  idOf,
  itemCreate,
  itemDelete,
  itemSetDate,
  itemSetRepeat,
  madeAt,
  signIn,
  spaceCreate,
  taskTick,
  taskUntick,
} from "./sync-device";

const alex = "member@example.com";
const sam = "housemate@example.com";
const bins = "FREQ=WEEKLY;BYDAY=TU";

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
  return rows.flatMap(({ row }) =>
    row.case === "item"
      ? [
          {
            id: row.value.id,
            date: row.value.date,
            repeat: row.value.repeat,
            repeatFrom: row.value.repeatFrom,
          },
        ]
      : [],
  );
}

function completionsIn(rows: Row[]) {
  return rows.flatMap(({ row }) =>
    row.case === "completion"
      ? [{ id: row.value.id, itemId: row.value.itemId, occurrence: row.value.occurrence }]
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

async function taskAsCaughtUpBy(device: Device, itemId: string) {
  return itemsIn(await rowsCaughtUpBy(device)).find(({ id }) => id === itemId);
}

function resultOf(result: ChangeResult | undefined) {
  if (result?.result.case === "refused") return { refused: result.result.value.reason };
  return { committed: result?.result.case === "seq" };
}

function secondsAgo(seconds: number) {
  return { at: madeAt(Date.now() - seconds * 1000) };
}

async function inboxOf(device: Device): Promise<string> {
  const rows = await rowsCaughtUpBy(device);
  const spaces = rows.flatMap(({ row }) => (row.case === "space" ? [row.value] : []));
  return spaces.find(({ kind }) => kind === SpaceKind.INBOX)?.id ?? "";
}

async function newSharedSpace(device: Device): Promise<string> {
  const create = spaceCreate({ name: "Home", kind: SpaceKind.SHARED });
  await device.push(create);
  await device.updates();
  return idOf(create);
}

async function newTask(device: Device, spaceId: string, date: string, repeat?: string) {
  const create = itemCreate({ spaceId, date }, secondsAgo(60));
  await device.push(create);
  if (repeat) await device.push(itemSetRepeat(idOf(create), repeat, RepeatFrom.SCHEDULE));
  await device.updates();
  return idOf(create);
}

describe("setting a task's rule", () => {
  it("sends the rule and where its next date comes from to every device that sees the task", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const itemId = await newTask(alexDevice, await newSharedSpace(alexDevice), "2026-11-17");
    await samDevice.updates();

    const committed = await samDevice.push(
      itemSetRepeat(itemId, "FREQ=DAILY;INTERVAL=3", RepeatFrom.COMPLETION),
    );

    expect(resultOf(committed.results[0])).toEqual({ committed: true });
    const task = {
      id: itemId,
      date: "2026-11-17",
      repeat: "FREQ=DAILY;INTERVAL=3",
      repeatFrom: RepeatFrom.COMPLETION,
    };
    for (const device of [alexDevice, samDevice]) {
      expect(itemsIn(await device.updates())).toEqual([task]);
      expect(await taskAsCaughtUpBy(device, itemId)).toEqual(task);
    }
  });

  it("keeps a rule as Foyer writes it", async () => {
    const device = await connect(alex);
    const itemId = await newTask(device, await inboxOf(device), "2026-11-17");

    await device.push(itemSetRepeat(itemId, "byday=FR,MO;freq=weekly;interval=1"));

    expect(itemsIn(await device.updates())[0]?.repeat).toBe("FREQ=WEEKLY;BYDAY=MO,FR");
  });

  it("stops a task repeating, keeping its date", async () => {
    const device = await connect(alex);
    const itemId = await newTask(device, await inboxOf(device), "2026-11-17", bins);

    await device.push(itemSetRepeat(itemId, ""));

    expect(itemsIn(await device.updates())).toEqual([
      { id: itemId, date: "2026-11-17", repeat: "", repeatFrom: RepeatFrom.UNSPECIFIED },
    ]);
  });

  it("keeps the rule set last, by the device's clock, whichever arrives first", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const itemId = await newTask(alexDevice, await newSharedSpace(alexDevice), "2026-11-17");
    await alexDevice.push(itemSetRepeat(itemId, bins, RepeatFrom.SCHEDULE, secondsAgo(10)));
    await samDevice.updates();

    const committed = await samDevice.push(
      itemSetRepeat(itemId, "FREQ=DAILY", RepeatFrom.COMPLETION, secondsAgo(20)),
    );

    expect(resultOf(committed.results[0])).toEqual({ committed: true });
    expect(await taskAsCaughtUpBy(samDevice, itemId)).toEqual(
      expect.objectContaining({ repeat: bins, repeatFrom: RepeatFrom.SCHEDULE }),
    );
  });

  it("refuses a rule Foyer can't repeat by, or one that doesn't say where its next date comes from", async () => {
    const device = await connect(alex);
    const itemId = await newTask(device, await inboxOf(device), "2026-11-17");

    const committed = await device.push(
      itemSetRepeat(itemId, "FREQ=DAILY;COUNT=3"),
      itemSetRepeat(itemId, bins, RepeatFrom.UNSPECIFIED),
    );

    expect(committed.results.map(resultOf)).toEqual([
      { refused: "Foyer can't repeat a task by this rule." },
      { refused: "A repeating task must say where its next date comes from." },
    ]);
    expect(await device.updates()).toEqual([]);
  });

  it("refuses a rule on a task without a date, and takes one sent with its first date", async () => {
    const device = await connect(alex);
    const itemId = await newTask(device, await inboxOf(device), "");

    const refused = await device.push(itemSetRepeat(itemId, bins));
    const committed = await device.push(
      itemSetDate(itemId, "2026-11-17"),
      itemSetRepeat(itemId, bins),
    );

    expect(resultOf(refused.results[0])).toEqual({ refused: "A task needs a date to repeat." });
    expect(committed.results.map(resultOf)).toEqual([{ committed: true }, { committed: true }]);
    expect(await taskAsCaughtUpBy(device, itemId)).toEqual(
      expect.objectContaining({ date: "2026-11-17", repeat: bins }),
    );
  });

  it("refuses clearing a repeating task's date", async () => {
    const device = await connect(alex);
    const itemId = await newTask(device, await inboxOf(device), "2026-11-17", bins);

    const committed = await device.push(itemSetDate(itemId, ""));

    expect(resultOf(committed.results[0])).toEqual({
      refused: "A repeating task always has a date. Stop it repeating first.",
    });
    expect(await device.updates()).toEqual([]);
  });

  it("has no effect on a deleted task", async () => {
    const device = await connect(alex);
    const itemId = await newTask(device, await inboxOf(device), "2026-11-17");
    await device.push(itemDelete(itemId));
    await device.updates();

    const committed = await device.push(itemSetRepeat(itemId, bins));

    expect(resultOf(committed.results[0])).toEqual({ committed: true });
    expect(deletedIn(await device.updates(), RowKind.ITEM)).toEqual([itemId]);
  });
});

describe("ticking a repeating task", () => {
  it("records the occurrence ticked and moves the task to its next date, on every device", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const itemId = await newTask(alexDevice, await newSharedSpace(alexDevice), "2026-11-17", bins);
    await samDevice.updates();

    const tick = taskTick({ itemId, occurrence: "2026-11-17", nextDate: "2026-11-24" });
    const committed = await samDevice.push(tick);

    expect(resultOf(committed.results[0])).toEqual({ committed: true });
    for (const device of [alexDevice, samDevice]) {
      const rows = await device.updates();
      expect(completionsIn(rows)).toEqual([{ id: idOf(tick), itemId, occurrence: "2026-11-17" }]);
      expect(itemsIn(rows)).toEqual([expect.objectContaining({ date: "2026-11-24" })]);
    }
  });

  it("keeps a completion for each occurrence ticked", async () => {
    const device = await connect(alex);
    const itemId = await newTask(device, await inboxOf(device), "2026-11-17", bins);

    await device.push(
      taskTick({ itemId, occurrence: "2026-11-17", nextDate: "2026-11-24" }, secondsAgo(20)),
      taskTick({ itemId, occurrence: "2026-11-24", nextDate: "2026-12-01" }, secondsAgo(10)),
    );

    const rows = await rowsCaughtUpBy(device);
    expect(completionsIn(rows).map(({ occurrence }) => occurrence)).toEqual([
      "2026-11-17",
      "2026-11-24",
    ]);
    expect(itemsIn(rows)[0]?.date).toBe("2026-12-01");
  });

  it("moves the task once when two devices tick the same occurrence offline", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const itemId = await newTask(alexDevice, await newSharedSpace(alexDevice), "2026-11-17", bins);
    const first = taskTick(
      { itemId, occurrence: "2026-11-17", nextDate: "2026-11-24" },
      secondsAgo(20),
    );
    await alexDevice.push(first);
    await samDevice.updates();

    const committed = await samDevice.push(
      taskTick({ itemId, occurrence: "2026-11-17", nextDate: "2026-11-24" }, secondsAgo(10)),
    );

    expect(resultOf(committed.results[0])).toEqual({ committed: true });
    const rows = await rowsCaughtUpBy(alexDevice);
    expect(completionsIn(rows).map(({ id }) => id)).toEqual([idOf(first)]);
    expect(itemsIn(rows)[0]?.date).toBe("2026-11-24");
  });

  it("keeps a date changed after a tick made offline, which arrives later", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const itemId = await newTask(alexDevice, await newSharedSpace(alexDevice), "2026-11-17", bins);
    await samDevice.push(itemSetDate(itemId, "2026-11-19", secondsAgo(10)));
    await alexDevice.updates();

    const committed = await alexDevice.push(
      taskTick({ itemId, occurrence: "2026-11-17", nextDate: "2026-11-24" }, secondsAgo(20)),
    );

    expect(resultOf(committed.results[0])).toEqual({ committed: true });
    const rows = await rowsCaughtUpBy(samDevice);
    expect(completionsIn(rows).map(({ occurrence }) => occurrence)).toEqual(["2026-11-17"]);
    expect(itemsIn(rows)[0]?.date).toBe("2026-11-19");
  });

  it("moves the task when its date was changed before a tick made offline, which arrives later", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const itemId = await newTask(alexDevice, await newSharedSpace(alexDevice), "2026-11-17", bins);
    await samDevice.push(itemSetDate(itemId, "2026-11-19", secondsAgo(20)));
    await alexDevice.updates();

    await alexDevice.push(
      taskTick({ itemId, occurrence: "2026-11-17", nextDate: "2026-11-24" }, secondsAgo(10)),
    );

    expect(itemsIn(await rowsCaughtUpBy(samDevice))[0]?.date).toBe("2026-11-24");
  });

  it("refuses a tick without its occurrence and next date, or one that doesn't move the task", async () => {
    const device = await connect(alex);
    const itemId = await newTask(device, await inboxOf(device), "2026-11-17", bins);

    const committed = await device.push(
      taskTick({ itemId }),
      taskTick({ itemId, occurrence: "2026-11-17" }),
      taskTick({ itemId, occurrence: "2026-11-17", nextDate: "next week" }),
      taskTick({ itemId, occurrence: "2026-11-17", nextDate: "2026-11-17" }),
    );

    const unnamed = {
      refused: "This task repeats, so a tick must name its occurrence and next date.",
    };
    expect(committed.results.map(resultOf)).toEqual([
      unnamed,
      unnamed,
      unnamed,
      { refused: "A repeating task's next date can't be the occurrence ticked." },
    ]);
    expect(await device.updates()).toEqual([]);
  });
});

describe("unticking a repeating task", () => {
  it("removes the completion and puts the task back on the occurrence, on every device", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const itemId = await newTask(alexDevice, await newSharedSpace(alexDevice), "2026-11-17", bins);
    const tick = taskTick(
      { itemId, occurrence: "2026-11-17", nextDate: "2026-11-24" },
      secondsAgo(10),
    );
    await alexDevice.push(tick);
    await alexDevice.updates();
    await samDevice.updates();

    const committed = await samDevice.push(taskUntick({ itemId, occurrence: "2026-11-17" }));

    expect(resultOf(committed.results[0])).toEqual({ committed: true });
    for (const device of [alexDevice, samDevice]) {
      const rows = await device.updates();
      expect(deletedIn(rows, RowKind.COMPLETION)).toEqual([idOf(tick)]);
      expect(itemsIn(rows)).toEqual([expect.objectContaining({ date: "2026-11-17" })]);
    }
  });

  it("leaves the date alone when it was changed after the tick", async () => {
    const device = await connect(alex);
    const itemId = await newTask(device, await inboxOf(device), "2026-11-17", bins);
    const tick = taskTick(
      { itemId, occurrence: "2026-11-17", nextDate: "2026-11-24" },
      secondsAgo(30),
    );
    await device.push(tick, itemSetDate(itemId, "2026-11-25", secondsAgo(20)));
    await device.updates();

    await device.push(taskUntick({ itemId, occurrence: "2026-11-17" }, secondsAgo(10)));

    const rows = await device.updates();
    expect(deletedIn(rows, RowKind.COMPLETION)).toEqual([idOf(tick)]);
    expect(itemsIn(rows)).toEqual([]);
    expect(itemsIn(await rowsCaughtUpBy(device))[0]?.date).toBe("2026-11-25");
  });

  it("leaves the date alone when the tick didn't move it", async () => {
    const device = await connect(alex);
    const itemId = await newTask(device, await inboxOf(device), "2026-11-17", bins);
    await device.push(itemSetDate(itemId, "2026-11-19", secondsAgo(10)));
    await device.push(
      taskTick({ itemId, occurrence: "2026-11-17", nextDate: "2026-11-24" }, secondsAgo(20)),
    );
    await device.updates();

    await device.push(taskUntick({ itemId, occurrence: "2026-11-17" }));

    expect(itemsIn(await device.updates())).toEqual([]);
    expect(itemsIn(await rowsCaughtUpBy(device))[0]?.date).toBe("2026-11-19");
  });

  it("unticks an occurrence ticked before the task stopped repeating", async () => {
    const device = await connect(alex);
    const itemId = await newTask(device, await inboxOf(device), "2026-11-17", bins);
    const tick = taskTick({ itemId, occurrence: "2026-11-17", nextDate: "2026-11-24" });
    await device.push(tick, itemSetRepeat(itemId, ""));
    await device.updates();

    const committed = await device.push(taskUntick({ itemId, occurrence: "2026-11-17" }));

    expect(resultOf(committed.results[0])).toEqual({ committed: true });
    expect(deletedIn(await device.updates(), RowKind.COMPLETION)).toEqual([idOf(tick)]);
  });

  it("refuses an occurrence that isn't a day", async () => {
    const device = await connect(alex);
    const itemId = await newTask(device, await inboxOf(device), "2026-11-17", bins);

    const committed = await device.push(taskUntick({ itemId, occurrence: "Tuesday" }));

    expect(resultOf(committed.results[0])).toEqual({
      refused: "An occurrence is a day, as in “2026-11-17”.",
    });
  });
});

describe("a task that starts or stops repeating", () => {
  it("keeps the completions made while it didn't repeat, and ticks occurrences once it does", async () => {
    const device = await connect(alex);
    const itemId = await newTask(device, await inboxOf(device), "2026-11-17");
    const once = taskTick({ itemId }, secondsAgo(30));
    await device.push(once, itemSetRepeat(itemId, bins, RepeatFrom.SCHEDULE, secondsAgo(20)));

    const committed = await device.push(
      taskTick({ itemId, occurrence: "2026-11-17", nextDate: "2026-11-24" }, secondsAgo(10)),
    );

    expect(resultOf(committed.results[0])).toEqual({ committed: true });
    expect(completionsIn(await rowsCaughtUpBy(device)).map(({ occurrence }) => occurrence)).toEqual(
      ["", "2026-11-17"],
    );
  });

  it("refuses a tick without its occurrence once a task repeats", async () => {
    const device = await connect(alex);
    const itemId = await newTask(device, await inboxOf(device), "2026-11-17", bins);

    const committed = await device.push(taskTick({ itemId }));

    expect(resultOf(committed.results[0])).toEqual({
      refused: "This task repeats, so a tick must name its occurrence and next date.",
    });
  });
});

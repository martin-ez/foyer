import { reset } from "cloudflare:test";
import { timestampMs } from "@bufbuild/protobuf/wkt";
import { a4Portrait, dayPageId, encodeSamples, itemPageId, spacePageId } from "@foyer/shared";
import { Input, Tool } from "@foyer/shared/gen/foyer/ink/v1/ink_pb";
import { PageKind } from "@foyer/shared/gen/foyer/page/v1/page_pb";
import { SpaceKind } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import { type ChangeResult, type Row, RowKind } from "@foyer/shared/gen/foyer/sync/v1/sync_pb";
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
  spaceSetArchived,
  strokeAdd,
  strokeErase,
} from "./sync-device";

const alex = "member@example.com";
const sam = "housemate@example.com";
const robin = "flatmate@example.com";

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

const day = dayPageId("2026-11-23");
const dayPage = pageCreate({ pageId: day, kind: PageKind.DAY, ...a4Portrait });
const nextDay = dayPageId("2026-11-24");
const nextDayPage = pageCreate({ pageId: nextDay, kind: PageKind.DAY, ...a4Portrait });

function strokesIn(rows: Row[]) {
  return rows.flatMap(({ row }) => (row.case === "stroke" ? [row.value] : []));
}

function erasedIn(rows: Row[]) {
  return rows
    .flatMap(({ row }) =>
      row.case === "deleted" && row.value.kind === RowKind.STROKE ? [row.value.id] : [],
    )
    .sort();
}

async function inkOf(device: Device, pageId: string, cursor = 0) {
  return (await device.catchUpInk(pageId, cursor)).flatMap(({ rows }) => rows);
}

function resultOf(result: ChangeResult | undefined) {
  if (result?.result.case === "refused") return { refused: result.result.value.reason };
  return { committed: result?.result.case === "seq" };
}

async function personalSpaceOf(device: Device): Promise<string> {
  const rows = (await device.catchUp()).flatMap(({ rows }) => rows);
  const spaces = rows.flatMap(({ row }) => (row.case === "space" ? [row.value] : []));
  return spaces.find(({ kind }) => kind === SpaceKind.PERSONAL)?.id ?? "";
}

function longSamples(count: number) {
  const indexes = Array.from({ length: count }, (_, index) => index);
  return encodeSamples({
    x: indexes.map((index) => 100 + Math.sin(index / 7) * 80),
    y: indexes.map((index) => 100 + Math.cos(index / 5) * 80),
    time: indexes.map((index) => index * 4),
    force: indexes.map((index) => 0.5 + Math.sin(index / 3) * 0.4),
    altitude: indexes.map((index) => 0.9 + Math.sin(index / 11) * 0.3),
    azimuth: indexes.map((index) => 2 + Math.cos(index / 13) * 0.5),
  });
}

describe("adding a stroke", () => {
  it("keeps it as drawn, for a pull of its page's ink", async () => {
    const device = await connect(alex);
    const { memberId } = await signIn(alex);
    const drawnOn = Date.UTC(2026, 10, 23, 9, 30);
    const samples = encodeSamples({ x: [10, 12.5], y: [20, 21], time: [0, 4] });
    const stroke = strokeAdd({
      pageId: day,
      drawnAt: madeAt(drawnOn),
      input: Input.PENCIL,
      tool: Tool.MONOLINE,
      colour: 0x2255aa,
      size: 3.5,
      samples,
    });

    const committed = await device.push(dayPage, stroke);

    expect(committed.results.map(resultOf)).toEqual([{ committed: true }, { committed: true }]);
    const [kept] = strokesIn(await inkOf(device, day));
    expect(kept).toEqual(
      expect.objectContaining({
        id: idOf(stroke),
        pageId: day,
        drawnBy: memberId,
        input: Input.PENCIL,
        tool: Tool.MONOLINE,
        colour: 0x2255aa,
        size: 3.5,
        samples,
      }),
    );
    expect(kept?.drawnAt && timestampMs(kept.drawnAt)).toBe(drawnOn);
  });

  it("stacks a stroke drawn by a clock running ahead at when it was added", async () => {
    const device = await connect(alex);
    const addedOn = Date.UTC(2026, 10, 23, 9, 30);
    const stroke = strokeAdd(
      { pageId: day, drawnAt: madeAt(addedOn + 60_000) },
      { at: madeAt(addedOn) },
    );

    await device.push(dayPage, stroke);

    const [kept] = strokesIn(await inkOf(device, day));
    expect(kept?.drawnAt && timestampMs(kept.drawnAt)).toBe(addedOn);
  });

  it("never sends ink in the household's pull", async () => {
    const device = await connect(alex);
    await device.push(dayPage, strokeAdd({ pageId: day }));

    const rows = (await device.catchUp()).flatMap(({ rows }) => rows);

    expect(rows.some(({ row }) => row.case === "page" && row.value.id === day)).toBe(true);
    expect(strokesIn(rows)).toEqual([]);
  });

  it("refuses a stroke on a page that wasn't created", async () => {
    const device = await connect(alex);

    const committed = await device.push(strokeAdd({ pageId: day }));

    expect(committed.results.map(resultOf)).toEqual([{ refused: "There's no such page." }]);
  });

  it.each([
    [
      "an id that isn't a UUID version 7",
      strokeAdd({ pageId: day, strokeId: "stroke-1" }),
      "A stroke's id must be a UUID version 7.",
    ],
    [
      "samples that aren't a stroke's",
      strokeAdd({ pageId: day, samples: new Uint8Array() }),
      "A stroke must have at least one sample.",
    ],
    [
      "no brush",
      strokeAdd({ pageId: day, tool: Tool.UNSPECIFIED }),
      "A stroke must say which brush drew it.",
    ],
    [
      "no time",
      strokeAdd({ pageId: day, drawnAt: undefined }),
      "A stroke must say when it was drawn.",
    ],
  ])("refuses a stroke with %s", async (_, stroke, refused) => {
    const device = await connect(alex);
    await device.push(dayPage);

    const committed = await device.push(stroke);

    expect(committed.results.map(resultOf)).toEqual([{ refused }]);
  });

  it("refuses a stroke whose id another stroke has", async () => {
    const device = await connect(alex);
    const stroke = strokeAdd({ pageId: day });
    await device.push(dayPage, stroke);

    const committed = await device.push(strokeAdd({ pageId: day, strokeId: idOf(stroke) }));

    expect(committed.results.map(resultOf)).toEqual([
      { refused: "A stroke with this id already exists." },
    ]);
  });

  it("refuses a stroke on a page the member doesn't see", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const personal = await personalSpaceOf(alexDevice);
    const pageId = spacePageId(personal, 1);
    await alexDevice.push(
      pageCreate({ pageId, kind: PageKind.SPACE, spaceId: personal, number: 1, ...a4Portrait }),
    );

    const committed = await samDevice.push(strokeAdd({ pageId }));

    expect(committed.results.map(resultOf)).toEqual([{ refused: "There's no such page." }]);
  });

  it("refuses adding or erasing ink on a page of an archived space, but not on a calendar page", async () => {
    const device = await connect(alex);
    const space = spaceCreate({ name: "Garden" });
    const pageId = spacePageId(idOf(space), 1);
    const page = pageCreate({
      pageId,
      kind: PageKind.SPACE,
      spaceId: idOf(space),
      number: 1,
      ...a4Portrait,
    });
    const drawn = strokeAdd({ pageId });
    const onCalendar = strokeAdd({ pageId: day });
    await device.push(space, page, dayPage, drawn, onCalendar, spaceSetArchived(idOf(space), true));

    const committed = await device.push(
      strokeAdd({ pageId }),
      strokeErase([idOf(drawn)]),
      strokeAdd({ pageId: day }),
      strokeErase([idOf(onCalendar)]),
    );

    expect(committed.results.map(resultOf)).toEqual([
      { refused: "This space is archived. Restore it to change it." },
      { refused: "This space is archived. Restore it to change it." },
      { committed: true },
      { committed: true },
    ]);
  });
});

describe("a page's ink", () => {
  it("comes from a cursor, with only what changed after it", async () => {
    const device = await connect(alex);
    const first = strokeAdd({ pageId: day });
    await device.push(dayPage, first);
    const [caughtUp] = await device.catchUpInk(day);
    const second = strokeAdd({ pageId: day });
    await device.push(second);

    const rows = await inkOf(device, day, Number(caughtUp?.cursor));

    expect(strokesIn(rows).map(({ id }) => id)).toEqual([idOf(second)]);
  });

  it("is sent as it changes to the devices whose last ink pull was the page", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const robinDevice = await connect(robin);
    await alexDevice.push(dayPage, nextDayPage);
    await samDevice.catchUpInk(day);
    await robinDevice.catchUpInk(nextDay);
    await alexDevice.catchUpInk(day);
    await Promise.all([samDevice.updates(), robinDevice.updates()]);
    const stroke = strokeAdd({ pageId: day });

    await alexDevice.push(stroke);

    expect(strokesIn(await samDevice.updates()).map(({ id }) => id)).toEqual([idOf(stroke)]);
    expect(strokesIn(await alexDevice.updates()).map(({ id }) => id)).toEqual([idOf(stroke)]);
    expect(await robinDevice.updates()).toEqual([]);
  });

  it("stops coming once the device pulls another page's ink", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    await alexDevice.push(dayPage, nextDayPage);
    await samDevice.catchUpInk(day);
    await samDevice.catchUpInk(nextDay);
    await samDevice.updates();

    await alexDevice.push(strokeAdd({ pageId: day }));

    expect(await samDevice.updates()).toEqual([]);
  });

  it("goes only to the members who see the page", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const personal = await personalSpaceOf(alexDevice);
    const pageId = spacePageId(personal, 1);
    await alexDevice.push(
      pageCreate({ pageId, kind: PageKind.SPACE, spaceId: personal, number: 1, ...a4Portrait }),
    );
    const pulled = await samDevice.catchUpInk(pageId);
    await samDevice.updates();

    await alexDevice.push(strokeAdd({ pageId }));

    expect(pulled.flatMap(({ rows }) => rows)).toEqual([]);
    expect(pulled.at(-1)?.done).toBe(true);
    expect(await samDevice.updates()).toEqual([]);
    expect(strokesIn(await inkOf(alexDevice, pageId))).toHaveLength(1);
  });

  it("comes in replies of at most 500 strokes, but never splits the strokes of one change", async () => {
    const device = await connect(alex);
    await device.push(dayPage);
    const strokes = Array.from({ length: 501 }, () => strokeAdd({ pageId: day }));
    for (let start = 0; start < strokes.length; start += 10) {
      await device.push(...strokes.slice(start, start + 10));
    }

    const added = await device.catchUpInk(day);
    await device.push(strokeErase(strokes.map(idOf)));
    const erased = await device.catchUpInk(day);

    expect(added.map(({ rows }) => strokesIn(rows).length)).toEqual([500, 1]);
    expect(erased.map(({ rows }) => erasedIn(rows).length)).toEqual([501]);
  });

  it("comes in replies of at most 512 KB of samples", async () => {
    const device = await connect(alex);
    const samples = longSamples(10_000);
    const strokes = Array.from({ length: 8 }, () => strokeAdd({ pageId: day, samples }));
    await device.push(dayPage);
    for (const stroke of strokes) await device.push(stroke);

    const replies = await device.catchUpInk(day);

    expect(samples.length * strokes.length).toBeGreaterThan(512 * 1024);
    expect(replies.length).toBeGreaterThan(1);
    for (const { rows } of replies) {
      const bytes = strokesIn(rows).reduce((sum, stroke) => sum + stroke.samples.length, 0);
      expect(bytes).toBeLessThanOrEqual(512 * 1024);
    }
    const ids = replies.flatMap(({ rows }) => strokesIn(rows).map(({ id }) => id));
    expect(ids).toEqual(strokes.map(idOf));
  });

  it("is deleted with its item's page", async () => {
    const device = await connect(alex);
    const task = itemCreate({ spaceId: await personalSpaceOf(device) });
    const pageId = itemPageId(idOf(task));
    const body = pageCreate({ pageId, kind: PageKind.ITEM, itemId: idOf(task), ...a4Portrait });
    await device.push(task, body, strokeAdd({ pageId }));

    const committed = await device.push(itemDelete(idOf(task)));

    expect(committed.results.map(resultOf)).toEqual([{ committed: true }]);
    expect(await inkOf(device, pageId)).toEqual([]);
  });
});

describe("erasing strokes", () => {
  it("erases anyone's strokes on a page the member sees, for every device following it", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const first = strokeAdd({ pageId: day });
    const second = strokeAdd({ pageId: day });
    const kept = strokeAdd({ pageId: day });
    await alexDevice.push(dayPage, first, second, kept);
    await alexDevice.catchUpInk(day);
    await alexDevice.updates();

    const committed = await samDevice.push(strokeErase([idOf(first), idOf(second)]));

    expect(committed.results.map(resultOf)).toEqual([{ committed: true }]);
    expect(erasedIn(await alexDevice.updates())).toEqual([idOf(first), idOf(second)].sort());
    const ink = await inkOf(samDevice, day);
    expect(strokesIn(ink).map(({ id }) => id)).toEqual([idOf(kept)]);
    expect(erasedIn(ink)).toEqual([idOf(first), idOf(second)].sort());
  });

  it("has no effect on a stroke already erased, and sends it as it is to the device", async () => {
    const device = await connect(alex);
    const stroke = strokeAdd({ pageId: day });
    await device.push(dayPage, stroke, strokeErase([idOf(stroke)]));
    await device.updates();

    const committed = await device.push(strokeErase([idOf(stroke)]));

    expect(committed.results.map(resultOf)).toEqual([{ committed: true }]);
    expect(erasedIn(await device.updates())).toEqual([idOf(stroke)]);
  });

  it("refuses an erase naming a stroke the member doesn't see, or none", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const personal = await personalSpaceOf(alexDevice);
    const pageId = spacePageId(personal, 1);
    const hidden = strokeAdd({ pageId });
    await alexDevice.push(
      pageCreate({ pageId, kind: PageKind.SPACE, spaceId: personal, number: 1, ...a4Portrait }),
      dayPage,
      hidden,
    );
    const seen = strokeAdd({ pageId: day });
    await alexDevice.push(seen);

    const committed = await samDevice.push(
      strokeErase([idOf(seen), idOf(hidden)]),
      strokeErase([]),
    );

    expect(committed.results.map(resultOf)).toEqual([
      { refused: "There's no such stroke." },
      { refused: "An erase must name at least one stroke." },
    ]);
    expect(strokesIn(await inkOf(alexDevice, day)).map(({ id }) => id)).toEqual([idOf(seen)]);
  });

  it("refuses an erase naming more than 1,000 strokes", async () => {
    const device = await connect(alex);
    const strokes = Array.from({ length: 1_001 }, () => strokeAdd({ pageId: day }));
    await device.push(dayPage);
    for (let start = 0; start < strokes.length; start += 10) {
      await device.push(...strokes.slice(start, start + 10));
    }

    const committed = await device.push(strokeErase(strokes.map(idOf)));

    expect(committed.results.map(resultOf)).toEqual([
      { refused: "An erase can name at most 1,000 strokes." },
    ]);
  });
});

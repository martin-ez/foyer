import { reset, runInDurableObject } from "cloudflare:test";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import {
  a2Landscape,
  a4Portrait,
  type CalendarPageKind,
  calendarPageId,
  calendarPageKinds,
  newId,
  spacePageId,
  spotInDay,
} from "@foyer/shared";
import { ItemKind } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import { PageKind } from "@foyer/shared/gen/foyer/page/v1/page_pb";
import { SpaceKind } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import type { Sticker } from "@foyer/shared/gen/foyer/sticker/v1/sticker_pb";
import { type ChangeResult, type Row, RowKind } from "@foyer/shared/gen/foyer/sync/v1/sync_pb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { placeAllCalendarStickers } from "../src/calendar-stickers";
import { fakeGoogle } from "../src/fake-google";
import { theHousehold } from "../src/household";
import { householdMigrations, migrate, runJobs } from "../src/migrations";
import { connectGoogle, work } from "./calendar-helpers";
import {
  type ChangeInit,
  Device,
  idOf,
  itemCreate,
  itemSetDate,
  itemSetRepeat,
  pageCreate,
  signIn,
  stickerMove,
  stickerPlace,
  taskTick,
  taskUntick,
} from "./sync-device";

const alex = "member@example.com";
const sam = "housemate@example.com";
const pageKinds = { month: PageKind.MONTH, week: PageKind.WEEK, day: PageKind.DAY };

const devices: Device[] = [];

afterEach(async () => {
  for (const device of devices.splice(0)) device.close();
  vi.useRealTimers();
  fakeGoogle.reset();
  await reset();
});

async function connect(email: string): Promise<{ device: Device; memberId: string }> {
  const { memberId, token } = await signIn(email);
  const device = await Device.connect(token);
  devices.push(device);
  await device.welcome();
  return { device, memberId };
}

type Known = { stickers: Map<string, Sticker>; items: Set<string>; spaces: Map<string, SpaceKind> };

async function knownBy(device: Device): Promise<Known> {
  const rows: Row[] = (await device.catchUp()).flatMap(({ rows }) => rows);
  const known: Known = { stickers: new Map(), items: new Set(), spaces: new Map() };
  for (const { row } of rows) {
    if (row.case === "sticker") known.stickers.set(row.value.id, row.value);
    if (row.case === "item") known.items.add(row.value.id);
    if (row.case === "space") known.spaces.set(row.value.id, row.value.kind);
    if (row.case === "deleted" && row.value.kind === RowKind.STICKER) {
      known.stickers.delete(row.value.id);
    }
  }
  return known;
}

async function spaceOf(device: Device, kind: SpaceKind): Promise<string> {
  const { spaces } = await knownBy(device);
  return [...spaces].find(([, each]) => each === kind)?.[0] ?? "";
}

/** The item's stickers on calendar pages that a device receives, as page and day, by kind of page. */
async function calendarStickers(device: Device, itemId: string) {
  const { stickers } = await knownBy(device);
  return [...stickers.values()].filter(
    (sticker) => sticker.itemId === itemId && sticker.occurrence !== "",
  );
}

function daysOf(stickers: Sticker[]) {
  return stickers.map(({ pageId, occurrence }) => `${pageId} ${occurrence}`).sort();
}

function onDay(date: string) {
  return calendarPageKinds.map((kind) => `${calendarPageId(kind, date)} ${date}`).sort();
}

function sizeOf(kind: CalendarPageKind) {
  return kind === "day" ? a4Portrait : a2Landscape;
}

function calendarPage(kind: CalendarPageKind, date: string): ChangeInit {
  const pageId = calendarPageId(kind, date);
  return pageCreate({ pageId, kind: pageKinds[kind], ...sizeOf(kind) });
}

/** A task in a space, with its sticker on the space's first page, and a date unless it's empty. */
function newTask(spaceId: string, date = "") {
  const task = itemCreate({ spaceId, date });
  const pageId = spacePageId(spaceId, 1);
  const changes = [
    pageCreate({ pageId, kind: PageKind.SPACE, spaceId, number: 1, ...a4Portrait }),
    task,
    stickerPlace({ pageId, itemId: idOf(task) }),
  ];
  return { itemId: idOf(task), changes };
}

/** What a device that dates an item sends with it: its calendar pages and stickers on `date`. */
function stickersOnDay(itemId: string, date: string, kind = 1): ChangeInit[] {
  return calendarPageKinds.flatMap((pageKind) => [
    calendarPage(pageKind, date),
    stickerPlace({
      pageId: calendarPageId(pageKind, date),
      itemId,
      kind,
      occurrence: date,
      ...spotInDay(calendarPageId(pageKind, date), sizeOf(pageKind), date, []),
    }),
  ]);
}

function resultOf(result: ChangeResult | undefined) {
  if (result?.result.case === "refused") return { refused: result.result.value.reason };
  return { committed: result?.result.case === "seq" };
}

describe("stickers on calendar pages", () => {
  it("places a sticker on a day, which every member receives, even one who can't see its item", async () => {
    const alexs = await connect(alex);
    const sams = await connect(sam);
    const personal = await spaceOf(alexs.device, SpaceKind.PERSONAL);
    const task = newTask(personal, "2026-11-17");

    const placed = stickersOnDay(task.itemId, "2026-11-17");
    const committed = await alexs.device.push(...task.changes, ...placed);

    expect(committed.results.map(resultOf).every(({ committed }) => committed)).toBe(true);
    const seen = await knownBy(sams.device);
    expect(seen.items.has(task.itemId)).toBe(false);
    const stickers = [...seen.stickers.values()].filter(({ itemId }) => itemId === task.itemId);
    expect(daysOf(stickers)).toEqual(onDay("2026-11-17"));
    expect(stickers.every(({ placedBy }) => placedBy === alexs.memberId)).toBe(true);
  });

  it.each([
    [
      "without a day",
      { occurrence: "" },
      "A sticker on a calendar page must say which day it's on.",
    ],
    [
      "on a day its page doesn't show",
      { occurrence: "2026-12-01" },
      "A sticker must be on a day its page shows.",
    ],
    [
      "that isn't a day",
      { occurrence: "2026-11-31" },
      "A sticker must be on a day its page shows.",
    ],
  ])("refuses a sticker on a calendar page %s", async (_, change, reason) => {
    const { device } = await connect(alex);
    const inbox = await spaceOf(device, SpaceKind.INBOX);
    const task = newTask(inbox);
    await device.push(...task.changes, calendarPage("month", "2026-11-17"));

    const pageId = calendarPageId("month", "2026-11-17");
    const committed = await device.push(stickerPlace({ pageId, itemId: task.itemId, ...change }));

    expect(resultOf(committed.results[0])).toEqual({ refused: reason });
  });

  it("moves a sticker to another day of its page, or within its day keeping its day", async () => {
    const { device } = await connect(alex);
    const inbox = await spaceOf(device, SpaceKind.INBOX);
    const task = newTask(inbox, "2026-11-17");
    const placed = stickersOnDay(task.itemId, "2026-11-17");
    await device.push(...task.changes, ...placed);
    const monthSticker = idOf(placed[1] as ChangeInit);

    await device.push(
      stickerMove(monthSticker, 800, 600, {}, "2026-11-19"),
      itemSetDate(task.itemId, "2026-11-19"),
    );
    await device.push(stickerMove(monthSticker, 820, 610));

    const month = (await calendarStickers(device, task.itemId)).find(
      ({ id }) => id === monthSticker,
    );
    expect(month).toMatchObject({ x: 820, y: 610, occurrence: "2026-11-19" });
  });

  it.each([
    ["to a day its page doesn't show", "2026-12-01", "A sticker must be on a day its page shows."],
  ])("refuses moving a sticker %s", async (_, occurrence, reason) => {
    const { device } = await connect(alex);
    const inbox = await spaceOf(device, SpaceKind.INBOX);
    const task = newTask(inbox, "2026-11-17");
    const placed = stickersOnDay(task.itemId, "2026-11-17");
    await device.push(...task.changes, ...placed);

    const committed = await device.push(
      stickerMove(idOf(placed[1] as ChangeInit), 10, 10, {}, occurrence),
    );

    expect(resultOf(committed.results[0])).toEqual({ refused: reason });
  });

  it("refuses a day for a sticker that isn't on a calendar page", async () => {
    const { device } = await connect(alex);
    const inbox = await spaceOf(device, SpaceKind.INBOX);
    const task = newTask(inbox);
    await device.push(...task.changes);

    const onSpacePage = idOf(task.changes[2] as ChangeInit);
    const committed = await device.push(stickerMove(onSpacePage, 36, 90, {}, "2026-11-17"));

    expect(resultOf(committed.results[0])).toEqual({
      refused: "Only a sticker on a calendar page is on a day.",
    });
  });
});

describe("keeping an item's calendar stickers on its day", () => {
  it("places a dated task on its month, week and day pages when the device didn't", async () => {
    const alexs = await connect(alex);
    const sams = await connect(sam);
    const inbox = await spaceOf(alexs.device, SpaceKind.INBOX);
    const task = newTask(inbox, "2026-11-17");

    await alexs.device.push(...task.changes);

    const stickers = await calendarStickers(sams.device, task.itemId);
    expect(daysOf(stickers)).toEqual(onDay("2026-11-17"));
    expect(stickers.every(({ placedBy }) => placedBy === alexs.memberId)).toBe(true);
    const month = stickers.find(({ pageId }) => pageId === "month:2026-11");
    expect(month).toMatchObject(spotInDay("month:2026-11", a2Landscape, "2026-11-17", []));
  });

  it("adds nothing when the device placed them itself, in the same push", async () => {
    const { device } = await connect(alex);
    const inbox = await spaceOf(device, SpaceKind.INBOX);
    const task = newTask(inbox, "2026-11-17");
    const placed = stickersOnDay(task.itemId, "2026-11-17");

    await device.push(...task.changes, ...placed);

    const ids = (await calendarStickers(device, task.itemId)).map(({ id }) => id).sort();
    const placedIds = placed.filter((_, index) => index % 2 === 1).map(idOf);
    expect(ids).toEqual(placedIds.sort());
  });

  it("moves them to a new date, and removes them when the date is cleared", async () => {
    const { device } = await connect(alex);
    const inbox = await spaceOf(device, SpaceKind.INBOX);
    const task = newTask(inbox, "2026-11-17");
    await device.push(...task.changes);
    const before = await calendarStickers(device, task.itemId);

    await device.push(itemSetDate(task.itemId, "2026-11-19"));
    const after = await calendarStickers(device, task.itemId);

    expect(daysOf(after)).toEqual(onDay("2026-11-19"));
    const kept = (pageId: string) => after.find((each) => each.pageId === pageId)?.id;
    expect(kept("month:2026-11")).toBe(before.find(({ pageId }) => pageId === "month:2026-11")?.id);
    expect(kept("week:2026-11-16")).toBe(
      before.find(({ pageId }) => pageId === "week:2026-11-16")?.id,
    );

    await device.push(itemSetDate(task.itemId, ""));

    expect(await calendarStickers(device, task.itemId)).toEqual([]);
  });

  it("puts a sticker moved to another day back on its item's day", async () => {
    const { device } = await connect(alex);
    const inbox = await spaceOf(device, SpaceKind.INBOX);
    const task = newTask(inbox, "2026-11-17");
    const placed = stickersOnDay(task.itemId, "2026-11-17");
    await device.push(...task.changes, ...placed);
    const monthSticker = idOf(placed[1] as ChangeInit);

    await device.push(stickerMove(monthSticker, 900, 700, {}, "2026-11-20"));

    const month = (await calendarStickers(device, task.itemId)).find(
      ({ id }) => id === monthSticker,
    );
    expect(month?.occurrence).toBe("2026-11-17");
  });

  it("places new tasks below the ones already on their day", async () => {
    const { device } = await connect(alex);
    const inbox = await spaceOf(device, SpaceKind.INBOX);
    const first = newTask(inbox, "2026-11-17");
    const second = itemCreate({ spaceId: inbox, date: "2026-11-17" });
    await device.push(...first.changes);

    await device.push(second);

    const [firstOnDay] = (await calendarStickers(device, first.itemId)).filter(
      ({ pageId }) => pageId === "day:2026-11-17",
    );
    const [secondOnDay] = (await calendarStickers(device, idOf(second))).filter(
      ({ pageId }) => pageId === "day:2026-11-17",
    );
    expect(secondOnDay?.y).toBeGreaterThan(firstOnDay?.y ?? Number.POSITIVE_INFINITY);
  });

  it("keeps a repeating task's ticked day, places it on its next date, and unticking removes it", async () => {
    const { device } = await connect(alex);
    const inbox = await spaceOf(device, SpaceKind.INBOX);
    const task = newTask(inbox, "2026-11-17");
    await device.push(...task.changes, itemSetRepeat(task.itemId, "FREQ=WEEKLY;BYDAY=TU"));

    await device.push(
      taskTick({ itemId: task.itemId, occurrence: "2026-11-17", nextDate: "2026-11-24" }),
    );

    expect(daysOf(await calendarStickers(device, task.itemId))).toEqual(
      [...onDay("2026-11-17"), ...onDay("2026-11-24")].sort(),
    );

    await device.push(taskUntick({ itemId: task.itemId, occurrence: "2026-11-17" }));

    expect(daysOf(await calendarStickers(device, task.itemId))).toEqual(onDay("2026-11-17"));
  });
});

describe("calendar stickers of events", () => {
  async function withCalendar(timeZone: string) {
    const { memberId, token } = await signIn(alex);
    const device = await Device.connect(token);
    devices.push(device);
    await device.welcome();
    await connectGoogle(token, { timeZone });
    await work();
    return { device, memberId, personal: await spaceOf(device, SpaceKind.PERSONAL) };
  }

  function eventAt(spaceId: string, startsAt: string, endsAt: string) {
    return itemCreate({
      spaceId,
      kind: ItemKind.EVENT,
      title: "Dinner",
      startsAt: timestampFromMs(Date.parse(startsAt)),
      endsAt: timestampFromMs(Date.parse(endsAt)),
    });
  }

  it("places an event on the day it starts in its calendar's time zone", async () => {
    const { device, personal } = await withCalendar("Asia/Tokyo");
    const event = eventAt(personal, "2026-11-20T19:00:00Z", "2026-11-20T21:00:00Z");

    await device.push(event);

    expect(daysOf(await calendarStickers(device, idOf(event)))).toEqual(onDay("2026-11-21"));
  });

  it("moves an event's stickers that a device placed on another day to its own", async () => {
    const { device, personal } = await withCalendar("Asia/Tokyo");
    const event = eventAt(personal, "2026-11-20T19:00:00Z", "2026-11-20T21:00:00Z");

    await device.push(event, ...stickersOnDay(idOf(event), "2026-11-20", 2));

    expect(daysOf(await calendarStickers(device, idOf(event)))).toEqual(onDay("2026-11-21"));
  });

  it("places an event added in Google, and moves it when Google changes its day", async () => {
    const { device } = await withCalendar("Europe/Madrid");
    const [calendarId = ""] = [...fakeGoogle.calendars]
      .filter(([, calendar]) => calendar.name === "Foyer · Personal")
      .map(([id]) => id);
    const added = fakeGoogle.addEvent(calendarId, {
      summary: "Bins",
      start: { date: "2026-11-24" },
      end: { date: "2026-11-25" },
    });
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 60_000 });
    await work();
    const { items } = await knownBy(device);
    const itemId = [...items].at(-1) ?? "";

    expect(daysOf(await calendarStickers(device, itemId))).toEqual(onDay("2026-11-24"));

    fakeGoogle.changeEvent(calendarId, added.id, {
      start: { date: "2026-11-26" },
      end: { date: "2026-11-27" },
    });
    vi.setSystemTime(Date.now() + 60_000);
    await work();

    expect(daysOf(await calendarStickers(device, itemId))).toEqual(onDay("2026-11-26"));
  });
});

describe("items dated before calendar stickers", () => {
  it("get their stickers once the household starts on the new storage", async () => {
    const { memberId } = await signIn(alex);
    const { device } = await connect(alex);
    const inbox = await spaceOf(device, SpaceKind.INBOX);
    const itemId = newId();

    await runInDurableObject(theHousehold(), async (_, { storage }) => {
      const { sql } = storage;
      sql.exec(
        `INSERT INTO items (id, kind, space_id, title, description, date, created_by, created_at,
           seq, space_at, space_change_id, title_at, title_change_id, description_at,
           description_change_id, date_at, date_change_id)
         VALUES (?, 'task', ?, 'Water the plants', '', '2026-11-17', ?, 0, 1, 0, '', 0, '', 0, '',
           0, '')`,
        itemId,
        inbox,
        memberId,
      );
      sql.exec("INSERT INTO household_jobs (name) VALUES ('place calendar stickers')");
      runJobs(storage, { "place calendar stickers": placeAllCalendarStickers });
      runJobs(storage, { "place calendar stickers": placeAllCalendarStickers });
      expect(sql.exec("SELECT name FROM household_jobs").toArray()).toEqual([]);
      migrate(storage, householdMigrations);
    });

    const stickers = await calendarStickers(device, itemId);
    expect(daysOf(stickers)).toEqual(onDay("2026-11-17"));
    expect(stickers.every(({ placedBy }) => placedBy === memberId)).toBe(true);
  });

  it("leaves a job the household doesn't know for code that does", async () => {
    await runInDurableObject(theHousehold(), async (_, { storage }) => {
      storage.sql.exec("INSERT INTO household_jobs (name) VALUES ('later')");
      runJobs(storage, { "place calendar stickers": placeAllCalendarStickers });
      expect(storage.sql.exec("SELECT name FROM household_jobs").toArray()).toEqual([
        { name: "later" },
      ]);
    });
  });
});

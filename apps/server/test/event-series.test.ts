import { reset } from "cloudflare:test";
import { toBinary } from "@bufbuild/protobuf";
import { timestampFromMs, timestampMs } from "@bufbuild/protobuf/wkt";
import { dayPageId, newId } from "@foyer/shared";
import { type Item, ItemKind } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import { type Space, SpaceKind } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import type { Sticker } from "@foyer/shared/gen/foyer/sticker/v1/sticker_pb";
import {
  type ChangeResult,
  type Row,
  RowKind,
  RowSchema,
} from "@foyer/shared/gen/foyer/sync/v1/sync_pb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callsPerRun } from "../src/calendars";
import { type FakeEvent, type FakeEventFields, fakeGoogle } from "../src/fake-google";
import { connectGoogle, work } from "./calendar-helpers";
import {
  type ChangeInit,
  Device,
  idOf,
  itemCreate,
  itemDelete,
  itemMove,
  itemSetParent,
  itemSetTitle,
  signIn,
  spaceCreate,
} from "./sync-device";

const alex = "member@example.com";
const alexsAccount = `dev:${alex}`;
const minute = 60_000;
const day = 24 * 60 * minute;
const saturday = Date.parse("2026-11-21T12:00:00Z");
const madrid = "Europe/Madrid";

const devices: Device[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: saturday });
});

afterEach(async () => {
  for (const device of devices.splice(0)) device.close();
  vi.restoreAllMocks();
  vi.useRealTimers();
  fakeGoogle.reset();
  await reset();
});

async function member(email: string): Promise<Device> {
  const { token } = await signIn(email);
  const device = await Device.connect(token);
  devices.push(device);
  await device.welcome();
  await connectGoogle(token, { timeZone: madrid });
  await work();
  return device;
}

async function received(device: Device): Promise<Row[]> {
  return (await device.catchUp()).flatMap(({ rows }) => rows);
}

async function spaceNamed(device: Device, name: string): Promise<Space> {
  for (const { row } of await received(device)) {
    if (row.case === "space" && row.value.name === name) return row.value;
  }
  throw new Error(`There's no space called ${name}`);
}

async function inbox(device: Device): Promise<string> {
  for (const { row } of await received(device)) {
    if (row.case === "space" && row.value.kind === SpaceKind.INBOX) return row.value.id;
  }
  throw new Error("There's no Inbox");
}

async function held(device: Device) {
  const items = new Map<string, Item>();
  const stickers = new Map<string, Sticker>();
  for (const { row } of await received(device)) {
    if (row.case === "item") items.set(row.value.id, row.value);
    if (row.case === "sticker") stickers.set(row.value.id, row.value);
    if (row.case === "deleted" && row.value.kind === RowKind.ITEM) items.delete(row.value.id);
    if (row.case === "deleted" && row.value.kind === RowKind.STICKER) {
      stickers.delete(row.value.id);
    }
  }
  return { items, stickers };
}

async function occurrences(device: Device, title: string): Promise<Item[]> {
  const { items } = await held(device);
  return [...items.values()]
    .filter((item) => item.kind === ItemKind.EVENT && item.title === title)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function calendarOf(spaceName: string): string {
  for (const [id, calendar] of fakeGoogle.calendars) {
    if (calendar.subject === alexsAccount && calendar.name === `Foyer · ${spaceName}`) return id;
  }
  throw new Error(`There's no calendar for ${spaceName}`);
}

function addSeries(spaceName: string, firstDay: string, fields: FakeEventFields): FakeEvent {
  const at = Date.parse(`${firstDay}T18:00:00Z`);
  return fakeGoogle.addEvent(calendarOf(spaceName), {
    start: { dateTime: new Date(at).toISOString(), timeZone: madrid },
    end: { dateTime: new Date(at + 60 * minute).toISOString(), timeZone: madrid },
    ...fields,
  });
}

async function later(by = minute): Promise<void> {
  vi.setSystemTime(Date.now() + by);
  await work();
}

function countCalls(): () => { all: number; listings: number } {
  let all = 0;
  let listings = 0;
  const answer = fakeGoogle.answer.bind(fakeGoogle);
  vi.spyOn(fakeGoogle, "answer").mockImplementation((request) => {
    all += 1;
    if (new URL(request.url).pathname.endsWith("/instances")) listings += 1;
    return answer(request);
  });
  return () => ({ all, listings });
}

function keepTheAlarmFromRunningOnItsOwn(): void {
  const laterThanTheRealClock = Date.parse("2036-11-15T12:00:00Z");
  vi.setSystemTime(laterThanTheRealClock);
}

function startOf(item: Item | undefined): string {
  return item?.startsAt ? new Date(timestampMs(item.startsAt)).toISOString() : "";
}

function resultOf(result: ChangeResult | undefined) {
  return result?.result.case === "refused"
    ? { refused: result.result.value.reason }
    : { committed: result?.result.case === "seq" };
}

function change(made: ChangeInit["change"]): ChangeInit {
  return { changeId: newId(), at: timestampFromMs(Date.now()), change: made };
}

describe("occurrences of a series read from Google", () => {
  it("are events from the start of last month to 18 months ahead, each with stickers on its day", async () => {
    const device = await member(alex);
    addSeries("Personal", "2026-09-01", {
      summary: "Choir",
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU"],
    });
    await later();

    const choir = await occurrences(device, "Choir");
    expect(choir).toHaveLength(85);
    expect(choir.at(0)?.date).toBe("2026-10-06");
    expect(choir.at(-1)?.date).toBe("2028-05-16");
    expect(startOf(choir.find(({ date }) => date === "2026-10-06"))).toBe(
      "2026-10-06T18:00:00.000Z",
    );
    expect(startOf(choir.find(({ date }) => date === "2026-12-01"))).toBe(
      "2026-12-01T19:00:00.000Z",
    );
    const [seriesId] = new Set(choir.map((each) => each.seriesId));
    expect(seriesId).toMatch(/^[0-9a-f-]{36}$/);
    expect(choir.every((each) => each.seriesId === seriesId && each.createdBy === "")).toBe(true);
    const personal = await spaceNamed(device, "Personal");
    expect(choir.every(({ spaceId }) => spaceId === personal.id)).toBe(true);
    const { stickers } = await held(device);
    const tuesday = choir.find(({ date }) => date === "2026-11-24");
    const onTuesday = [...stickers.values()].filter(({ itemId }) => itemId === tuesday?.id);
    expect(onTuesday.map(({ pageId }) => pageId)).toContain(dayPageId("2026-11-24"));
  });

  it("leaves single events without a series, and reads all-day series", async () => {
    const device = await member(alex);
    fakeGoogle.addEvent(calendarOf("Personal"), {
      summary: "Dentist",
      start: { dateTime: "2026-11-25T09:00:00Z" },
      end: { dateTime: "2026-11-25T10:00:00Z" },
    });
    fakeGoogle.addEvent(calendarOf("Personal"), {
      summary: "Bins",
      start: { date: "2026-11-24" },
      end: { date: "2026-11-25" },
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=3"],
    });
    await later();

    const [dentist] = await occurrences(device, "Dentist");
    expect(dentist?.seriesId).toBe("");
    const bins = await occurrences(device, "Bins");
    expect(bins.map(({ startsOn, endsOn }) => `${startsOn} ${endsOn}`)).toEqual([
      "2026-11-24 2026-11-24",
      "2026-12-01 2026-12-01",
      "2026-12-08 2026-12-08",
    ]);
  });

  it("are made a day further ahead each day, with one call to Google a day", async () => {
    const device = await member(alex);
    addSeries("Personal", "2026-11-22", {
      summary: "Run",
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=SU"],
    });
    await later();
    const before = await occurrences(device, "Run");
    const calls = countCalls();

    await later(6 * 60 * minute);
    const sameDay = calls().listings;
    await later(day);
    const after = await occurrences(device, "Run");

    expect(before.at(-1)?.date).toBe("2028-05-14");
    expect(sameDay).toBe(0);
    expect(calls().listings).toBe(1);
    expect(after.at(-1)?.date).toBe("2028-05-21");
    expect(after.slice(0, -1).map(({ id }) => id)).toEqual(before.map(({ id }) => id));
  });

  it("are kept once they've passed, even when the series changes", async () => {
    const device = await member(alex);
    const series = addSeries("Personal", "2026-11-24", {
      summary: "Choir",
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU"],
    });
    await later();
    const [first] = await occurrences(device, "Choir");

    await later(90 * day);
    const { token } = await signIn(alex);
    const again = await Device.connect(token);
    devices.push(again);
    await again.welcome();
    fakeGoogle.changeEvent(calendarOf("Personal"), series.id, { summary: "Choir practice" });
    await later();

    const { items } = await held(again);
    expect(items.get(first?.id ?? "")).toMatchObject({ title: "Choir", date: "2026-11-24" });
    expect((await occurrences(again, "Choir practice")).at(0)?.date).toBe("2027-01-05");
  });

  it("are made for as many series as one run's calls to Google allow, and for the rest in the next", async () => {
    keepTheAlarmFromRunningOnItsOwn();
    const device = await member(alex);
    const count = callsPerRun + 5;
    for (let each = 0; each < count; each += 1) {
      addSeries("Personal", "2036-11-18", {
        summary: `Series ${each}`,
        recurrence: ["RRULE:FREQ=WEEKLY;COUNT=2"],
      });
    }
    const calls = countCalls();

    await later();
    const inOneRun = calls();
    await work();

    expect(inOneRun.all).toBe(callsPerRun);
    expect(inOneRun.listings).toBeLessThan(count);
    expect(calls().listings).toBe(count);
    const { items } = await held(device);
    expect(items.size).toBe(2 * count);
  });
});

describe("changing one occurrence in Foyer", () => {
  it("changes only that occurrence in Google, and deleting one deletes only it", async () => {
    const device = await member(alex);
    const series = addSeries("Personal", "2026-11-24", {
      summary: "Choir",
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=4"],
    });
    await later();
    const [first, second, third] = await occurrences(device, "Choir");

    const wednesday = Date.parse("2026-12-02T18:30:00Z");
    await device.push(
      itemSetTitle(second?.id ?? "", "Choir, at Ana's"),
      change({
        case: "eventSetTime",
        value: {
          itemId: second?.id ?? "",
          startsOn: "",
          endsOn: "",
          startsAt: timestampFromMs(wednesday),
          endsAt: timestampFromMs(wednesday + 60 * minute),
        },
      }),
      itemDelete(third?.id ?? ""),
    );
    await work();
    await later();

    const inGoogle = fakeGoogle.instancesOf(calendarOf("Personal"), series.id);
    expect(inGoogle.map(({ summary, start }) => `${summary} ${start.dateTime}`)).toEqual([
      "Choir 2026-11-24T18:00:00Z",
      "Choir, at Ana's 2026-12-02T18:30:00.000Z",
      "Choir 2026-12-15T18:00:00Z",
    ]);
    expect(fakeGoogle.calendars.get(calendarOf("Personal"))?.events.get(series.id)?.summary).toBe(
      "Choir",
    );
    const after = await held(device);
    expect(after.items.get(first?.id ?? "")?.title).toBe("Choir");
    expect(after.items.get(second?.id ?? "")).toMatchObject({
      title: "Choir, at Ana's",
      date: "2026-12-02",
    });
    expect(after.items.has(third?.id ?? "")).toBe(false);
  });

  it("refuses moving an occurrence, or a task holding one, to another space", async () => {
    const device = await member(alex);
    const create = spaceCreate({ name: "Family" });
    await device.push(create);
    await work();
    addSeries("Personal", "2026-11-24", {
      summary: "Choir",
      recurrence: ["RRULE:FREQ=WEEKLY;COUNT=2"],
    });
    await later();
    const [choir] = await occurrences(device, "Choir");
    const family = await spaceNamed(device, "Family");
    const personal = await spaceNamed(device, "Personal");
    const task = itemCreate({ spaceId: personal.id, title: "Practise" });
    const otherTask = itemCreate({ spaceId: family.id, title: "Sheet music" });
    await device.push(task, otherTask);
    const taskId = idOf(task);
    const otherTaskId = idOf(otherTask);

    const { results } = await device.push(
      itemMove(choir?.id ?? "", family.id),
      itemMove(choir?.id ?? "", await inbox(device)),
      itemSetParent(choir?.id ?? "", otherTaskId),
      itemSetParent(choir?.id ?? "", taskId),
    );
    const { results: holding } = await device.push(itemMove(taskId, family.id));

    const refused = { refused: "A repeating event moves with its series, in Google Calendar." };
    expect(results.map(resultOf)).toEqual([refused, refused, refused, { committed: true }]);
    expect(holding.map(resultOf)).toEqual([refused]);
  });
});

describe("changes made in Google", () => {
  it("to one occurrence change or delete only that occurrence", async () => {
    const device = await member(alex);
    const series = addSeries("Personal", "2026-11-24", {
      summary: "Choir",
      recurrence: ["RRULE:FREQ=WEEKLY;COUNT=3"],
    });
    await later();
    const [first, second, third] = fakeGoogle.instancesOf(calendarOf("Personal"), series.id);

    fakeGoogle.changeEvent(calendarOf("Personal"), first?.id ?? "", { summary: "First choir" });
    fakeGoogle.removeEvent(calendarOf("Personal"), second?.id ?? "");
    await later();

    const choir = await held(device);
    const titles = [...choir.items.values()].map(({ title, date }) => `${date} ${title}`).sort();
    expect(titles).toEqual([
      "2026-11-24 First choir",
      `${third?.start.dateTime?.slice(0, 10)} Choir`,
    ]);
  });

  it("to the series' title, time or end change its occurrences, keeping them on their days", async () => {
    const device = await member(alex);
    const series = addSeries("Personal", "2026-11-24", {
      summary: "Choir",
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU"],
    });
    await later();
    const before = await occurrences(device, "Choir");

    fakeGoogle.changeEvent(calendarOf("Personal"), series.id, {
      summary: "Choir practice",
      start: { dateTime: "2026-11-24T19:30:00Z", timeZone: madrid },
      end: { dateTime: "2026-11-24T21:00:00Z", timeZone: madrid },
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20261222T235959Z"],
    });
    await later();

    const after = await occurrences(device, "Choir practice");
    expect(after.map(({ date }) => date)).toEqual([
      "2026-11-24",
      "2026-12-01",
      "2026-12-08",
      "2026-12-15",
      "2026-12-22",
    ]);
    expect(after.map(({ id }) => id)).toEqual(before.slice(0, 5).map(({ id }) => id));
    expect(startOf(after[0])).toBe("2026-11-24T19:30:00.000Z");
    expect(await occurrences(device, "Choir")).toEqual([]);
  });

  it("keep their occurrences when Google refuses to list the series", async () => {
    const device = await member(alex);
    const series = addSeries("Personal", "2026-11-24", {
      summary: "Choir",
      recurrence: ["RRULE:FREQ=WEEKLY;COUNT=3"],
    });
    await later();
    const before = await occurrences(device, "Choir");
    const answer = fakeGoogle.answer.bind(fakeGoogle);
    vi.spyOn(fakeGoogle, "answer").mockImplementation((request) =>
      new URL(request.url).pathname.endsWith("/instances")
        ? Promise.resolve(Response.json({ error: { code: 400 } }, { status: 400 }))
        : answer(request),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    fakeGoogle.changeEvent(calendarOf("Personal"), series.id, { summary: "Choir practice" });
    await later();

    expect(before).toHaveLength(3);
    expect((await occurrences(device, "Choir")).map(({ id }) => id)).toEqual(
      before.map(({ id }) => id),
    );
  });

  it("deleting the series deletes its occurrences", async () => {
    const device = await member(alex);
    const series = addSeries("Personal", "2026-11-24", {
      summary: "Choir",
      recurrence: ["RRULE:FREQ=WEEKLY;COUNT=3"],
    });
    await later();

    fakeGoogle.removeEvent(calendarOf("Personal"), series.id);
    await later();

    expect(await occurrences(device, "Choir")).toEqual([]);
  });

  it("moving the series to another of Foyer's calendars moves its occurrences, keeping them", async () => {
    const device = await member(alex);
    await device.push(spaceCreate({ name: "Family" }));
    await work();
    const series = addSeries("Personal", "2026-11-24", {
      summary: "Choir",
      recurrence: ["RRULE:FREQ=WEEKLY;COUNT=3"],
    });
    await later();
    const before = await occurrences(device, "Choir");

    fakeGoogle.moveEvent(calendarOf("Personal"), series.id, calendarOf("Family"));
    await later();

    const family = await spaceNamed(device, "Family");
    const after = await occurrences(device, "Choir");
    expect(after.map(({ id }) => id)).toEqual(before.map(({ id }) => id));
    expect(after.every(({ spaceId }) => spaceId === family.id)).toBe(true);
  });

  it("moving the series to a calendar read before its own moves its occurrences, keeping them", async () => {
    const device = await member(alex);
    await device.push(spaceCreate({ name: "Family" }));
    await work();
    const series = addSeries("Family", "2026-11-24", {
      summary: "Choir",
      recurrence: ["RRULE:FREQ=WEEKLY;COUNT=3"],
    });
    await later();
    const before = await occurrences(device, "Choir");

    fakeGoogle.moveEvent(calendarOf("Family"), series.id, calendarOf("Personal"));
    await later();

    const personal = await spaceNamed(device, "Personal");
    const after = await occurrences(device, "Choir");
    expect(before).toHaveLength(3);
    expect(after.map(({ id }) => id)).toEqual(before.map(({ id }) => id));
    expect(after.every(({ spaceId }) => spaceId === personal.id)).toBe(true);
  });

  it("keep occurrences when Google drops the sync token and every event is read again", async () => {
    const device = await member(alex);
    addSeries("Personal", "2026-11-24", {
      summary: "Choir",
      recurrence: ["RRULE:FREQ=WEEKLY;COUNT=3"],
    });
    await later();
    const before = await occurrences(device, "Choir");

    fakeGoogle.dropSyncTokens(calendarOf("Personal"));
    await later();

    expect((await occurrences(device, "Choir")).map(({ id }) => id)).toEqual(
      before.map(({ id }) => id),
    );
  });

  it("deleting the calendar deletes its series' occurrences, as Foyer doesn't make series", async () => {
    const device = await member(alex);
    addSeries("Personal", "2026-11-24", {
      summary: "Choir",
      recurrence: ["RRULE:FREQ=WEEKLY;COUNT=3"],
    });
    await later();
    vi.spyOn(console, "error").mockImplementation(() => {});

    fakeGoogle.calendars.delete(calendarOf("Personal"));
    await later();
    await work();

    expect(await occurrences(device, "Choir")).toEqual([]);
    const remade = calendarOf("Personal");
    expect(fakeGoogle.eventsOf(remade)).toEqual([]);
  });
});

describe("what devices receive", () => {
  it("never holds Google's ids or etags for a series or its occurrences", async () => {
    const device = await member(alex);
    const series = addSeries("Personal", "2026-11-24", {
      summary: "Choir",
      recurrence: ["RRULE:FREQ=WEEKLY;COUNT=2"],
    });
    await later();

    const rows = await received(device);
    const text = rows.map((row) => new TextDecoder().decode(toBinary(RowSchema, row))).join("\n");
    const secrets = fakeGoogle
      .instancesOf(calendarOf("Personal"), series.id)
      .flatMap(({ id, etag }) => [id, etag])
      .concat(series.id, series.etag);

    expect(await occurrences(device, "Choir")).toHaveLength(2);
    for (const secret of secrets) expect(text).not.toContain(secret);
  });
});

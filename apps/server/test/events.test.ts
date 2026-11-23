import { reset, runInDurableObject } from "cloudflare:test";
import { toBinary } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import { a4Portrait, itemPageId, newId } from "@foyer/shared";
import { type Item, ItemKind } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import { PageKind } from "@foyer/shared/gen/foyer/page/v1/page_pb";
import { CalendarState, type Space, SpaceKind } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import { type Sticker, StickerKind } from "@foyer/shared/gen/foyer/sticker/v1/sticker_pb";
import {
  type ChangeResult,
  type Row,
  RowKind,
  RowSchema,
} from "@foyer/shared/gen/foyer/sync/v1/sync_pb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { callsPerRun } from "../src/calendars";
import { type FakeEvent, type FakeEventFields, fakeGoogle } from "../src/fake-google";
import { theHousehold } from "../src/household";
import { householdMigrations, migrate } from "../src/migrations";
import { backendUrl, localBackendUrl, requestBackend } from "./backend";
import { calendars, connectGoogle, work } from "./calendar-helpers";
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
  itemSetTitle,
  madeAt,
  pageCreate,
  signIn,
  spaceCreate,
  spaceRename,
  spaceSetArchived,
  stickerPlace,
} from "./sync-device";

const alex = "member@example.com";
const sam = "housemate@example.com";
const alexsAccount = `dev:${alex}`;
const samsAccount = `dev:${sam}`;
const minute = 60_000;

const devices: Device[] = [];

afterEach(async () => {
  for (const device of devices.splice(0)) device.close();
  vi.restoreAllMocks();
  vi.useRealTimers();
  fakeGoogle.reset();
  await reset();
});

type Member = { memberId: string; token: string; device: Device };

async function member(email: string, timeZone = "Europe/Madrid"): Promise<Member> {
  const { memberId, token } = await signIn(email);
  const device = await Device.connect(token);
  devices.push(device);
  await device.welcome();
  await connectGoogle(token, { timeZone });
  await work();
  return { memberId, token, device };
}

async function received(device: Device): Promise<Row[]> {
  return (await device.catchUp()).flatMap(({ rows }) => rows);
}

async function spaceNamed(device: Device, name: string): Promise<Space> {
  const spaces = new Map<string, Space>();
  for (const { row } of await received(device)) {
    if (row.case === "space") spaces.set(row.value.id, row.value);
  }
  const space = [...spaces.values()].find((each) => each.name === name);
  if (!space) throw new Error(`There's no space called ${name}`);
  return space;
}

async function inbox(device: Device): Promise<string> {
  for (const { row } of await received(device)) {
    if (row.case === "space" && row.value.kind === SpaceKind.INBOX) return row.value.id;
  }
  throw new Error("There's no Inbox");
}

async function eventsOf(device: Device): Promise<Map<string, Item>> {
  const items = new Map<string, Item>();
  for (const { row } of await received(device)) {
    if (row.case === "item" && row.value.kind === ItemKind.EVENT)
      items.set(row.value.id, row.value);
    if (row.case === "deleted" && row.value.kind === RowKind.ITEM) items.delete(row.value.id);
  }
  return items;
}

async function eventTitled(device: Device, title: string): Promise<Item | undefined> {
  return [...(await eventsOf(device)).values()].find((event) => event.title === title);
}

function calendarOf(account: string, spaceName: string): string {
  for (const [id, calendar] of fakeGoogle.calendars) {
    if (calendar.subject === account && calendar.name === `Foyer · ${spaceName}`) return id;
  }
  throw new Error(`${account} has no calendar for ${spaceName}`);
}

function googleEvents(account: string, spaceName: string) {
  return fakeGoogle.eventsOf(calendarOf(account, spaceName));
}

type Time = { startsOn: string; endsOn: string } | { startsAt: string; endsAt: string };

function timeFields(time: Time) {
  return "startsOn" in time
    ? time
    : {
        startsAt: timestampFromMs(Date.parse(time.startsAt)),
        endsAt: timestampFromMs(Date.parse(time.endsAt)),
      };
}

const evening: Time = { startsAt: "2026-11-20T19:00:00Z", endsAt: "2026-11-20T21:00:00Z" };

function eventCreate(
  spaceId: string,
  title: string,
  time: Time = evening,
  made: { at?: ChangeInit["at"] } = {},
): ChangeInit {
  return itemCreate({ spaceId, title, kind: ItemKind.EVENT, ...timeFields(time) }, made);
}

function eventSetTime(itemId: string, time: Time, made: { at?: ChangeInit["at"] } = {}) {
  const value = { itemId, ...timeFields(time) };
  return {
    changeId: newId(),
    at: timestampFromMs(Date.now()),
    ...made,
    change: { case: "eventSetTime", value },
  } satisfies ChangeInit;
}

function resultOf(result: ChangeResult | undefined) {
  return result?.result.case === "refused"
    ? { refused: result.result.value.reason }
    : { committed: result?.result.case === "seq" };
}

async function addInPersonal(device: Device, title: string, time: Time = evening) {
  const personal = await spaceNamed(device, "Personal");
  const create = eventCreate(personal.id, title, time);
  await device.push(create);
  await work();
  return idOf(create);
}

function addInGoogle(account: string, spaceName: string, fields: FakeEventFields) {
  return fakeGoogle.addEvent(calendarOf(account, spaceName), {
    start: { dateTime: "2026-11-20T19:00:00Z" },
    end: { dateTime: "2026-11-20T20:00:00Z" },
    ...fields,
  });
}

/** Lets the time between reads pass while a device is connected, and runs the household's work. */
async function readAgain(): Promise<void> {
  vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + minute });
  await work();
}

describe("creating events", () => {
  it("writes an event with times, and an all-day event, to its space's calendar", async () => {
    const { device } = await member(alex);

    await addInPersonal(device, "Dinner");
    await addInPersonal(device, "Holiday", { startsOn: "2026-12-24", endsOn: "2026-12-26" });

    const inGoogle = googleEvents(alexsAccount, "Personal");
    expect(inGoogle.find(({ summary }) => summary === "Dinner")).toMatchObject({
      start: { dateTime: "2026-11-20T19:00:00.000Z" },
      end: { dateTime: "2026-11-20T21:00:00.000Z" },
    });
    expect(inGoogle.find(({ summary }) => summary === "Holiday")).toMatchObject({
      start: { date: "2026-12-24" },
      end: { date: "2026-12-27" },
    });
    expect(await eventTitled(device, "Holiday")).toMatchObject({
      startsOn: "2026-12-24",
      endsOn: "2026-12-26",
      date: "2026-12-24",
    });
  });

  it("sends the event to every member who sees its space, with who made it", async () => {
    const alexs = await member(alex);
    const sams = await member(sam);
    const garden = spaceCreate({ name: "Garden", kind: SpaceKind.SHARED });
    await alexs.device.push(garden);
    await work();

    await alexs.device.push(eventCreate(idOf(garden), "Plant the bulbs"));

    expect(await eventTitled(sams.device, "Plant the bulbs")).toMatchObject({
      createdBy: alexs.memberId,
      spaceId: idOf(garden),
    });
  });

  it("gives an event the day it starts in its calendar's time zone, even late in the evening", async () => {
    const { device } = await member(alex, "America/Santo_Domingo");

    await addInPersonal(device, "Late film", {
      startsAt: "2026-11-21T03:30:00Z",
      endsAt: "2026-11-21T05:30:00Z",
    });
    await addInPersonal(device, "Early run", {
      startsAt: "2026-11-21T10:00:00Z",
      endsAt: "2026-11-21T11:00:00Z",
    });

    expect((await eventTitled(device, "Late film"))?.date).toBe("2026-11-20");
    expect((await eventTitled(device, "Early run"))?.date).toBe("2026-11-21");
  });

  it.each<[string, (spaces: { personal: string; inbox: string }) => ChangeInit, string]>([
    [
      "in the Inbox, which has no calendar",
      ({ inbox }) => eventCreate(inbox, "Dinner"),
      "An event can only go in a space with a Google calendar.",
    ],
    [
      "with a date of its own",
      ({ personal }) =>
        itemCreate({
          spaceId: personal,
          kind: ItemKind.EVENT,
          date: "2026-11-20",
          ...timeFields(evening),
        }),
      "An event's date is the day it starts, which the household sets.",
    ],
    [
      "that ends before it starts",
      ({ personal }) =>
        eventCreate(personal, "Dinner", { startsOn: "2026-11-21", endsOn: "2026-11-20" }),
      "An event can't end before it starts.",
    ],
    [
      "without a time",
      ({ personal }) => itemCreate({ spaceId: personal, kind: ItemKind.EVENT }),
      "An event happens either on whole days or between two times.",
    ],
  ])("refuses an event %s", async (_, change, reason) => {
    const { device } = await member(alex);
    const spaces = {
      personal: (await spaceNamed(device, "Personal")).id,
      inbox: await inbox(device),
    };

    const committed = await device.push(change(spaces));

    expect(resultOf(committed.results[0])).toEqual({ refused: reason });
  });
});

describe("changing events in Foyer", () => {
  it("writes title, description and time changes to Google", async () => {
    const { device } = await member(alex);
    const dinner = await addInPersonal(device, "Dinner");

    await device.push(
      itemSetTitle(dinner, "Dinner with Sam"),
      itemSetDescription(dinner, "At the new place"),
      eventSetTime(dinner, { startsOn: "2026-11-22", endsOn: "2026-11-22" }),
    );
    await work();

    expect(googleEvents(alexsAccount, "Personal")).toEqual([
      expect.objectContaining({
        summary: "Dinner with Sam",
        description: "At the new place",
        start: { date: "2026-11-22" },
        end: { date: "2026-11-23" },
      }),
    ]);
    expect((await eventTitled(device, "Dinner with Sam"))?.date).toBe("2026-11-22");
  });

  it("keeps what Foyer doesn't keep of an event in Google", async () => {
    const { device } = await member(alex);
    const dinner = await addInPersonal(device, "Dinner");
    const [inGoogle] = googleEvents(alexsAccount, "Personal");
    if (inGoogle) Object.assign(inGoogle, { location: "Home" });

    await device.push(itemSetTitle(dinner, "Dinner with Sam"));
    await work();

    expect(googleEvents(alexsAccount, "Personal")[0]).toMatchObject({
      summary: "Dinner with Sam",
      location: "Home",
    });
  });

  it("leaves a description written as HTML in Google as it is, until it changes in Foyer", async () => {
    const { device } = await member(alex);
    addInGoogle(alexsAccount, "Personal", {
      summary: "Dentist",
      description: "Bring:<br><b>the card</b>",
    });
    await readAgain();
    const dentist = (await eventTitled(device, "Dentist"))?.id ?? "";

    await device.push(itemSetTitle(dentist, "Dentist at 7"));
    await work();

    expect(googleEvents(alexsAccount, "Personal")[0]).toMatchObject({
      summary: "Dentist at 7",
      description: "Bring:<br><b>the card</b>",
    });

    await device.push(itemSetDescription(dentist, "Bring:\nthe card and a pen"));
    await work();

    expect(googleEvents(alexsAccount, "Personal")[0]?.description).toBe(
      "Bring:\nthe card and a pen",
    );
  });

  it("deletes an event in Google", async () => {
    const { device } = await member(alex);
    const dinner = await addInPersonal(device, "Dinner");

    await device.push(itemDelete(dinner));
    await work();

    expect(googleEvents(alexsAccount, "Personal")).toEqual([]);
  });

  it("moves an event to another calendar in the same account, keeping its Google id", async () => {
    const { device } = await member(alex);
    const work_ = spaceCreate({ name: "Work", kind: SpaceKind.PERSONAL });
    await device.push(work_);
    await work();
    const dinner = await addInPersonal(device, "Dinner");
    const [before] = googleEvents(alexsAccount, "Personal");

    await device.push(itemMove(dinner, idOf(work_)));
    await work();

    expect(googleEvents(alexsAccount, "Personal")).toEqual([]);
    expect(googleEvents(alexsAccount, "Work")).toEqual([
      expect.objectContaining({ id: before?.id, summary: "Dinner" }),
    ]);
    expect((await eventTitled(device, "Dinner"))?.spaceId).toBe(idOf(work_));
  });

  it("moves an event to a calendar in another account by making it there and deleting the old", async () => {
    const alexs = await member(alex);
    const sams = await member(sam);
    const garden = spaceCreate({ name: "Garden", kind: SpaceKind.SHARED });
    await sams.device.push(garden);
    await work();
    const dinner = await addInPersonal(alexs.device, "Dinner");

    await alexs.device.push(itemMove(dinner, idOf(garden)));
    await work();

    expect(googleEvents(alexsAccount, "Personal")).toEqual([]);
    expect(googleEvents(samsAccount, "Garden")).toEqual([
      expect.objectContaining({ summary: "Dinner" }),
    ]);
    expect((await eventTitled(sams.device, "Dinner"))?.id).toBe(dinner);
  });

  it("gives a moved event the day it starts in its new calendar's time zone", async () => {
    const alexs = await member(alex, "America/Santo_Domingo");
    const sams = await member(sam, "Europe/Madrid");
    const garden = spaceCreate({ name: "Garden", kind: SpaceKind.SHARED });
    await sams.device.push(garden);
    await work();
    const late = { startsAt: "2026-11-21T03:30:00Z", endsAt: "2026-11-21T04:30:00Z" };
    const film = await addInPersonal(alexs.device, "Late film", late);

    await alexs.device.push(itemMove(film, idOf(garden)));

    expect((await eventTitled(alexs.device, "Late film"))?.date).toBe("2026-11-21");
  });

  it("refuses moving an event to the Inbox, setting its date, and setting a task's time", async () => {
    const { device } = await member(alex);
    const dinner = await addInPersonal(device, "Dinner");
    const task = itemCreate({ spaceId: await inbox(device) });
    await device.push(task);

    const committed = await device.push(
      itemMove(dinner, await inbox(device)),
      itemSetDate(dinner, "2026-11-25"),
      eventSetTime(idOf(task), evening),
    );

    expect(committed.results.map(resultOf)).toEqual([
      { refused: "An event can only go in a space with a Google calendar." },
      { refused: "An event's date is the day it starts, which the household sets." },
      { refused: "Only events have a time." },
    ]);
  });

  it("keeps the time changed last, by when each change was made", async () => {
    const { device } = await member(alex);
    const dinner = await addInPersonal(device, "Dinner");
    const now = Date.now();

    await device.push(
      eventSetTime(dinner, { startsOn: "2026-11-22", endsOn: "2026-11-22" }, { at: madeAt(now) }),
      eventSetTime(
        dinner,
        { startsOn: "2026-11-23", endsOn: "2026-11-23" },
        { at: madeAt(now - minute) },
      ),
    );

    expect((await eventsOf(device)).get(dinner)).toMatchObject({
      startsOn: "2026-11-22",
      date: "2026-11-22",
    });
  });

  it("refuses putting an event under a task in a space without a Google calendar", async () => {
    const { device } = await member(alex);
    const dinner = await addInPersonal(device, "Dinner");
    const task = itemCreate({ spaceId: await inbox(device) });
    await device.push(task);

    const committed = await device.push(itemSetParent(dinner, idOf(task)));

    expect(resultOf(committed.results[0])).toEqual({
      refused: "An event can only go in a space with a Google calendar.",
    });
  });

  it("makes no second event in Google when it sends one again after losing Google's answer", async () => {
    const { device } = await member(alex);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() });
    const answer = fakeGoogle.answer.bind(fakeGoogle);
    vi.spyOn(fakeGoogle, "answer").mockImplementationOnce(async (request) => {
      await answer(request);
      return new Response("Lost on the way", { status: 503 });
    });
    const personal = await spaceNamed(device, "Personal");

    await device.push(eventCreate(personal.id, "Dinner"));
    await work();
    vi.advanceTimersByTime(minute);
    const dinner = (await eventTitled(device, "Dinner"))?.id ?? "";
    await device.push(itemSetTitle(dinner, "Dinner with Sam"));
    await work();

    expect(googleEvents(alexsAccount, "Personal")).toEqual([
      expect.objectContaining({ summary: "Dinner with Sam" }),
    ]);
  });

  it("tries a write again until Google answers, waiting longer each time", async () => {
    const { device } = await member(alex);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() });
    const personal = await spaceNamed(device, "Personal");

    fakeGoogle.down = true;
    await device.push(eventCreate(personal.id, "Dinner"));
    await work();
    fakeGoogle.down = false;
    await work();
    const tooSoon = googleEvents(alexsAccount, "Personal");
    vi.advanceTimersByTime(minute);
    await work();

    expect(tooSoon).toEqual([]);
    expect(googleEvents(alexsAccount, "Personal")).toEqual([
      expect.objectContaining({ summary: "Dinner" }),
    ]);
  });

  it("keeps changes made while a space is paused, and writes them once its holder reconnects", async () => {
    const { token, device } = await member(alex);
    const dinner = await addInPersonal(device, "Dinner");
    vi.spyOn(console, "error").mockImplementation(() => {});

    fakeGoogle.revokeAccessOf(alexsAccount);
    await device.push(itemSetTitle(dinner, "Dinner with Sam"));
    await work();
    const paused = await spaceNamed(device, "Personal");
    const whilePaused = googleEvents(alexsAccount, "Personal")[0]?.summary;
    await connectGoogle(token);
    await work();

    expect(paused.calendarState).toBe(CalendarState.PAUSED);
    expect(whilePaused).toBe("Dinner");
    expect(googleEvents(alexsAccount, "Personal")[0]?.summary).toBe("Dinner with Sam");
    expect((await eventTitled(device, "Dinner with Sam"))?.title).toBe("Dinner with Sam");
  });

  it("waits for a disconnected holder to connect again", async () => {
    const { token, device } = await member(alex);
    const dinner = await addInPersonal(device, "Dinner");

    await calendars(token).disconnect();
    await device.push(itemSetTitle(dinner, "Dinner with Sam"));
    await work();
    const whileDisconnected = googleEvents(alexsAccount, "Personal")[0]?.summary;
    await connectGoogle(token);
    await work();

    expect(whileDisconnected).toBe("Dinner");
    expect(googleEvents(alexsAccount, "Personal")[0]?.summary).toBe("Dinner with Sam");
  });
});

describe("archived spaces' calendars", () => {
  it("neither reads nor writes an archived space's calendar, and settles both once it's restored", async () => {
    const { device } = await member(alex);
    const dinner = await addInPersonal(device, "Dinner");
    const lunch = await addInPersonal(device, "Lunch");
    const personal = await spaceNamed(device, "Personal");
    const calendarId = calendarOf(alexsAccount, "Personal");
    const inGoogle = (title: string) =>
      fakeGoogle.eventsOf(calendarId).find(({ summary }) => summary === title)?.id ?? "";

    await device.push(itemSetTitle(lunch, "Lunch with Sam"), spaceSetArchived(personal.id, true));
    fakeGoogle.changeEvent(calendarId, inGoogle("Dinner"), { summary: "Dinner with Sam" });
    addInGoogle(alexsAccount, "Personal", { summary: "Dentist" });
    await readAgain();
    const inFoyerWhileArchived = [...(await eventsOf(device)).values()].map(({ title }) => title);
    const inGoogleWhileArchived = googleEvents(alexsAccount, "Personal").map(
      ({ summary }) => summary,
    );
    await device.push(spaceSetArchived(personal.id, false));
    await work();

    expect(inFoyerWhileArchived.sort()).toEqual(["Dinner", "Lunch with Sam"]);
    expect(inGoogleWhileArchived.sort()).toEqual(["Dentist", "Dinner with Sam", "Lunch"]);
    const events = await eventsOf(device);
    expect(events.get(dinner)?.title).toBe("Dinner with Sam");
    expect([...events.values()].map(({ title }) => title).sort()).toEqual([
      "Dentist",
      "Dinner with Sam",
      "Lunch with Sam",
    ]);
    expect(
      googleEvents(alexsAccount, "Personal")
        .map(({ summary }) => summary)
        .sort(),
    ).toEqual(["Dentist", "Dinner with Sam", "Lunch with Sam"]);
  });
});

describe("archived spaces' events", () => {
  it("refuses changing an event's time in an archived space", async () => {
    const { device } = await member(alex);
    const dinner = await addInPersonal(device, "Dinner");
    await device.push(spaceSetArchived((await spaceNamed(device, "Personal")).id, true));

    const committed = await device.push(
      eventSetTime(dinner, { startsAt: "2026-11-21T19:00:00Z", endsAt: "2026-11-21T21:00:00Z" }),
    );

    expect(resultOf(committed.results[0])).toEqual({
      refused: "This space is archived. Restore it to change it.",
    });
  });

  it("deletes an event from Google only once its space is restored", async () => {
    const { device } = await member(alex);
    const dinner = await addInPersonal(device, "Dinner");
    const personal = (await spaceNamed(device, "Personal")).id;

    await device.push(itemDelete(dinner), spaceSetArchived(personal, true));
    await work();
    const whileArchived = googleEvents(alexsAccount, "Personal").map(({ summary }) => summary);
    await device.push(spaceSetArchived(personal, false));
    await work();

    expect(whileArchived).toEqual(["Dinner"]);
    expect(googleEvents(alexsAccount, "Personal")).toEqual([]);
  });

  it("renames an archived space's calendar only once it's restored", async () => {
    const { device } = await member(alex);
    const personal = (await spaceNamed(device, "Personal")).id;

    await device.push(spaceRename(personal, "Mine"), spaceSetArchived(personal, true));
    await work();
    const whileArchived = fakeGoogle.calendarsOf(alexsAccount).map(({ name }) => name);
    await device.push(spaceSetArchived(personal, false));
    await work();

    expect(whileArchived).toEqual(["Foyer · Personal"]);
    expect(fakeGoogle.calendarsOf(alexsAccount).map(({ name }) => name)).toEqual(["Foyer · Mine"]);
  });
});

describe("reading changes made in Google", () => {
  it("adds an event added in Google, with no member as its creator", async () => {
    const { device } = await member(alex, "America/Santo_Domingo");

    const added = addInGoogle(alexsAccount, "Personal", {
      summary: "Dentist",
      description: "Bring the card",
      start: { dateTime: "2026-11-20T23:30:00-04:00" },
      end: { dateTime: "2026-11-21T00:30:00-04:00" },
    });
    await readAgain();

    const dentist = await eventTitled(device, "Dentist");
    expect(dentist).toMatchObject({
      createdBy: "",
      description: "Bring the card",
      date: "2026-11-20",
      spaceId: (await spaceNamed(device, "Personal")).id,
      startsAt: timestampFromMs(Date.parse("2026-11-21T03:30:00Z")),
      endsAt: timestampFromMs(Date.parse("2026-11-21T04:30:00Z")),
    });
    expect(Number(dentist?.createdAt?.seconds) * 1000).toBe(
      Math.floor(Date.parse(added.created) / 1000) * 1000,
    );
  });

  it("reads an all-day event's last day, and calls an event without a title what Google does", async () => {
    const { device } = await member(alex);

    addInGoogle(alexsAccount, "Personal", {
      summary: "  ",
      start: { date: "2026-12-24" },
      end: { date: "2026-12-27" },
    });
    await readAgain();

    expect(await eventTitled(device, "(No title)")).toMatchObject({
      startsOn: "2026-12-24",
      endsOn: "2026-12-26",
      date: "2026-12-24",
    });
  });

  it("reads a description written as HTML as plain text", async () => {
    const { device } = await member(alex);

    addInGoogle(alexsAccount, "Personal", {
      summary: "Dentist",
      description:
        'Bring:<ul><li>the card</li><li>a pen</li></ul><a href="https://example.com/map">Map</a>',
    });
    await readAgain();

    expect((await eventTitled(device, "Dentist"))?.description).toBe(
      "Bring:\nthe card\na pen\nMap (https://example.com/map)",
    );
  });

  it("cuts a title too long for Foyer, and ends an event that ends before it starts as it starts", async () => {
    const { device } = await member(alex);
    const long = "a".repeat(600);

    addInGoogle(alexsAccount, "Personal", {
      summary: long,
      start: { dateTime: "2026-11-20T19:00:00Z" },
      end: { dateTime: "2026-11-20T18:00:00Z" },
    });
    await readAgain();

    expect(await eventTitled(device, "a".repeat(500))).toMatchObject({
      startsAt: timestampFromMs(Date.parse("2026-11-20T19:00:00Z")),
      endsAt: timestampFromMs(Date.parse("2026-11-20T19:00:00Z")),
    });
  });

  it("dates every event again when its calendar's time zone changes in Google", async () => {
    const { device } = await member(alex, "America/Santo_Domingo");
    const late = { startsAt: "2026-11-21T03:30:00Z", endsAt: "2026-11-21T05:30:00Z" };
    const film = await addInPersonal(device, "Late film", late);
    const before = (await eventsOf(device)).get(film)?.date;

    const calendar = fakeGoogle.calendars.get(calendarOf(alexsAccount, "Personal"));
    if (calendar) calendar.timeZone = "Europe/Madrid";
    await readAgain();

    expect(before).toBe("2026-11-20");
    expect((await eventsOf(device)).get(film)?.date).toBe("2026-11-21");
  });

  it("changes and deletes events changed and deleted in Google", async () => {
    const { device } = await member(alex);
    const dinner = await addInPersonal(device, "Dinner");
    const lunch = await addInPersonal(device, "Lunch");
    const calendarId = calendarOf(alexsAccount, "Personal");
    const inGoogle = (title: string) =>
      fakeGoogle.eventsOf(calendarId).find(({ summary }) => summary === title)?.id ?? "";

    fakeGoogle.changeEvent(calendarId, inGoogle("Dinner"), {
      summary: "Dinner with Sam",
      start: { date: "2026-11-22" },
      end: { date: "2026-11-23" },
    });
    fakeGoogle.removeEvent(calendarId, inGoogle("Lunch"));
    await readAgain();

    const events = await eventsOf(device);
    expect(events.get(dinner)).toMatchObject({
      title: "Dinner with Sam",
      startsOn: "2026-11-22",
      endsOn: "2026-11-22",
      date: "2026-11-22",
    });
    expect(events.get(dinner)?.startsAt).toBeUndefined();
    expect(events.has(lunch)).toBe(false);
  });

  it("reads every minute while a device is connected, and every 15 minutes otherwise", async () => {
    const { device } = await member(alex);
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() });
    const asked: Request[] = [];
    const answer = fakeGoogle.answer.bind(fakeGoogle);
    vi.spyOn(fakeGoogle, "answer").mockImplementation((request) => {
      asked.push(request.clone());
      return answer(request);
    });
    const reads = () =>
      asked.filter(
        ({ method, url }) => method === "GET" && new URL(url).pathname.endsWith("/events"),
      ).length;

    vi.advanceTimersByTime(minute - 1000);
    await work();
    const tooSoon = reads();
    vi.advanceTimersByTime(1000);
    await work();
    const afterAMinute = reads();
    device.close();
    devices.splice(0);
    await vi.waitFor(async () =>
      expect(await runInDurableObject(theHousehold(), (_, state) => state.getWebSockets())).toEqual(
        [],
      ),
    );
    vi.advanceTimersByTime(14 * minute);
    await work();
    const whileAway = reads();
    vi.advanceTimersByTime(minute);
    await work();

    expect(tooSoon).toBe(0);
    expect(afterAMinute).toBe(1);
    expect(whileAway).toBe(1);
    expect(reads()).toBe(2);
  });

  it("reads at once when a device connects", async () => {
    const { token, device } = await member(alex);

    addInGoogle(alexsAccount, "Personal", { summary: "Dentist" });
    const another = await Device.connect(token);
    devices.push(another);
    await another.welcome();
    await work();

    expect(await eventTitled(device, "Dentist")).toBeDefined();
  });

  it("reads every event again when Google drops the sync token", async () => {
    const { device } = await member(alex);
    const dinner = await addInPersonal(device, "Dinner");
    const calendarId = calendarOf(alexsAccount, "Personal");
    const [inGoogle] = fakeGoogle.eventsOf(calendarId);

    fakeGoogle.dropSyncTokens(calendarId);
    fakeGoogle.calendars.get(calendarId)?.events.delete(inGoogle?.id ?? "");
    addInGoogle(alexsAccount, "Personal", { summary: "Dentist" });
    await readAgain();

    const events = await eventsOf(device);
    expect(events.has(dinner)).toBe(false);
    expect([...events.values()].map(({ title }) => title)).toEqual(["Dentist"]);
  });
});

describe("events moved in Google from one of Foyer's calendars to another", () => {
  type Calendar = [account: string, spaceName: string];

  async function personalSpace(device: Device, name: string): Promise<string> {
    const create = spaceCreate({ name, kind: SpaceKind.PERSONAL });
    await device.push(create);
    await work();
    return idOf(create);
  }

  async function addIn(device: Device, spaceId: string, title: string): Promise<string> {
    const create = eventCreate(spaceId, title);
    await device.push(create);
    await work();
    return idOf(create);
  }

  function moveInGoogle(title: string, from: Calendar, to: Calendar): string {
    const fromId = calendarOf(...from);
    const eventId = fakeGoogle.eventsOf(fromId).find(({ summary }) => summary === title)?.id ?? "";
    fakeGoogle.moveEvent(fromId, eventId, calendarOf(...to));
    return eventId;
  }

  function bodyPage(itemId: string): ChangeInit {
    return pageCreate({ pageId: itemPageId(itemId), kind: PageKind.ITEM, itemId, ...a4Portrait });
  }

  async function seenBy(device: Device) {
    const items = new Map<string, Item>();
    const stickers = new Map<string, Sticker>();
    for (const { row } of await received(device)) {
      if (row.case === "item") items.set(row.value.id, row.value);
      if (row.case === "sticker") stickers.set(row.value.id, row.value);
      if (row.case !== "deleted") continue;
      if (row.value.kind === RowKind.ITEM) items.delete(row.value.id);
      if (row.value.kind === RowKind.STICKER) stickers.delete(row.value.id);
    }
    const stickersOf = (itemId: string) =>
      [...stickers.values()].filter((sticker) => sticker.itemId === itemId).map(({ id }) => id);
    return { items, stickers, stickersOf };
  }

  it.each([
    { reading: "its deletion first", from: "Personal", to: "Work" },
    { reading: "it in its new calendar first", from: "Work", to: "Personal" },
  ] as const)(
    "moves the event to the new calendar's space, keeping its id and stickers, reading $reading",
    async ({ from, to }) => {
      const { device } = await member(alex);
      const spaces = {
        Personal: (await spaceNamed(device, "Personal")).id,
        Work: await personalSpace(device, "Work"),
      };
      const dinner = await addIn(device, spaces[from], "Dinner");
      const before = await seenBy(device);

      const googleId = moveInGoogle("Dinner", [alexsAccount, from], [alexsAccount, to]);
      await readAgain();

      const after = await seenBy(device);
      expect([...(await eventsOf(device)).values()]).toEqual([
        expect.objectContaining({ id: dinner, spaceId: spaces[to] }),
      ]);
      expect(before.stickersOf(dinner)).not.toEqual([]);
      expect(after.stickersOf(dinner)).toEqual(before.stickersOf(dinner));
      expect(googleEvents(alexsAccount, from)).toEqual([]);
      expect(googleEvents(alexsAccount, to)).toEqual([
        expect.objectContaining({ id: googleId, summary: "Dinner" }),
      ]);
    },
  );

  it("takes the event out of the sight of members who can't see its new space", async () => {
    const alexs = await member(alex);
    const sams = await member(sam);
    const garden = spaceCreate({ name: "Garden", kind: SpaceKind.SHARED });
    await sams.device.push(garden);
    await work();
    const dinner = await addIn(alexs.device, idOf(garden), "Dinner");
    const seenBySam = (await eventsOf(sams.device)).has(dinner);

    moveInGoogle("Dinner", [samsAccount, "Garden"], [alexsAccount, "Personal"]);
    await readAgain();

    expect(seenBySam).toBe(true);
    expect((await eventsOf(sams.device)).has(dinner)).toBe(false);
    expect((await eventsOf(alexs.device)).get(dinner)?.spaceId).toBe(
      (await spaceNamed(alexs.device, "Personal")).id,
    );
  });

  it("takes the event out of the task it was under, peeling its sticker off the task's body page", async () => {
    const { device } = await member(alex);
    const personal = (await spaceNamed(device, "Personal")).id;
    const workSpace = await personalSpace(device, "Work");
    const dinner = await addIn(device, personal, "Dinner");
    const party = itemCreate({ spaceId: personal, title: "Plan the party" });
    const sticker = stickerPlace({
      pageId: itemPageId(idOf(party)),
      itemId: dinner,
      kind: StickerKind.EVENT,
    });
    await device.push(party, bodyPage(idOf(party)), itemSetParent(dinner, idOf(party)), sticker);
    const before = await seenBy(device);

    moveInGoogle("Dinner", [alexsAccount, "Personal"], [alexsAccount, "Work"]);
    await readAgain();

    const after = await seenBy(device);
    expect(before.stickers.has(idOf(sticker))).toBe(true);
    expect(after.stickers.has(idOf(sticker))).toBe(false);
    expect(after.items.get(dinner)).toMatchObject({ spaceId: workSpace, parentId: "" });
    expect(after.items.get(idOf(party))?.spaceId).toBe(personal);
  });

  it("keeps the event under a task it was put under after the move in Google, moving it back in Google", async () => {
    const { device } = await member(alex);
    const personal = (await spaceNamed(device, "Personal")).id;
    await personalSpace(device, "Work");
    const dinner = await addIn(device, personal, "Dinner");
    const party = itemCreate({ spaceId: personal, title: "Plan the party" });
    await device.push(party);

    const googleId = moveInGoogle("Dinner", [alexsAccount, "Personal"], [alexsAccount, "Work"]);
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 1000 });
    await device.push(itemSetParent(dinner, idOf(party)));
    await readAgain();
    await work();

    expect((await eventsOf(device)).get(dinner)).toMatchObject({
      spaceId: personal,
      parentId: idOf(party),
    });
    expect(googleEvents(alexsAccount, "Work")).toEqual([]);
    expect(googleEvents(alexsAccount, "Personal")).toEqual([
      expect.objectContaining({ id: googleId, summary: "Dinner" }),
    ]);
  });

  it("keeps a move made in Foyer after the one made in Google, moving the event on in Google", async () => {
    const { device } = await member(alex);
    await personalSpace(device, "Work");
    const home = await personalSpace(device, "Home");
    const dinner = await addInPersonal(device, "Dinner");

    const googleId = moveInGoogle("Dinner", [alexsAccount, "Personal"], [alexsAccount, "Work"]);
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 1000 });
    await device.push(itemMove(dinner, home));
    await work();

    expect((await eventsOf(device)).get(dinner)?.spaceId).toBe(home);
    expect(googleEvents(alexsAccount, "Work")).toEqual([]);
    expect(googleEvents(alexsAccount, "Home")).toEqual([
      expect.objectContaining({ id: googleId, summary: "Dinner" }),
    ]);
  });

  it("writes a change made in Foyer while the event moved in Google to its new calendar", async () => {
    const { device } = await member(alex);
    const workSpace = await personalSpace(device, "Work");
    const dinner = await addInPersonal(device, "Dinner");

    const googleId = moveInGoogle("Dinner", [alexsAccount, "Personal"], [alexsAccount, "Work"]);
    await device.push(itemSetTitle(dinner, "Dinner with Sam"));
    await work();

    expect((await eventsOf(device)).get(dinner)).toMatchObject({
      title: "Dinner with Sam",
      spaceId: workSpace,
    });
    expect(googleEvents(alexsAccount, "Work")).toEqual([
      expect.objectContaining({ id: googleId, summary: "Dinner with Sam" }),
    ]);
  });

  it("follows the event when it reads every event again after Google drops the sync token", async () => {
    const { device } = await member(alex);
    const workSpace = await personalSpace(device, "Work");
    const dinner = await addInPersonal(device, "Dinner");

    moveInGoogle("Dinner", [alexsAccount, "Personal"], [alexsAccount, "Work"]);
    fakeGoogle.dropSyncTokens(calendarOf(alexsAccount, "Personal"));
    await readAgain();

    expect([...(await eventsOf(device)).values()]).toEqual([
      expect.objectContaining({ id: dinner, spaceId: workSpace }),
    ]);
  });

  it("makes another event of one that Google still has in the calendar Foyer knows it in", async () => {
    const { device } = await member(alex);
    const personal = (await spaceNamed(device, "Personal")).id;
    const workSpace = await personalSpace(device, "Work");
    const dinner = await addIn(device, workSpace, "Dinner");

    const googleId = moveInGoogle("Dinner", [alexsAccount, "Work"], [alexsAccount, "Personal"]);
    const original = fakeGoogle.calendars.get(calendarOf(alexsAccount, "Work"))?.events;
    original?.set(googleId, { ...(original.get(googleId) as FakeEvent), status: "confirmed" });
    await readAgain();

    const events = [...(await eventsOf(device)).values()];
    expect(events.map(({ id, spaceId, title }) => ({ id, spaceId, title }))).toEqual(
      expect.arrayContaining([
        { id: dinner, spaceId: workSpace, title: "Dinner" },
        { id: expect.not.stringMatching(dinner), spaceId: personal, title: "Dinner" },
      ]),
    );
    expect(events).toHaveLength(2);
  });

  it("waits until Google says where the event went before moving or deleting it", async () => {
    const { device } = await member(alex);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const personal = (await spaceNamed(device, "Personal")).id;
    const workSpace = await personalSpace(device, "Work");
    const dinner = await addInPersonal(device, "Dinner");
    const googleId = moveInGoogle("Dinner", [alexsAccount, "Personal"], [alexsAccount, "Work"]);
    const answer = fakeGoogle.answer.bind(fakeGoogle);
    const askingForTheEvent = vi
      .spyOn(fakeGoogle, "answer")
      .mockImplementation(async (request) =>
        request.method === "GET" && new URL(request.url).pathname.endsWith(`/events/${googleId}`)
          ? new Response("Google is down", { status: 503 })
          : answer(request),
      );

    await readAgain();
    const whileDown = (await eventsOf(device)).get(dinner)?.spaceId;
    askingForTheEvent.mockRestore();
    await readAgain();

    expect(whileDown).toBe(personal);
    expect((await eventsOf(device)).get(dinner)?.spaceId).toBe(workSpace);
  });

  it("takes the event as moved, without asking Google, when Foyer knows it in an archived space's calendar", async () => {
    const { device } = await member(alex);
    const workSpace = await personalSpace(device, "Work");
    const dinner = await addIn(device, workSpace, "Dinner");
    const archivedCalendar = calendarOf(alexsAccount, "Work");
    await device.push(spaceSetArchived(workSpace, true));
    moveInGoogle("Dinner", [alexsAccount, "Work"], [alexsAccount, "Personal"]);
    const answer = fakeGoogle.answer.bind(fakeGoogle);
    const askedAbout: string[] = [];
    vi.spyOn(fakeGoogle, "answer").mockImplementation((request) => {
      askedAbout.push(decodeURIComponent(new URL(request.url).pathname));
      return answer(request);
    });

    await readAgain();

    expect((await eventsOf(device)).get(dinner)?.spaceId).toBe(
      (await spaceNamed(device, "Personal")).id,
    );
    expect(askedAbout.filter((path) => path.includes(archivedCalendar))).toEqual([]);
  });

  it("takes the event as moved when the holder of the calendar Foyer knows it in has disconnected", async () => {
    const alexs = await member(alex);
    const sams = await member(sam);
    const garden = spaceCreate({ name: "Garden", kind: SpaceKind.SHARED });
    await sams.device.push(garden);
    await work();
    const dinner = await addIn(alexs.device, idOf(garden), "Dinner");

    await calendars(sams.token).disconnect();
    moveInGoogle("Dinner", [samsAccount, "Garden"], [alexsAccount, "Personal"]);
    await readAgain();

    expect((await eventsOf(alexs.device)).get(dinner)?.spaceId).toBe(
      (await spaceNamed(alexs.device, "Personal")).id,
    );
  });
});

describe("conflicts with Google", () => {
  it("keeps a change made in Foyer after the one made in Google, and takes Google's other changes", async () => {
    const { device } = await member(alex);
    const dinner = await addInPersonal(device, "Dinner");
    const calendarId = calendarOf(alexsAccount, "Personal");
    const eventId = fakeGoogle.eventsOf(calendarId)[0]?.id ?? "";

    fakeGoogle.changeEvent(calendarId, eventId, {
      summary: "Dinner at home",
      description: "Bring wine",
    });
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 1000 });
    await device.push(itemSetTitle(dinner, "Dinner with Sam"));
    await work();

    expect(fakeGoogle.eventsOf(calendarId)[0]).toMatchObject({
      summary: "Dinner with Sam",
      description: "Bring wine",
    });
    expect((await eventsOf(device)).get(dinner)).toMatchObject({
      title: "Dinner with Sam",
      description: "Bring wine",
    });
  });

  it("takes a change made in Google after the one made in Foyer", async () => {
    const { device } = await member(alex);
    const dinner = await addInPersonal(device, "Dinner");
    const calendarId = calendarOf(alexsAccount, "Personal");
    const eventId = fakeGoogle.eventsOf(calendarId)[0]?.id ?? "";
    const madeOffline = madeAt(Date.now());
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 1000 });

    fakeGoogle.changeEvent(calendarId, eventId, { summary: "Dinner at home" });
    await device.push(
      itemSetTitle(dinner, "Dinner with Sam", { at: madeOffline }),
      itemSetDescription(dinner, "Bring wine", { at: madeOffline }),
    );
    await work();

    expect(fakeGoogle.eventsOf(calendarId)[0]).toMatchObject({
      summary: "Dinner at home",
      description: "Bring wine",
    });
    expect((await eventsOf(device)).get(dinner)).toMatchObject({
      title: "Dinner at home",
      description: "Bring wine",
    });
  });

  it("writes Foyer's version when a change read from Google lost to one made in Foyer", async () => {
    const { device } = await member(alex);
    const dinner = await addInPersonal(device, "Dinner");
    const calendarId = calendarOf(alexsAccount, "Personal");
    const eventId = fakeGoogle.eventsOf(calendarId)[0]?.id ?? "";
    const google = fakeGoogle.calendars.get(calendarId)?.events.get(eventId);

    fakeGoogle.changeEvent(calendarId, eventId, { summary: "Dinner at home" });
    if (google) google.updated = new Date(Date.now() - 60 * minute).toISOString();
    await readAgain();
    await work();

    expect((await eventsOf(device)).get(dinner)?.title).toBe("Dinner");
    expect(fakeGoogle.eventsOf(calendarId)[0]?.summary).toBe("Dinner");
  });

  it("takes Google's version back when Google refuses a change", async () => {
    const { device } = await member(alex);
    const dinner = await addInPersonal(device, "Dinner");
    vi.spyOn(console, "error").mockImplementation(() => {});

    fakeGoogle.refusingEvents = true;
    await device.push(itemSetTitle(dinner, "Dinner with Sam"));
    await work();

    expect((await eventsOf(device)).get(dinner)?.title).toBe("Dinner");
    expect(googleEvents(alexsAccount, "Personal")[0]?.summary).toBe("Dinner");
  });

  it("deletes an event in Foyer when Google refuses to make it", async () => {
    const { device } = await member(alex);
    vi.spyOn(console, "error").mockImplementation(() => {});

    fakeGoogle.refusingEvents = true;
    const dinner = await addInPersonal(device, "Dinner");

    expect((await eventsOf(device)).has(dinner)).toBe(false);
    expect(googleEvents(alexsAccount, "Personal")).toEqual([]);
  });

  it("deletes an event in Foyer when it was deleted in Google before Foyer's change reached it", async () => {
    const { device } = await member(alex);
    const dinner = await addInPersonal(device, "Dinner");
    const calendarId = calendarOf(alexsAccount, "Personal");

    fakeGoogle.removeEvent(calendarId, fakeGoogle.eventsOf(calendarId)[0]?.id ?? "");
    await device.push(itemSetTitle(dinner, "Dinner with Sam"));
    await work();

    expect((await eventsOf(device)).has(dinner)).toBe(false);
  });
});

describe("a calendar deleted in Google", () => {
  it("is made again in the same account, with the space's events", async () => {
    const { device } = await member(alex);
    await addInPersonal(device, "Dinner");
    await addInPersonal(device, "Holiday", { startsOn: "2026-12-24", endsOn: "2026-12-26" });
    const deleted = calendarOf(alexsAccount, "Personal");
    vi.spyOn(console, "error").mockImplementation(() => {});

    fakeGoogle.calendars.delete(deleted);
    await readAgain();
    await work();

    const remade = calendarOf(alexsAccount, "Personal");
    expect(remade).not.toBe(deleted);
    expect(
      fakeGoogle
        .eventsOf(remade)
        .map(({ summary }) => summary)
        .sort(),
    ).toEqual(["Dinner", "Holiday"]);
    expect([...(await eventsOf(device)).values()].map(({ title }) => title).sort()).toEqual([
      "Dinner",
      "Holiday",
    ]);
    expect((await spaceNamed(device, "Personal")).calendarState).toBe(CalendarState.SYNCING);
  });

  it("is noticed when an event is written to it", async () => {
    const { device } = await member(alex);
    const dinner = await addInPersonal(device, "Dinner");
    const deleted = calendarOf(alexsAccount, "Personal");
    vi.spyOn(console, "error").mockImplementation(() => {});

    fakeGoogle.calendars.delete(deleted);
    await device.push(itemSetTitle(dinner, "Dinner with Sam"));
    await work();
    await work();

    expect(fakeGoogle.eventsOf(calendarOf(alexsAccount, "Personal"))).toEqual([
      expect.objectContaining({ summary: "Dinner with Sam" }),
    ]);
  });
});

describe("a backlog of work for Google", () => {
  const laterThanTheRealClock = Date.parse("2036-11-15T12:00:00Z");
  const calendarNames = ["Personal", "Garden", "Kitchen", "Car", "School"];

  async function memberWithFiveCalendars(): Promise<Member> {
    vi.useFakeTimers({ toFake: ["Date"], now: laterThanTheRealClock });
    const alexs = await member(alex);
    vi.setSystemTime(Date.now() + 1000);
    await alexs.device.push(...calendarNames.slice(1).map((name) => spaceCreate({ name })));
    await work();
    return alexs;
  }

  async function pushEvents(
    device: Device,
    count: number,
  ): Promise<{ id: string; title: string }[]> {
    const personal = await spaceNamed(device, "Personal");
    const titles = Array.from({ length: count }, (_, each) => `Event ${each}`);
    const creates = titles.map((title) => eventCreate(personal.id, title));
    await device.push(...creates);
    return creates.map((create, each) => ({ id: idOf(create), title: titles[each] ?? "" }));
  }

  function addOneInEachCalendar(): void {
    for (const name of calendarNames) {
      addInGoogle(alexsAccount, name, { summary: `Added in ${name}` });
    }
  }

  function writtenToPersonal(): Set<string> {
    const summaries = googleEvents(alexsAccount, "Personal").map(({ summary }) => summary ?? "");
    return new Set(summaries.filter((summary) => summary.startsWith("Event ")));
  }

  async function readIntoFoyer(device: Device): Promise<string[]> {
    const titles = [...(await eventsOf(device)).values()].map(({ title }) => title);
    return titles.filter((title) => title.startsWith("Added in "));
  }

  function countCallsToGoogle(): () => number {
    let count = 0;
    const answer = fakeGoogle.answer.bind(fakeGoogle);
    vi.spyOn(fakeGoogle, "answer").mockImplementation((request) => {
      count += 1;
      return answer(request);
    });
    return () => count;
  }

  async function alarm(): Promise<number | null> {
    return runInDurableObject(theHousehold(), (_, state) => state.storage.getAlarm());
  }

  it("makes at most the calls one run may, writing the changes waiting longest first", async () => {
    const { device } = await memberWithFiveCalendars();
    const titles = (await pushEvents(device, callsPerRun + 5)).map(({ title }) => title);
    addOneInEachCalendar();
    vi.setSystemTime(Date.now() + minute);
    const calls = countCallsToGoogle();

    await work();
    const firstRunAt = Date.now();
    const inFirstRun = calls();
    const writtenInFirstRun = writtenToPersonal();
    await vi.waitFor(async () => expect(await alarm()).toBe(firstRunAt));
    await work();
    const inSecondRun = calls() - inFirstRun;
    await work();
    const inThirdRun = calls() - inFirstRun - inSecondRun;

    expect(inFirstRun).toBe(callsPerRun);
    expect(inSecondRun).toBeLessThanOrEqual(callsPerRun);
    expect(inThirdRun).toBe(0);
    expect(writtenInFirstRun).toEqual(new Set(titles.slice(0, callsPerRun)));
    expect(writtenToPersonal()).toEqual(new Set(titles));
    expect((await readIntoFoyer(device)).sort()).toEqual(
      calendarNames.map((name) => `Added in ${name}`).sort(),
    );
  });

  it("removes from Google the events deleted in Foyer within the same calls, oldest first", async () => {
    const { device } = await memberWithFiveCalendars();
    const events = await pushEvents(device, callsPerRun + 5);
    await work();
    await work();
    await device.push(...events.map(({ id }) => itemDelete(id)));
    const calls = countCallsToGoogle();

    await work();
    const inFirstRun = calls();
    const leftAfterFirstRun = writtenToPersonal();
    await work();

    expect(inFirstRun).toBe(callsPerRun);
    expect(leftAfterFirstRun).toEqual(new Set(events.slice(callsPerRun).map(({ title }) => title)));
    expect(writtenToPersonal()).toEqual(new Set());
  });

  it("reads in the next run the calendars a run didn't reach, those read longest ago first", async () => {
    const { token, device } = await memberWithFiveCalendars();
    await pushEvents(device, callsPerRun - 1);
    addOneInEachCalendar();
    const another = await Device.connect(token);
    devices.push(another);
    await another.welcome();
    const calls = countCallsToGoogle();

    await work();
    const inFirstRun = calls();
    const readInFirstRun = await readIntoFoyer(device);
    await work();
    const inSecondRun = calls() - inFirstRun;

    expect(inFirstRun).toBe(callsPerRun);
    expect(inSecondRun).toBeLessThanOrEqual(callsPerRun);
    expect(readInFirstRun).toEqual(["Added in Personal"]);
    expect((await readIntoFoyer(device)).sort()).toEqual(
      calendarNames.map((name) => `Added in ${name}`).sort(),
    );
  });
});

describe("the fake Google Calendar, locally", () => {
  const page = `${localBackendUrl}/auth/dev/google/calendar`;
  const post = (fields: Record<string, string>) =>
    requestBackend(page, { method: "POST", body: new URLSearchParams(fields) });

  it("adds, renames and deletes events as if in Google Calendar, and lists them", async () => {
    const { device } = await member(alex);
    const calendar = calendarOf(alexsAccount, "Personal");

    const added = await post({
      action: "add-event",
      calendar,
      title: "Dentist",
      starts: "2026-11-20T19:00:00Z",
      ends: "2026-11-20T20:00:00Z",
    });
    await post({
      action: "add-event",
      calendar,
      title: "Holiday",
      starts: "2026-12-24",
      ends: "2026-12-27",
    });
    await readAgain();
    const listed = await (await requestBackend(page)).text();
    const dentist = fakeGoogle.eventsOf(calendar).find(({ summary }) => summary === "Dentist");
    await post({ action: "change-title", calendar, event: dentist?.id ?? "", title: "Doctor" });
    const holiday = fakeGoogle.eventsOf(calendar).find(({ summary }) => summary === "Holiday");
    await post({ action: "delete-event", calendar, event: holiday?.id ?? "" });
    await readAgain();

    expect(added.status).toBe(303);
    expect(listed).toContain("Foyer · Personal (dev:member@example.com)");
    expect(listed).toContain("Dentist");
    expect([...(await eventsOf(device)).values()].map(({ title }) => title)).toEqual(["Doctor"]);
  });

  it("deletes a calendar and drops its sync tokens", async () => {
    await member(alex);
    const calendar = calendarOf(alexsAccount, "Personal");

    await post({ action: "drop-sync-tokens", calendar });
    const dropped = fakeGoogle.calendars.get(calendar)?.droppedBefore;
    await post({ action: "delete-calendar", calendar });

    expect(dropped).toBeGreaterThan(0);
    expect(fakeGoogle.calendars.has(calendar)).toBe(false);
  });

  it("isn't there on a deployed backend", async () => {
    const response = await requestBackend(`${backendUrl}/auth/dev/google/calendar`);

    expect(response.status).toBe(404);
  });
});

describe("what devices receive", () => {
  it("never holds Google's event ids, etags or sync tokens", async () => {
    const alexs = await member(alex);
    const sams = await member(sam);
    await addInPersonal(alexs.device, "Dinner");
    addInGoogle(alexsAccount, "Personal", { summary: "Dentist" });
    await readAgain();

    const rows = [...(await received(alexs.device)), ...(await received(sams.device))];
    const text = rows.map((row) => new TextDecoder().decode(toBinary(RowSchema, row))).join("\n");
    const calendarId = calendarOf(alexsAccount, "Personal");
    const secrets = fakeGoogle
      .eventsOf(calendarId)
      .flatMap(({ id, etag }) => [id, etag])
      .concat(calendarId, "fake-sync");

    expect(rows.filter(({ row }) => row.case === "item")).toHaveLength(2);
    for (const secret of secrets) expect(text).not.toContain(secret);
  });
});

describe("storage from before events", () => {
  it("keeps every task with its stickers and completions, and each calendar's time zone", async () => {
    const ids = { member: newId(), space: newId(), task: newId(), sticker: newId(), done: newId() };
    const pageId = `space:${ids.space}:1`;
    await runInDurableObject(theHousehold(), async (_, { storage }) => {
      await storage.deleteAll();
      const events = householdMigrations.findIndex(
        (migration) => typeof migration === "string" && migration.includes("TABLE google_events"),
      );
      migrate(storage, householdMigrations.slice(0, events));
      const { sql } = storage;
      const now = Date.now();
      sql.exec("UPDATE household SET seq = 5");
      sql.exec(
        `INSERT INTO members (id, email, google_subject, name, joined_at, seq)
         VALUES (?, ?, 'dev', 'Alex', ?, 1)`,
        ids.member,
        alex,
        now,
      );
      sql.exec(
        `INSERT INTO spaces (id, kind, owner_id, name, created_by, created_at, seq)
         VALUES (?, 'shared', NULL, 'Home', ?, ?, 2)`,
        ids.space,
        ids.member,
        now,
      );
      sql.exec(
        `INSERT INTO pages (id, kind, space_id, number, width, height, created_by, created_at, seq)
         VALUES (?, 'space', ?, 1, 595, 842, ?, ?, 3)`,
        pageId,
        ids.space,
        ids.member,
        now,
      );
      sql.exec(
        `INSERT INTO items (id, kind, space_id, title, description, date, created_by, created_at,
           seq, space_at, space_change_id, title_at, title_change_id, description_at,
           description_change_id, date_at, date_change_id)
         VALUES (?, 'task', ?, 'Buy milk', '', NULL, ?, ?, 4, 0, '', 0, '', 0, '', 0, '')`,
        ids.task,
        ids.space,
        ids.member,
        now,
      );
      sql.exec(
        `INSERT INTO stickers (id, page_id, x, y, kind, item_id, placed_at, placed_change_id,
           placed_by, seq)
         VALUES (?, ?, 36, 36, 'task', ?, ?, '', ?, 4)`,
        ids.sticker,
        pageId,
        ids.task,
        now,
        ids.member,
      );
      sql.exec(
        `INSERT INTO completions (id, item_id, occurrence, done_at, done_by, seq)
         VALUES (?, ?, '', ?, ?, 5)`,
        ids.done,
        ids.task,
        now,
        ids.member,
      );
      sql.exec(
        `INSERT INTO google_connections (member_id, refresh_token, scope, state, time_zone,
           connected_at, seq)
         VALUES (?, 'token', '', 'connected', 'America/Santo_Domingo', ?, 5)`,
        ids.member,
        now,
      );
      sql.exec(
        `INSERT INTO space_calendars (space_id, member_id, google_calendar_id, name_in_google,
           created_at)
         VALUES (?, ?, 'calendar', 'Foyer · Home', ?)`,
        ids.space,
        ids.member,
        now,
      );
      migrate(storage, householdMigrations);
    });
    const device = await Device.connect(await theHousehold().startSession(ids.member));
    devices.push(device);
    await device.welcome();

    await device.push(
      eventCreate(ids.space, "Late film", {
        startsAt: "2026-11-21T03:30:00Z",
        endsAt: "2026-11-21T05:30:00Z",
      }),
    );
    const rows = await received(device);

    expect((await eventTitled(device, "Late film"))?.date).toBe("2026-11-20");
    expect(
      rows.map(({ row }) => [row.case, row.value && "id" in row.value ? row.value.id : ""]),
    ).toEqual(
      expect.arrayContaining([
        ["item", ids.task],
        ["sticker", ids.sticker],
        ["completion", ids.done],
      ]),
    );
  });
});

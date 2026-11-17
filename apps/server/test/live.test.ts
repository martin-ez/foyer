import {
  evictDurableObject,
  reset,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { itemPageId, liveLimitLiftsAt } from "@foyer/shared";
import { SpaceKind } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import type { Here, Pointed } from "@foyer/shared/gen/foyer/sync/v1/live_pb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { theHousehold } from "../src/household";
import { dailyPointLimit, silenceLimit, unsavedPointLimit } from "../src/live";
import { Device, idOf, itemCreate, signIn, spaceCreate } from "./sync-device";

const alex = "member@example.com";
const sam = "housemate@example.com";

const today = "day:2026-11-17";
const tomorrow = "day:2026-11-18";

const devices: Device[] = [];

type Connected = Device & { memberId: string; token: string };

async function connect(email: string): Promise<Connected> {
  const { memberId, token } = await signIn(email);
  const device = await Device.connect(token);
  devices.push(device);
  await device.welcome();
  return Object.assign(device, { memberId, token });
}

async function sharedSpacePage(device: Device): Promise<string> {
  const space = spaceCreate({ name: "Home", kind: SpaceKind.SHARED });
  await device.push(space);
  const spaceId = space.change?.case === "spaceCreate" ? space.change.value.spaceId : "";
  return `space:${spaceId}:1`;
}

async function bodyPageOfTask(device: Device, kind: "shared" | "inbox"): Promise<string> {
  const spaceId =
    kind === "shared"
      ? (await sharedSpacePage(device)).split(":")[1]
      : (await device.catchUp())
          .flatMap(({ rows }) => rows)
          .flatMap(({ row }) => (row.case === "space" ? [row.value] : []))
          .find((space) => space.kind === SpaceKind.INBOX)?.id;
  const task = itemCreate({ spaceId: spaceId ?? "" });
  await device.push(task);
  return itemPageId(idOf(task));
}

async function onPage<Emails extends string[]>(
  pageId: string,
  ...emails: Emails
): Promise<{ [Each in keyof Emails]: Connected }> {
  const connected: Connected[] = [];
  for (const email of emails) {
    const device = await connect(email);
    device.enter(pageId);
    connected.push(device);
    for (const each of connected) await each.next("here");
  }
  return connected as { [Each in keyof Emails]: Connected };
}

function describeHere({ pageId, members }: Here) {
  return {
    pageId,
    members: members.map(({ memberId, position }) =>
      position ? { memberId, x: position.x, y: position.y } : { memberId },
    ),
  };
}

function describePointed({ memberId, x, y }: Pointed) {
  return { memberId, x, y };
}

function fakeClock(now = Date.now()) {
  vi.useFakeTimers({ toFake: ["Date"], now });
}

function storeTodaysPoints(points: number) {
  return runInDurableObject(theHousehold(), (_, { storage }) => {
    const day = new Date().toISOString().slice(0, 10);
    storage.sql.exec("INSERT INTO live_points (day, points) VALUES (?, ?)", day, points);
  });
}

afterEach(async () => {
  for (const device of devices.splice(0)) device.close();
  vi.useRealTimers();
  await reset();
});

describe("who is on a page", () => {
  it("tells a device that enters a page alone that nobody else is there", async () => {
    const device = await connect(alex);

    device.enter(today);

    expect(describeHere(await device.next("here"))).toEqual({ pageId: today, members: [] });
  });

  it("tells every device on the page who else is there when someone enters", async () => {
    const [alexs] = await onPage(today, alex);
    const sams = await connect(sam);

    sams.enter(today);

    expect(describeHere(await alexs.next("here"))).toEqual({
      pageId: today,
      members: [{ memberId: sams.memberId }],
    });
    expect(describeHere(await sams.next("here"))).toEqual({
      pageId: today,
      members: [{ memberId: alexs.memberId }],
    });
  });

  it("tells nobody about devices on other pages", async () => {
    const [alexs] = await onPage(today, alex);
    const sams = await connect(sam);

    sams.enter(tomorrow);

    expect(describeHere(await sams.next("here"))).toEqual({ pageId: tomorrow, members: [] });
    expect(await alexs.all("here")).toEqual([]);
  });

  it("lists a member on two devices once, and never the device's own member", async () => {
    const [alexs, samsPhone, samsTablet] = await onPage(today, alex, sam, sam);
    const alexsLaptop = await connect(alex);

    alexsLaptop.enter(today);

    for (const device of [alexs, alexsLaptop]) {
      expect(describeHere(await device.next("here")).members).toEqual([
        { memberId: samsPhone.memberId },
      ]);
    }
    for (const device of [samsPhone, samsTablet]) {
      expect(describeHere(await device.next("here")).members).toEqual([
        { memberId: alexs.memberId },
      ]);
    }
  });

  it("tells the others when someone leaves the page", async () => {
    const [alexs, sams] = await onPage(today, alex, sam);

    sams.leave();

    expect(describeHere(await alexs.next("here"))).toEqual({ pageId: today, members: [] });
    expect(await sams.all("here")).toEqual([]);
  });

  it("tells the others when someone moves to another page", async () => {
    const [alexs, sams] = await onPage(today, alex, sam);

    sams.enter(tomorrow);

    expect(describeHere(await alexs.next("here"))).toEqual({ pageId: today, members: [] });
    expect(describeHere(await sams.next("here"))).toEqual({ pageId: tomorrow, members: [] });
  });

  it("tells the others when someone's session ends", async () => {
    const [alexs, sams] = await onPage(today, alex, sam);

    await theHousehold().endSession(sams.token);

    expect(describeHere(await alexs.next("here"))).toEqual({ pageId: today, members: [] });
  });

  it("tells the others when someone sends something that isn't a sync message", async () => {
    const [alexs, sams] = await onPage(today, alex, sam);

    sams.sendBytes(new Uint8Array([0xff, 0xff, 0xff]));

    expect(describeHere(await alexs.next("here"))).toEqual({ pageId: today, members: [] });
  });

  it("tells the others when someone's connection closes", async () => {
    const [alexs, sams] = await onPage(today, alex, sam);

    sams.close();

    expect(describeHere(await alexs.next("here"))).toEqual({ pageId: today, members: [] });
  });

  it("keeps who is on which page while the household sleeps", async () => {
    const [alexs, sams] = await onPage(today, alex, sam);

    await evictDurableObject(theHousehold());
    sams.point(10, 20);

    expect(describePointed(await alexs.next("pointed"))).toEqual({
      memberId: sams.memberId,
      x: 10,
      y: 20,
    });
  });
});

describe("who can be seen on a page", () => {
  it("shows members on the household's month and week pages to each other", async () => {
    for (const page of ["month:2026-11", "week:2026-11-16"]) {
      const [alexs] = await onPage(page, alex);
      const sams = await connect(sam);

      sams.enter(page);

      expect(describeHere(await sams.next("here")).members).toEqual([{ memberId: alexs.memberId }]);
    }
  });

  it("shows members on a shared space's page to each other", async () => {
    const alexs = await connect(alex);
    const page = await sharedSpacePage(alexs);
    alexs.enter(page);
    await alexs.next("here");
    const sams = await connect(sam);

    sams.enter(page);

    expect(describeHere(await sams.next("here")).members).toEqual([{ memberId: alexs.memberId }]);
  });

  it("shows members on the body page of a task they see to each other, before anything is on it", async () => {
    const alexs = await connect(alex);
    const page = await bodyPageOfTask(alexs, "shared");
    alexs.enter(page);
    await alexs.next("here");
    const sams = await connect(sam);

    sams.enter(page);

    expect(describeHere(await sams.next("here")).members).toEqual([{ memberId: alexs.memberId }]);
  });

  it("puts nobody on the body page of a task their member can't see", async () => {
    const alexs = await connect(alex);
    const page = await bodyPageOfTask(alexs, "inbox");
    alexs.enter(page);
    await alexs.next("here");
    const sams = await connect(sam);

    sams.enter(page);

    expect(await sams.all("here")).toEqual([]);
    expect(await alexs.all("here")).toEqual([]);
  });

  it("puts nobody on a page their member can't see, and tells nobody", async () => {
    const alexs = await connect(alex);
    const inbox = (await alexs.catchUp())
      .flatMap(({ rows }) => rows)
      .flatMap(({ row }) => (row.case === "space" ? [row.value] : []))
      .find(({ kind }) => kind === SpaceKind.INBOX);
    const page = `space:${inbox?.id}:1`;
    alexs.enter(page);
    await alexs.next("here");
    const sams = await connect(sam);

    sams.enter(page);
    sams.point(10, 20);

    expect(await sams.all("here")).toEqual([]);
    expect(await alexs.all("here")).toEqual([]);
    expect(await alexs.all("pointed")).toEqual([]);
  });

  it("puts nobody on a page that can't exist", async () => {
    const [alexs] = await onPage(today, alex);
    const sams = await connect(sam);

    for (const page of [
      "day:2026-02-30",
      "space:not-a-space:1",
      "item:not-an-item",
      "notebook",
      "",
    ]) {
      sams.enter(page);
    }

    expect(await sams.all("here")).toEqual([]);
    expect(await alexs.all("here")).toEqual([]);
  });

  it("puts nobody on a space's page that isn't numbered from 1", async () => {
    const alexs = await connect(alex);
    const page = await sharedSpacePage(alexs);
    alexs.enter(page);
    await alexs.next("here");
    const sams = await connect(sam);

    for (const number of ["0", "01", "1.5", "-1", ""]) sams.enter(page.replace(/1$/, number));

    expect(await sams.all("here")).toEqual([]);
    expect(await alexs.all("here")).toEqual([]);
  });

  it("takes someone off their page when they enter one they can't see", async () => {
    const [alexs, sams] = await onPage(today, alex, sam);

    sams.enter("day:not-a-date");

    expect(describeHere(await alexs.next("here")).members).toEqual([]);
  });
});

describe("where people point", () => {
  it("passes a position on to the other members on the page, and never back", async () => {
    const [alexs, samsPhone, samsTablet] = await onPage(today, alex, sam, sam);

    samsPhone.point(10.5, 20.25);

    expect(describePointed(await alexs.next("pointed"))).toEqual({
      memberId: samsPhone.memberId,
      x: 10.5,
      y: 20.25,
    });
    expect(await samsPhone.all("pointed")).toEqual([]);
    expect(await samsTablet.all("pointed")).toEqual([]);
  });

  it("tells someone who enters where the others last pointed, from their latest device", async () => {
    fakeClock();
    const [, samsPhone, samsTablet] = await onPage(today, alex, sam, sam);
    const alexsLaptop = await connect(alex);
    const pointThenEnter = async (device: Device, x: number, y: number) => {
      vi.advanceTimersByTime(1000);
      device.point(x, y);
      await device.settle();
      alexsLaptop.enter(today);
      return describeHere(await alexsLaptop.next("here")).members;
    };

    samsPhone.point(1, 2);
    await samsPhone.settle();
    expect(await pointThenEnter(samsTablet, 3, 4)).toEqual([
      { memberId: samsTablet.memberId, x: 3, y: 4 },
    ]);
    expect(await pointThenEnter(samsPhone, 5, 6)).toEqual([
      { memberId: samsPhone.memberId, x: 5, y: 6 },
    ]);
  });

  it("forgets where someone pointed once they enter another page", async () => {
    const [alexs, sams] = await onPage(today, alex, sam);
    sams.point(1, 2);
    sams.enter(tomorrow);
    sams.enter(today);
    await sams.settle();
    await alexs.all("here");
    const alexsLaptop = await connect(alex);

    alexsLaptop.enter(today);

    expect(describeHere(await alexsLaptop.next("here")).members).toEqual([
      { memberId: sams.memberId },
    ]);
  });

  it("passes nothing on from a device on no page", async () => {
    const [alexs] = await onPage(today, alex);
    const sams = await connect(sam);

    sams.point(1, 2);
    await sams.settle();

    expect(await alexs.all("pointed")).toEqual([]);
  });

  it("passes on 4 positions a second, and drops the ones sent faster", async () => {
    fakeClock();
    const [alexs, sams] = await onPage(today, alex, sam);

    for (let x = 1; x <= 10; x++) sams.point(x, 0);
    await sams.settle();
    expect((await alexs.all("pointed")).map(({ x }) => x)).toEqual([1, 2, 3, 4]);

    vi.advanceTimersByTime(250);
    sams.point(11, 0);
    sams.point(12, 0);
    await sams.settle();
    expect((await alexs.all("pointed")).map(({ x }) => x)).toEqual([11]);

    vi.advanceTimersByTime(1000);
    for (let x = 13; x <= 18; x++) {
      sams.point(x, 0);
      await sams.settle();
      vi.advanceTimersByTime(250);
    }
    expect((await alexs.all("pointed")).map(({ x }) => x)).toEqual([13, 14, 15, 16, 17, 18]);
  });
});

describe("devices the household doesn't hear from", () => {
  it("takes a device off its page after a minute of silence, and closes its connection", async () => {
    fakeClock();
    const [alexs, sams] = await onPage(today, alex, sam);

    vi.advanceTimersByTime(silenceLimit);
    alexs.point(1, 2);
    await alexs.settle();
    expect(await runDurableObjectAlarm(theHousehold())).toBe(true);

    expect(describeHere(await alexs.next("here")).members).toEqual([]);
    expect((await sams.closed).code).toBe(1000);
  });

  it("keeps a device that says it's still there on its page", async () => {
    fakeClock();
    const [alexs, sams] = await onPage(today, alex, sam);

    vi.advanceTimersByTime(silenceLimit / 2);
    await runDurableObjectAlarm(theHousehold());
    alexs.point(1, 2);
    sams.point(3, 4);
    await alexs.settle();
    await sams.settle();
    vi.advanceTimersByTime(silenceLimit / 2);
    await runDurableObjectAlarm(theHousehold());

    expect(await alexs.all("here")).toEqual([]);
    expect(await sams.all("here")).toEqual([]);
  });

  it("leaves out a silent device when someone enters its page", async () => {
    fakeClock();
    const [sams] = await onPage(today, sam);

    vi.advanceTimersByTime(silenceLimit);
    const alexs = await connect(alex);
    alexs.enter(today);

    expect(describeHere(await alexs.next("here")).members).toEqual([]);
    expect(await sams.all("here")).toEqual([]);
  });
});

describe("the daily limit for positions", () => {
  it("tells every device to stop sending positions once the day's limit is reached", async () => {
    fakeClock();
    await storeTodaysPoints(dailyPointLimit - 1);
    const [alexs, sams] = await onPage(today, alex, sam);
    const elsewhere = await connect(alex);

    sams.point(1, 2);

    expect(describePointed(await alexs.next("pointed"))).toMatchObject({ x: 1, y: 2 });
    for (const device of [alexs, sams, elsewhere]) await device.next("liveLimit");
  });

  it("passes on no more positions that day, and tells a device that still sends them", async () => {
    fakeClock();
    await storeTodaysPoints(dailyPointLimit);
    const [alexs, sams] = await onPage(today, alex, sam);
    await alexs.all("liveLimit");
    await sams.all("liveLimit");

    vi.advanceTimersByTime(1000);
    sams.point(1, 2);

    expect(await sams.all("liveLimit")).toHaveLength(1);
    expect(await alexs.all("pointed")).toEqual([]);
  });

  it("tells a device that enters a page while the limit is reached, and leaves out positions", async () => {
    fakeClock();
    await storeTodaysPoints(dailyPointLimit - 1);
    const [sams] = await onPage(today, sam);
    sams.point(1, 2);
    await sams.all("liveLimit");
    const alexs = await connect(alex);

    alexs.enter(today);

    expect(describeHere(await alexs.next("here")).members).toEqual([{ memberId: sams.memberId }]);
    await alexs.next("liveLimit");
  });

  it("passes positions on again the next day, by UTC", async () => {
    const midnight = liveLimitLiftsAt(Date.now());
    fakeClock(midnight - 10_000);
    await storeTodaysPoints(dailyPointLimit);
    const [alexs, sams] = await onPage(today, alex, sam);
    await sams.all("liveLimit");

    vi.setSystemTime(midnight + 1000);
    sams.point(1, 2);

    expect(describePointed(await alexs.next("pointed"))).toMatchObject({ x: 1, y: 2 });
    expect(await sams.all("liveLimit")).toEqual([]);
  });

  it("counts the positions of connections that closed, while the household sleeps", async () => {
    fakeClock();
    await storeTodaysPoints(dailyPointLimit - 3);
    const [alexs, sams] = await onPage(today, alex, sam);
    sams.point(1, 2);
    await sams.settle();
    vi.advanceTimersByTime(1000);
    sams.point(3, 4);
    await sams.settle();
    sams.close();
    await alexs.next("here");

    await evictDurableObject(theHousehold());
    const samsTablet = await connect(sam);
    samsTablet.enter(today);
    await samsTablet.next("here");
    samsTablet.point(5, 6);

    await alexs.next("liveLimit");
  });

  it("stores the day's count as positions come in, without waiting for the connection to close", async () => {
    fakeClock();
    await storeTodaysPoints(dailyPointLimit - unsavedPointLimit - 1);
    const [sams] = await onPage(today, sam);
    for (let point = 0; point < unsavedPointLimit; point++) {
      sams.point(point, 0);
      await sams.settle();
      vi.advanceTimersByTime(250);
    }

    await evictDurableObject(theHousehold(), { webSockets: "close" });
    const [alexsLaptop, samsTablet] = await onPage(today, alex, sam);
    samsTablet.point(1, 2);

    await alexsLaptop.next("liveLimit");
  });
});

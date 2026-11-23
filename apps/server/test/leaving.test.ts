import { reset, runInDurableObject } from "cloudflare:test";
import { env, withEnv } from "cloudflare:workers";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import { a4Portrait, itemPageId, signedOutCloseCode } from "@foyer/shared";
import {
  type GoogleConnection,
  GoogleConnectionState,
} from "@foyer/shared/gen/foyer/calendar/v1/calendar_pb";
import { type Item, ItemKind } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import { PageKind } from "@foyer/shared/gen/foyer/page/v1/page_pb";
import { CalendarState, type Space, SpaceKind } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import { type Sticker, StickerKind } from "@foyer/shared/gen/foyer/sticker/v1/sticker_pb";
import { type Row, RowKind } from "@foyer/shared/gen/foyer/sync/v1/sync_pb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeGoogle } from "../src/fake-google";
import { theHousehold } from "../src/household";
import { backendUrl, localBackendUrl, requestBackend } from "./backend";
import { connectGoogle, work } from "./calendar-helpers";
import {
  type ChangeInit,
  Device,
  idOf,
  itemCreate,
  itemSetParent,
  pageCreate,
  signIn,
  spaceCreate,
  spaceSetArchived,
  stickerPlace,
} from "./sync-device";

const alex = "member@example.com";
const sam = "housemate@example.com";
const robin = "flatmate@example.com";
const alexsAccount = `dev:${alex}`;
const samsAccount = `dev:${sam}`;
const robinsAccount = `dev:${robin}`;

const devices: Device[] = [];

afterEach(async () => {
  for (const device of devices.splice(0)) device.close();
  vi.restoreAllMocks();
  vi.useRealTimers();
  fakeGoogle.reset();
  await reset();
});

type Member = { memberId: string; token: string; device: Device };

async function member(email: string): Promise<Member> {
  const { memberId, token } = await signIn(email);
  const device = await Device.connect(token);
  devices.push(device);
  await device.welcome();
  return { memberId, token, device };
}

async function connected(email: string, timeZone = "Europe/Madrid"): Promise<Member> {
  const joined = await member(email);
  await connectGoogle(joined.token, { timeZone });
  await work();
  return joined;
}

function allowlistWithout(email: string): string {
  return JSON.stringify([alex, sam, robin].filter((each) => each !== email));
}

async function workWithout(email: string): Promise<void> {
  await runInDurableObject(theHousehold(), (household) =>
    withEnv({ ...env, HOUSEHOLD_MEMBERS: allowlistWithout(email) }, () => household.alarm()),
  );
}

async function alarm(): Promise<number | null> {
  return runInDurableObject(theHousehold(), (_, state) => state.storage.getAlarm());
}

async function seenBy(device: Device) {
  const spaces = new Map<string, Space>();
  const items = new Map<string, Item>();
  const stickers = new Map<string, Sticker>();
  let connection: GoogleConnection | null | undefined;
  for (const { row } of (await device.catchUp()).flatMap(({ rows }): Row[] => rows)) {
    if (row.case === "space") spaces.set(row.value.id, row.value);
    if (row.case === "item") items.set(row.value.id, row.value);
    if (row.case === "sticker") stickers.set(row.value.id, row.value);
    if (row.case === "googleConnection") connection = row.value;
    if (row.case !== "deleted") continue;
    if (row.value.kind === RowKind.ITEM) items.delete(row.value.id);
    if (row.value.kind === RowKind.STICKER) stickers.delete(row.value.id);
    if (row.value.kind === RowKind.GOOGLE_CONNECTION) connection = null;
  }
  const spaceNamed = (name: string) => [...spaces.values()].find((space) => space.name === name);
  return { spaces, items, stickers, connection, spaceNamed };
}

async function createShared(device: Device, name: string): Promise<string> {
  const create = spaceCreate({ name, kind: SpaceKind.SHARED });
  await device.push(create);
  await work();
  return idOf(create);
}

function eventCreate(spaceId: string, title: string, startsAt = "2026-11-20T19:00:00Z") {
  const start = Date.parse(startsAt);
  return itemCreate({
    spaceId,
    title,
    kind: ItemKind.EVENT,
    startsAt: timestampFromMs(start),
    endsAt: timestampFromMs(start + 60 * 60_000),
  });
}

async function addEvent(device: Device, spaceId: string, title: string, startsAt?: string) {
  const create = eventCreate(spaceId, title, startsAt);
  await device.push(create);
  await work();
  return idOf(create);
}

function bodyPage(itemId: string): ChangeInit {
  return pageCreate({ pageId: itemPageId(itemId), kind: PageKind.ITEM, itemId, ...a4Portrait });
}

function calendarOf(account: string, spaceName: string): string | undefined {
  for (const [id, calendar] of fakeGoogle.calendars) {
    if (calendar.subject === account && calendar.name === `Foyer · ${spaceName}`) return id;
  }
  return undefined;
}

function titlesInGoogle(account: string, spaceName: string): string[] {
  const calendar = calendarOf(account, spaceName);
  if (!calendar) return [];
  return fakeGoogle
    .eventsOf(calendar)
    .map(({ summary }) => summary ?? "")
    .sort();
}

describe("a member who leaves the allowlist", () => {
  it("is disconnected, with Foyer's access revoked at Google", async () => {
    await connected(alex);

    await workWithout(alex);

    expect(fakeGoogle.hasAccess(alexsAccount)).toBe(false);
  });

  it("keeps their personal spaces' calendars, paused, and resumes them when back and connected again", async () => {
    const alexs = await connected(alex);
    const personal = (await seenBy(alexs.device)).spaceNamed("Personal")?.id ?? "";
    await addEvent(alexs.device, personal, "Dentist");

    await workWithout(alex);
    const back = await member(alex);
    const whileAway = await seenBy(back.device);
    await connectGoogle(back.token);
    await work();
    const reconnected = await seenBy(back.device);

    expect(whileAway.connection).toBeNull();
    expect(whileAway.spaceNamed("Personal")?.calendarState).toBe(CalendarState.PAUSED);
    expect(reconnected.connection?.state).toBe(GoogleConnectionState.CONNECTED);
    expect(reconnected.spaceNamed("Personal")?.calendarState).toBe(CalendarState.SYNCING);
    expect(fakeGoogle.calendarsOf(alexsAccount).map(({ name }) => name)).toEqual([
      "Foyer · Personal",
    ]);
    expect(titlesInGoogle(alexsAccount, "Personal")).toEqual(["Dentist"]);
  });

  it("has the remaining member who connected first take over each shared space they held, with its events", async () => {
    const alexs = await connected(alex);
    const garden = await createShared(alexs.device, "Garden");
    const sams = await connected(sam);
    const robins = await connected(robin);
    const bulbs = await addEvent(alexs.device, garden, "Plant the bulbs");
    const digging = itemCreate({ spaceId: garden, title: "Dig the beds" });
    const sticker = stickerPlace({
      pageId: itemPageId(idOf(digging)),
      itemId: bulbs,
      kind: StickerKind.EVENT,
    });
    await sams.device.push(digging, bodyPage(idOf(digging)), itemSetParent(bulbs, idOf(digging)));
    await sams.device.push(sticker);
    await work();

    await workWithout(alex);
    await workWithout(alex);

    const seenBySam = await seenBy(sams.device);
    expect(seenBySam.spaces.get(garden)).toMatchObject({
      calendarMemberId: sams.memberId,
      calendarState: CalendarState.SYNCING,
    });
    expect((await seenBy(robins.device)).spaces.get(garden)?.calendarMemberId).toBe(sams.memberId);
    expect(seenBySam.items.get(bulbs)).toMatchObject({ spaceId: garden, parentId: idOf(digging) });
    expect(seenBySam.stickers.get(idOf(sticker))?.itemId).toBe(bulbs);
    expect(titlesInGoogle(samsAccount, "Garden")).toEqual(["Plant the bulbs"]);
    expect(calendarOf(robinsAccount, "Garden")).toBeUndefined();
    expect(titlesInGoogle(alexsAccount, "Garden")).toEqual(["Plant the bulbs"]);
  });

  it("dates the shared spaces' events again in the new holder's time zone", async () => {
    const alexs = await connected(alex, "Europe/Madrid");
    const sams = await connected(sam, "America/Santo_Domingo");
    const garden = await createShared(alexs.device, "Garden");
    const film = await addEvent(alexs.device, garden, "Late film", "2026-11-21T02:30:00Z");
    const before = (await seenBy(sams.device)).items.get(film)?.date;

    await workWithout(alex);

    expect(before).toBe("2026-11-21");
    expect((await seenBy(sams.device)).items.get(film)?.date).toBe("2026-11-20");
  });

  it("leaves a shared space they held without a calendar until the next member connects", async () => {
    const alexs = await connected(alex, "Europe/Madrid");
    const sams = await member(sam);
    const garden = await createShared(alexs.device, "Garden");
    const film = await addEvent(alexs.device, garden, "Late film", "2026-11-21T02:30:00Z");

    await workWithout(alex);
    const waiting = await seenBy(sams.device);
    await connectGoogle(sams.token, { timeZone: "America/Santo_Domingo" });
    await workWithout(alex);
    await workWithout(alex);

    expect(waiting.spaces.get(garden)).toMatchObject({
      calendarMemberId: "",
      calendarState: CalendarState.NONE,
    });
    expect(waiting.items.get(film)?.date).toBe("2026-11-21");
    const seenBySam = await seenBy(sams.device);
    expect(seenBySam.spaces.get(garden)).toMatchObject({
      calendarMemberId: sams.memberId,
      calendarState: CalendarState.SYNCING,
    });
    expect(seenBySam.items.get(film)).toMatchObject({ spaceId: garden, date: "2026-11-20" });
    expect(titlesInGoogle(samsAccount, "Garden")).toEqual(["Late film"]);
  });

  it("has an archived shared space they held taken over only once it's restored", async () => {
    const alexs = await connected(alex);
    const sams = await connected(sam);
    const garden = await createShared(alexs.device, "Garden");
    await sams.device.push(spaceSetArchived(garden, true));

    await workWithout(alex);
    const whileArchived = (await seenBy(sams.device)).spaces.get(garden);
    await sams.device.push(spaceSetArchived(garden, false));
    await workWithout(alex);
    await workWithout(alex);

    expect(whileArchived).toMatchObject({
      calendarMemberId: alexs.memberId,
      calendarState: CalendarState.PAUSED,
    });
    expect((await seenBy(sams.device)).spaces.get(garden)).toMatchObject({
      calendarMemberId: sams.memberId,
      calendarState: CalendarState.SYNCING,
    });
    expect(calendarOf(samsAccount, "Garden")).toBeDefined();
  });

  it("is noticed as soon as anyone signs in", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.parse("2036-11-15T12:00:00Z") });
    await connected(alex);
    const sams = await member(sam);
    const before = await alarm();

    await runInDurableObject(theHousehold(), (household) =>
      withEnv({ ...env, HOUSEHOLD_MEMBERS: allowlistWithout(alex) }, () =>
        household.startSession(sams.memberId),
      ),
    );

    const signedInAt = Date.now();

    expect(before).toBeGreaterThan(signedInAt);
    await vi.waitFor(async () => expect(await alarm()).toBe(signedInAt));
  });

  it.each([
    ["is missing", ""],
    ["is malformed", "member@example.com"],
    ["is empty", "[]"],
  ])("isn't anyone when the allowlist %s", async (_, allowlist) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const alexs = await connected(alex);
    const garden = await createShared(alexs.device, "Garden");
    await connected(sam);

    await runInDurableObject(theHousehold(), (household) =>
      withEnv({ ...env, HOUSEHOLD_MEMBERS: allowlist }, () => household.alarm()),
    );

    expect(fakeGoogle.hasAccess(alexsAccount)).toBe(true);
    expect((await seenBy(alexs.device)).spaces.get(garden)?.calendarMemberId).toBe(alexs.memberId);
  });
});

describe("taking an email off the allowlist locally", () => {
  it("has its member leave until the backend restarts, and isn't there on a deployed backend", async () => {
    const robins = await connected(robin);
    const address = `/auth/dev/remove-from-allowlist?email=${encodeURIComponent(robin)}`;

    const deployed = await requestBackend(`${backendUrl}${address}`, { method: "POST" });
    const asked = await requestBackend(`${localBackendUrl}${address}`);
    const removed = await requestBackend(`${localBackendUrl}${address}`, { method: "POST" });
    await work();

    expect(deployed.status).toBe(404);
    expect(asked.status).toBe(405);
    expect(removed.status).toBe(204);
    expect(fakeGoogle.hasAccess(robinsAccount)).toBe(false);
    await expect(signIn(robin)).rejects.toThrow();
    expect((await robins.device.closed).code).toBe(signedOutCloseCode);
  });
});

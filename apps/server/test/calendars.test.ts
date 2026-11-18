import { reset, runInDurableObject } from "cloudflare:test";
import { env, withEnv } from "cloudflare:workers";
import { toBinary } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  App,
  type GoogleConnection,
  GoogleConnectionState,
} from "@foyer/shared/gen/foyer/calendar/v1/calendar_pb";
import { CalendarState, type Space, SpaceKind } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import { type Row, RowKind, RowSchema } from "@foyer/shared/gen/foyer/sync/v1/sync_pb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { longestRetryDelay } from "../src/calendars";
import { fakeGoogle } from "../src/fake-google";
import { theHousehold } from "../src/household";
import { backendUrl, localBackendUrl, locationOf, requestBackend } from "./backend";
import { calendars, connectGoogle, work } from "./calendar-helpers";
import { Device, idOf, signIn, spaceCreate, spaceRename } from "./sync-device";

const alex = "member@example.com";
const sam = "housemate@example.com";
const alexsAccount = `dev:${alex}`;
const samsAccount = `dev:${sam}`;
const calendarScope = "https://www.googleapis.com/auth/calendar.app.created";

const devices: Device[] = [];

afterEach(async () => {
  for (const device of devices.splice(0)) device.close();
  vi.useRealTimers();
  fakeGoogle.reset();
  await reset();
});

type Member = { memberId: string; token: string; device: Device };

async function member(email: string): Promise<Member> {
  const { memberId, token } = await signIn(email);
  return { memberId, token, device: await connect(token) };
}

async function connect(token: string): Promise<Device> {
  const device = await Device.connect(token);
  devices.push(device);
  await device.welcome();
  return device;
}

async function choicesAt(address: string): Promise<Map<string, string>> {
  const page = await (await requestBackend(address)).text();
  const links = [...page.matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)];
  return new Map(links.map(([, href = "", label = ""]) => [label, href.replaceAll("&amp;", "&")]));
}

async function received(device: Device): Promise<Row[]> {
  return (await device.catchUp()).flatMap(({ rows }) => rows);
}

function spacesIn(rows: Row[]): Space[] {
  const spaces = new Map<string, Space>();
  for (const { row } of rows) if (row.case === "space") spaces.set(row.value.id, row.value);
  return [...spaces.values()];
}

function connectionIn(rows: Row[]): GoogleConnection | null | undefined {
  let connection: GoogleConnection | null | undefined;
  for (const { row } of rows) {
    if (row.case === "googleConnection") connection = row.value;
    if (row.case === "deleted" && row.value.kind === RowKind.GOOGLE_CONNECTION) connection = null;
  }
  return connection;
}

async function spaceNamed(device: Device, name: string): Promise<Space | undefined> {
  return spacesIn(await received(device)).find((space) => space.name === name);
}

function calendarNames(account: string): string[] {
  return fakeGoogle
    .calendarsOf(account)
    .map(({ name }) => name)
    .sort();
}

async function createShared(device: Device, name: string): Promise<string> {
  const create = spaceCreate({ name, kind: SpaceKind.SHARED });
  await device.push(create);
  return idOf(create);
}

describe("starting to connect Google Calendar", () => {
  it("asks Google only for the calendars Foyer creates, in the account the member signs in with", async () => {
    const { token } = await member(alex);

    const google = new URL((await calendars(token).startConnecting()).address);

    expect(google.searchParams.get("scope")).toBe(`openid ${calendarScope}`);
    expect(google.searchParams.get("login_hint")).toBe(alexsAccount);
    expect(google.searchParams.get("access_type")).toBe("offline");
    expect(google.searchParams.get("prompt")).toBe("consent");
    expect(google.searchParams.get("code_challenge_method")).toBe("S256");
    expect(google.searchParams.get("client_id")).toBe(env.GOOGLE_CLIENT_ID);
    expect(google.searchParams.get("redirect_uri")).toBe(`${backendUrl}/auth/google/callback`);
  });

  it("needs someone signed in", async () => {
    await expect(calendars().startConnecting()).rejects.toMatchObject({
      code: Code.Unauthenticated,
    });
  });

  it("says so when Google isn't set up on the backend", async () => {
    const { token } = await member(alex);
    const settings = { DEV_SIGN_IN: "0", GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "" };
    vi.spyOn(console, "error").mockImplementation(() => {});

    const error = await calendars(token, { settings })
      .startConnecting()
      .catch((reason) => ConnectError.from(reason));

    expect(error).toMatchObject({ code: Code.FailedPrecondition });
  });

  it("refuses a time zone it doesn't know, and a call that doesn't say which app", async () => {
    const { token } = await member(alex);

    for (const call of [
      calendars(token).startConnecting(App.WEB, "Mars/Olympus_Mons"),
      calendars(token).startConnecting(App.WEB, ""),
      calendars(token).startConnecting(App.UNSPECIFIED),
    ]) {
      const error = await call.catch((reason) => ConnectError.from(reason));
      expect(error).toMatchObject({ code: Code.InvalidArgument });
    }
  });
});

describe("connecting Google Calendar", () => {
  it("returns to the web app, and every device of the member's shows them connected", async () => {
    const alexs = await member(alex);
    const alexsOther = await connect((await signIn(alex)).token);
    const sams = await member(sam);

    const returned = await connectGoogle(alexs.token);

    expect(returned.toString()).toBe(`${backendUrl}/`);
    for (const device of [alexs.device, alexsOther]) {
      expect(connectionIn(await received(device))).toMatchObject({
        memberId: alexs.memberId,
        state: GoogleConnectionState.CONNECTED,
      });
    }
    expect(connectionIn(await received(sams.device))).toBeUndefined();
  });

  it("returns to the iPad app", async () => {
    const { token, device } = await member(alex);

    const returned = await connectGoogle(token, { app: App.IPAD });

    expect(returned.toString()).toBe("foyer://google-calendar");
    expect(connectionIn(await received(device))?.state).toBe(GoogleConnectionState.CONNECTED);
  });

  it("refuses another Google account than the one the member signs in with", async () => {
    const { token, device } = await member(alex);

    const web = await connectGoogle(token, { account: samsAccount });
    const ipad = await connectGoogle(token, { app: App.IPAD, account: samsAccount });

    expect(web.searchParams.get("google-calendar-error")).toBe("other-account");
    expect(ipad.searchParams.get("error")).toBe("other-account");
    expect(connectionIn(await received(device))).toBeUndefined();
  });

  it("refuses access that leaves out the calendars", async () => {
    const { token, device } = await member(alex);

    const returned = await connectGoogle(token, { scope: "openid" });

    expect(returned.searchParams.get("google-calendar-error")).toBe("no-access");
    expect(connectionIn(await received(device))).toBeUndefined();
  });

  it("returns without connecting when the person cancels at Google", async () => {
    const { token, device } = await member(alex);

    const returned = await connectGoogle(token, {
      returned: (callback) => {
        callback.searchParams.delete("code");
        callback.searchParams.set("error", "access_denied");
      },
    });

    expect(returned.toString()).toBe(`${backendUrl}/`);
    expect(connectionIn(await received(device))).toBeUndefined();
  });

  it("refuses a return from Google that it didn't start, or that took too long", async () => {
    const { token, device } = await member(alex);

    const tampered = await connectGoogle(token, {
      returned: (callback) => {
        const state = callback.searchParams.get("state") ?? "";
        callback.searchParams.set("state", `${state.slice(0, -2)}xx`);
      },
    });
    const { address } = await calendars(token).startConnecting();
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 11 * 60 * 1000 });
    const google = new URL(address);
    const late = new URL(google.searchParams.get("redirect_uri") ?? "");
    late.searchParams.set("code", fakeGoogle.codeFor(alexsAccount, `openid ${calendarScope}`));
    late.searchParams.set("state", google.searchParams.get("state") ?? "");
    const lateReturn = locationOf(await requestBackend(late.toString()));

    for (const returned of [tampered, lateReturn]) {
      expect(returned.searchParams.get("google-calendar-error")).toBe("failed");
    }
    expect(connectionIn(await received(device))).toBeUndefined();
  });

  it("returns with an error when Google sends back no code", async () => {
    const { token, device } = await member(alex);

    const returned = await connectGoogle(token, {
      returned: (callback) => callback.searchParams.delete("code"),
    });

    expect(returned.searchParams.get("google-calendar-error")).toBe("failed");
    expect(connectionIn(await received(device))).toBeUndefined();
  });

  it("sends the connection at once to the member's connected devices, and nobody else's", async () => {
    const alexs = await member(alex);
    const sams = await member(sam);

    await connectGoogle(alexs.token);

    const sent = async (device: Device) =>
      (await device.all("updates")).flatMap(({ rows }) => rows);
    expect(connectionIn(await sent(alexs.device))?.state).toBe(GoogleConnectionState.CONNECTED);
    expect(connectionIn(await sent(sams.device))).toBeUndefined();
  });

  it("refuses a member whose email has left the allowlist", async () => {
    const { memberId, device } = await member(alex);

    const result = await runInDurableObject(theHousehold(), (household) =>
      withEnv({ ...env, HOUSEHOLD_MEMBERS: `["${sam}"]` }, () =>
        household.connectGoogle(memberId, {
          code: fakeGoogle.codeFor(alexsAccount, `openid ${calendarScope}`),
          codeVerifier: "code-verifier",
          redirectUri: `${backendUrl}/auth/google/callback`,
          timeZone: "Europe/Madrid",
        }),
      ),
    );

    expect(result).toBe("failed");
    expect(connectionIn(await received(device))).toBeUndefined();
  });
});

describe("the fake Google, locally", () => {
  async function choicesFor(token: string) {
    const local = calendars(token, { baseUrl: localBackendUrl });
    return choicesAt((await local.startConnecting()).address);
  }

  async function choose(token: string, label: string) {
    const address = (await choicesFor(token)).get(label) ?? "";
    return locationOf(await requestBackend(address));
  }

  it("asks for access on the backend's own page, which returns as Google would", async () => {
    const { token, device } = await member(alex);

    const choices = await choicesFor(token);
    const returned = await choose(token, `Continue as ${alexsAccount}`);

    expect([...choices.keys()]).toEqual([
      `Continue as ${alexsAccount}`,
      "Continue with another account",
      "Continue without calendar access",
      "Cancel",
    ]);
    expect(returned.toString()).toBe(`${localBackendUrl}/`);
    expect(connectionIn(await received(device))?.state).toBe(GoogleConnectionState.CONNECTED);
  });

  it("can return as another account, without calendar access, or cancelled", async () => {
    const { token, device } = await member(alex);

    const other = await choose(token, "Continue with another account");
    const withoutAccess = await choose(token, "Continue without calendar access");
    const cancelled = await choose(token, "Cancel");

    expect(other.searchParams.get("google-calendar-error")).toBe("other-account");
    expect(withoutAccess.searchParams.get("google-calendar-error")).toBe("no-access");
    expect(cancelled.toString()).toBe(`${localBackendUrl}/`);
    expect(connectionIn(await received(device))).toBeUndefined();
  });

  it("isn't there on a deployed backend, and returns only to the backend it's on", async () => {
    const page = "/auth/dev/google?state=calendar.x&scope=openid";
    const elsewhere = encodeURIComponent("https://example.com/auth/google/callback");

    const deployed = await requestBackend(`${backendUrl}${page}&redirect_uri=${backendUrl}`);
    const local = await requestBackend(`${localBackendUrl}${page}&redirect_uri=${elsewhere}`);

    expect(deployed.status).toBe(404);
    expect(local.status).toBe(400);
  });
});

describe("making calendars", () => {
  it("makes one for each of the member's spaces, made before they connected, and none for the Inbox", async () => {
    const { token, device, memberId } = await member(alex);
    await createShared(device, "Groceries");

    await connectGoogle(token);
    await work();

    expect(calendarNames(alexsAccount)).toEqual(["Foyer · Groceries", "Foyer · Personal"]);
    expect(fakeGoogle.calendarsOf(alexsAccount)[0]?.timeZone).toBe("Europe/Madrid");
    const spaces = spacesIn(await received(device));
    for (const space of spaces.filter(({ kind }) => kind !== SpaceKind.INBOX)) {
      expect(space).toMatchObject({
        calendarMemberId: memberId,
        calendarState: CalendarState.SYNCING,
      });
    }
    expect(spaces.find(({ kind }) => kind === SpaceKind.INBOX)).toMatchObject({
      calendarMemberId: "",
      calendarState: CalendarState.NONE,
    });
  });

  it("makes one for a new space, and renames it with its space", async () => {
    const { token, device } = await member(alex);
    await connectGoogle(token);
    await work();

    const spaceId = await createShared(device, "Groceries");
    await work();
    await device.push(spaceRename(spaceId, "Shopping"));
    await work();

    expect(calendarNames(alexsAccount)).toEqual(["Foyer · Personal", "Foyer · Shopping"]);
    expect(await spaceNamed(device, "Shopping")).toMatchObject({
      calendarState: CalendarState.SYNCING,
    });
  });

  it("leaves a space without a calendar until someone who can hold it connects", async () => {
    const alexs = await member(alex);
    const sams = await member(sam);
    await connectGoogle(sams.token);
    await work();

    expect(await spaceNamed(alexs.device, "Personal")).toMatchObject({
      calendarMemberId: "",
      calendarState: CalendarState.NONE,
    });
    expect(calendarNames(alexsAccount)).toEqual([]);
  });

  it("makes a calendar deleted in Google again, in the same account, and keeps renaming the others", async () => {
    const { token, device } = await member(alex);
    const gardenId = await createShared(device, "Garden");
    const holidaysId = await createShared(device, "Holidays");
    await connectGoogle(token);
    await work();
    const [gardenCalendar] = [...fakeGoogle.calendars].find(
      ([, calendar]) => calendar.name === "Foyer · Garden",
    ) ?? [""];

    fakeGoogle.calendars.delete(gardenCalendar);
    await device.push(spaceRename(gardenId, "Allotment"), spaceRename(holidaysId, "Trips"));
    await work();
    await work();

    expect(calendarNames(alexsAccount)).toEqual([
      "Foyer · Allotment",
      "Foyer · Personal",
      "Foyer · Trips",
    ]);
    expect(fakeGoogle.calendars.has(gardenCalendar)).toBe(false);
    const garden = await spaceNamed(device, "Allotment");
    expect(garden?.calendarState).toBe(CalendarState.SYNCING);
  });

  it("keeps using the member's access after its access token expires", async () => {
    const { token, device } = await member(alex);
    await connectGoogle(token);
    await work();
    const personalId = (await spaceNamed(device, "Personal"))?.id ?? "";

    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 2 * 60 * 60 * 1000 });
    await device.push(spaceRename(personalId, "Mine"));
    await work();

    expect(calendarNames(alexsAccount)).toEqual(["Foyer · Mine"]);
    expect((await spaceNamed(device, "Mine"))?.calendarState).toBe(CalendarState.SYNCING);
  });

  it("tries again until Google answers, waiting longer each time", async () => {
    const { token, device } = await member(alex);
    await connectGoogle(token);
    await work();
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() });

    fakeGoogle.down = true;
    await createShared(device, "Garden");
    await work();
    const pending = await spaceNamed(device, "Garden");
    fakeGoogle.down = false;
    await work();
    const tooSoon = calendarNames(alexsAccount);
    vi.advanceTimersByTime(longestRetryDelay);
    await work();

    expect(pending?.calendarState).toBe(CalendarState.NONE);
    expect(tooSoon).toEqual(["Foyer · Personal"]);
    expect(calendarNames(alexsAccount)).toEqual(["Foyer · Garden", "Foyer · Personal"]);
    expect((await spaceNamed(device, "Garden"))?.calendarState).toBe(CalendarState.SYNCING);
  });
});

describe("who holds a shared space's calendar", () => {
  it("is its creator, when they've connected", async () => {
    const alexs = await member(alex);
    const sams = await member(sam);
    await connectGoogle(alexs.token);
    await connectGoogle(sams.token);

    await createShared(sams.device, "Garden");
    await work();

    expect(calendarNames(samsAccount)).toEqual(["Foyer · Garden", "Foyer · Personal"]);
    expect(await spaceNamed(alexs.device, "Garden")).toMatchObject({
      calendarMemberId: sams.memberId,
      calendarState: CalendarState.SYNCING,
    });
  });

  it("is the member who connected first, when its creator hasn't connected", async () => {
    const alexs = await member(alex);
    const sams = await member(sam);
    await connectGoogle(alexs.token);
    await work();

    await createShared(sams.device, "Garden");
    await work();

    expect(calendarNames(alexsAccount)).toEqual(["Foyer · Garden", "Foyer · Personal"]);
    expect(await spaceNamed(sams.device, "Garden")).toMatchObject({
      calendarMemberId: alexs.memberId,
      calendarState: CalendarState.SYNCING,
    });
  });

  it("is the next member to connect, when nobody has, and stays with them after", async () => {
    const alexs = await member(alex);
    const sams = await member(sam);
    await createShared(sams.device, "Garden");
    await createShared(alexs.device, "Holidays");

    await connectGoogle(alexs.token);
    await work();
    await connectGoogle(sams.token);
    await work();

    expect(calendarNames(alexsAccount)).toEqual([
      "Foyer · Garden",
      "Foyer · Holidays",
      "Foyer · Personal",
    ]);
    expect(calendarNames(samsAccount)).toEqual(["Foyer · Personal"]);
  });

  it("is shown to every member, who never receives another member's personal spaces", async () => {
    const alexs = await member(alex);
    const sams = await member(sam);
    await createShared(alexs.device, "Garden");
    await connectGoogle(alexs.token);
    await work();

    const seenBySam = spacesIn(await received(sams.device));

    expect(seenBySam.find(({ name }) => name === "Garden")).toMatchObject({
      calendarMemberId: alexs.memberId,
      calendarState: CalendarState.SYNCING,
    });
    expect(seenBySam.filter(({ ownerId }) => ownerId === alexs.memberId)).toEqual([]);
  });
});

describe("access that stops working", () => {
  it("needs reconnecting, pauses the member's spaces, and resumes them once they connect again", async () => {
    const alexs = await member(alex);
    const sams = await member(sam);
    const gardenId = await createShared(alexs.device, "Garden");
    await connectGoogle(alexs.token);
    await work();

    fakeGoogle.revokeAccessOf(alexsAccount);
    await alexs.device.push(spaceRename(gardenId, "Allotment"));
    await work();
    const broken = connectionIn(await received(alexs.device));
    const paused = await spaceNamed(sams.device, "Allotment");
    await connectGoogle(alexs.token);
    await work();

    expect(broken?.state).toBe(GoogleConnectionState.NEEDS_RECONNECTING);
    expect(paused).toMatchObject({
      calendarMemberId: alexs.memberId,
      calendarState: CalendarState.PAUSED,
    });
    expect(connectionIn(await received(alexs.device))?.state).toBe(GoogleConnectionState.CONNECTED);
    expect((await spaceNamed(sams.device, "Allotment"))?.calendarState).toBe(CalendarState.SYNCING);
    expect(calendarNames(alexsAccount)).toEqual(["Foyer · Allotment", "Foyer · Personal"]);
  });
});

describe("disconnecting", () => {
  it("revokes the access, pauses the member's spaces, and connecting again resumes the same calendars", async () => {
    const alexs = await member(alex);
    await connectGoogle(alexs.token);
    await work();

    await calendars(alexs.token).disconnect();
    const afterDisconnecting = await received(alexs.device);
    await connectGoogle(alexs.token);
    await work();

    expect(fakeGoogle.calendarsOf(alexsAccount)).toHaveLength(1);
    expect(connectionIn(afterDisconnecting)).toBeNull();
    expect(spacesIn(afterDisconnecting).find(({ name }) => name === "Personal")).toMatchObject({
      calendarState: CalendarState.PAUSED,
    });
    expect((await spaceNamed(alexs.device, "Personal"))?.calendarState).toBe(CalendarState.SYNCING);
  });

  it("revokes Foyer's access at Google", async () => {
    const { token } = await member(alex);
    await connectGoogle(token);

    const before = fakeGoogle.hasAccess(alexsAccount);
    await calendars(token).disconnect();

    expect(before).toBe(true);
    expect(fakeGoogle.hasAccess(alexsAccount)).toBe(false);
  });

  it("needs someone signed in", async () => {
    await expect(calendars().disconnect()).rejects.toMatchObject({ code: Code.Unauthenticated });
  });

  it("does nothing for a member who isn't connected", async () => {
    const { token, device } = await member(alex);

    await calendars(token).disconnect();

    expect(connectionIn(await received(device))).toBeUndefined();
  });
});

describe("what devices receive", () => {
  it("never holds Google's tokens or ids", async () => {
    const alexs = await member(alex);
    const sams = await member(sam);
    await createShared(alexs.device, "Garden");
    await connectGoogle(alexs.token);
    await work();
    fakeGoogle.revokeAccessOf(alexsAccount);
    await alexs.device.push(spaceRename((await spaceNamed(alexs.device, "Garden"))?.id ?? "", "x"));
    await work();

    const rows = [...(await received(alexs.device)), ...(await received(sams.device))];
    const bytes = rows.map((row) => toBinary(RowSchema, row));
    const text = bytes.map((each) => new TextDecoder().decode(each)).join("\n");

    expect(rows.some(({ row }) => row.case === "googleConnection")).toBe(true);
    for (const secret of ["fake-access", "fake-refresh", "group.calendar.google.com", "dev:"]) {
      expect(text).not.toContain(secret);
    }
  });
});

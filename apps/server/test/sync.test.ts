import { reset, runInDurableObject } from "cloudflare:test";
import { newId, signedOutCloseCode } from "@foyer/shared";
import { SpaceKind } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import { type Row, RowKind } from "@foyer/shared/gen/foyer/sync/v1/sync_pb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { theHousehold } from "../src/household";
import { householdMigrations, migrate } from "../src/migrations";
import { pullReplyRowLimit } from "../src/rows";
import { backendUrl, cookieSetBy, requestBackend } from "./backend";
import {
  Device,
  madeAt,
  openConnection,
  signIn,
  spaceCreate,
  spaceRename,
  together,
} from "./sync-device";

const alex = "member@example.com";
const sam = "housemate@example.com";

const devices: Device[] = [];

async function connect(token: string): Promise<Device> {
  const device = await Device.connect(token);
  devices.push(device);
  await device.welcome();
  return device;
}

afterEach(async () => {
  for (const device of devices.splice(0)) device.close();
  vi.useRealTimers();
  vi.restoreAllMocks();
  await reset();
});

function describeRows(rows: Row[]) {
  return rows.map(({ row }) => {
    switch (row.case) {
      case "member":
        return { member: row.value.name };
      case "space":
        return { space: row.value.name, kind: row.value.kind, ownerId: row.value.ownerId };
      case "deleted":
        return { deleted: row.value.id, kind: row.value.kind };
      default:
        return { unknown: true };
    }
  });
}

function spaceNamed(rows: Row[], name: string) {
  return rows.flatMap(({ row }) =>
    row.case === "space" && row.value.name === name ? [row.value] : [],
  )[0];
}

function seqOf(result: { result: { case: string | undefined; value?: unknown } } | undefined) {
  if (result?.result.case !== "seq") throw new Error(`Not committed: ${JSON.stringify(result)}`);
  return Number(result.result.value);
}

function refusalOf(result: { result: { case: string | undefined; value?: unknown } } | undefined) {
  if (result?.result.case !== "refused") throw new Error("Not refused");
  return (result.result.value as { reason: string }).reason;
}

describe("opening a sync connection", () => {
  it("welcomes a device with the number of the household's latest change", async () => {
    const { token } = await signIn(alex);
    await signIn(sam);

    const device = await Device.connect(token);
    devices.push(device);

    expect(await device.welcome()).toBe(2);
  });

  it("welcomes each device with the member whose session its connection carries", async () => {
    const alexSignedIn = await signIn(alex);
    const samSignedIn = await signIn(sam);

    const alexDevice = await Device.connect(alexSignedIn.token);
    const samOnTheWeb = Device.from(
      await openConnection({ Cookie: `foyer_session=${samSignedIn.token}`, Origin: backendUrl }),
    );
    devices.push(alexDevice, samOnTheWeb);

    expect((await alexDevice.next("welcome")).memberId).toBe(alexSignedIn.memberId);
    expect((await samOnTheWeb.next("welcome")).memberId).toBe(samSignedIn.memberId);
  });

  it("opens with the web app's session cookie, from the backend's own site", async () => {
    const { token } = await signIn(alex);

    const response = await openConnection({
      Cookie: `foyer_session=${token}`,
      Origin: backendUrl,
    });
    const device = Device.from(response);
    devices.push(device);

    expect(await device.welcome()).toBe(1);
  });

  it("renews the web app's cookie when opening is the session's first use that day", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.UTC(2026, 0, 1) });
    const { token } = await signIn(alex);
    const web = { Cookie: `foyer_session=${token}`, Origin: backendUrl };

    vi.setSystemTime(Date.UTC(2026, 0, 2, 1));
    const nextDay = await openConnection(web);
    const againThatDay = await openConnection(web);
    devices.push(Device.from(nextDay), Device.from(againThatDay));

    expect(cookieSetBy(nextDay, "foyer_session")).toMatchObject({ value: token });
    expect(cookieSetBy(againThatDay, "foyer_session")).toBeUndefined();
  });

  it("refuses the web app's session cookie from another site", async () => {
    const { token } = await signIn(alex);

    const response = await openConnection({
      Cookie: `foyer_session=${token}`,
      Origin: "https://elsewhere.test",
    });

    expect(response.status).toBe(403);
    expect(response.webSocket).toBeNull();
  });

  it.each([
    ["no session", {}],
    ["a session that doesn't exist", { Authorization: "Bearer no-such-session" }],
  ])("closes at once, as signed out, with %s", async (_, headers) => {
    const device = Device.from(await openConnection(headers));

    expect(await device.closed).toEqual({
      code: signedOutCloseCode,
      reason: "Nobody is signed in.",
    });
  });

  it("only opens as a WebSocket", async () => {
    const { token } = await signIn(alex);

    const response = await requestBackend(`${backendUrl}/sync`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(426);
  });

  it("answers ping with pong, to keep the connection open", async () => {
    const device = await connect((await signIn(alex)).token);

    await expect(device.ping()).resolves.toBeUndefined();
  });

  it("closes a session's connections, as signed out, when it signs out", async () => {
    const { token } = await signIn(alex);
    const other = await signIn(alex);
    const signingOut = await connect(token);
    const staying = await connect(other.token);

    await theHousehold().endSession(token);

    expect((await signingOut.closed).code).toBe(signedOutCloseCode);
    await expect(staying.ping()).resolves.toBeUndefined();
  });

  it("ignores text other than ping", async () => {
    const device = await connect((await signIn(alex)).token);

    device.send("hello");

    await expect(device.ping()).resolves.toBeUndefined();
  });

  it("closes a connection, as signed out, when it's used after its session ended unused", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.UTC(2026, 0, 1) });
    const device = await connect((await signIn(alex)).token);

    vi.setSystemTime(Date.UTC(2026, 3, 2));
    device.send({ case: "pull", value: { cursor: 0n } });

    expect((await device.closed).code).toBe(signedOutCloseCode);
  });

  it("only opens connections whose session the Worker checked", async () => {
    const response = await theHousehold().fetch(
      new Request(`${backendUrl}/sync`, { headers: { Upgrade: "websocket" } }),
    );

    expect(response.status).toBe(400);
    expect(response.webSocket).toBeNull();
  });

  it("closes a connection that sends bytes that aren't a sync message", async () => {
    const device = await connect((await signIn(alex)).token);

    device.sendBytes(new Uint8Array([0xff, 0xff, 0xff]));

    expect(await device.closed).toEqual({ code: 1007, reason: "That isn't a sync message." });
  });
});

describe("pushing changes", () => {
  it("commits a new shared space and sends it to every member's devices, the sender's included", async () => {
    const alexDevice = await connect((await signIn(alex)).token);
    const samDevice = await connect((await signIn(sam)).token);
    await alexDevice.updates();

    const create = spaceCreate({ name: "Home", kind: SpaceKind.SHARED });
    const committed = await alexDevice.push(create);

    const seq = seqOf(committed.results[0]);
    expect(committed.results.map(({ changeId }) => changeId)).toEqual([create.changeId]);
    for (const device of [alexDevice, samDevice]) {
      const rows = await device.updates();
      expect(describeRows(rows)).toEqual([{ space: "Home", kind: SpaceKind.SHARED, ownerId: "" }]);
      expect(Number(rows[0]?.seq)).toBe(seq);
    }
  });

  it("sends a new personal space to its owner's devices only", async () => {
    const owner = await signIn(alex);
    const phone = await connect(owner.token);
    const tablet = await connect((await signIn(alex)).token);
    const samDevice = await connect((await signIn(sam)).token);
    await Promise.all([phone.updates(), tablet.updates()]);

    await phone.push(spaceCreate({ name: "Work", kind: SpaceKind.PERSONAL }));

    for (const device of [phone, tablet]) {
      expect(describeRows(await device.updates())).toEqual([
        { space: "Work", kind: SpaceKind.PERSONAL, ownerId: owner.memberId },
      ]);
    }
    expect(await samDevice.updates()).toEqual([]);
    expect(
      spaceNamed(
        (await samDevice.catchUp()).flatMap(({ rows }) => rows),
        "Work",
      ),
    ).toBe(undefined);
  });

  it("renames a shared space for everyone", async () => {
    const alexDevice = await connect((await signIn(alex)).token);
    const samDevice = await connect((await signIn(sam)).token);
    const create = spaceCreate({ name: "Home" });
    await alexDevice.push(create);
    await Promise.all([alexDevice.updates(), samDevice.updates()]);

    await samDevice.push(spaceRename(spaceIdOf(create), "Our home"));

    for (const device of [alexDevice, samDevice]) {
      expect(describeRows(await device.updates())).toEqual([
        { space: "Our home", kind: SpaceKind.SHARED, ownerId: "" },
      ]);
    }
  });

  it("lets a member rename their own personal spaces", async () => {
    const owner = await signIn(alex);
    const device = await connect(owner.token);
    const personal = spaceNamed(
      (await device.catchUp()).flatMap(({ rows }) => rows),
      "Personal",
    );

    const committed = await device.push(spaceRename(personal?.id ?? "", "Mine"));

    expect(committed.results[0]?.result.case).toBe("seq");
    expect(describeRows(await device.updates())).toEqual([
      { space: "Mine", kind: SpaceKind.PERSONAL, ownerId: owner.memberId },
    ]);
  });

  it("applies the changes in a push in order, each with its own number", async () => {
    const device = await connect((await signIn(alex)).token);
    const create = spaceCreate({ name: "Garden" }, { at: madeAt(Date.now() - 1000) });

    const committed = await device.push(create, spaceRename(spaceIdOf(create), "Garden plans"));

    const [created, renamed] = committed.results.map(seqOf);
    expect(renamed).toBe((created ?? 0) + 1);
    expect(describeRows(await device.updates())).toEqual([
      { space: "Garden plans", kind: SpaceKind.SHARED, ownerId: "" },
    ]);
  });

  it("answers a push sent again as it did the first time, and changes nothing more", async () => {
    const device = await connect((await signIn(alex)).token);
    const other = await connect((await signIn(sam)).token);
    await device.updates();
    const create = spaceCreate({ name: "Home" });
    const refused = spaceRename(newId(), "Nowhere");
    const first = await device.push(create, refused);
    await Promise.all([device.updates(), other.updates()]);

    const again = await device.push(create, refused);

    expect(again.results).toEqual(first.results);
    expect(await device.updates()).toEqual([]);
    expect(await other.updates()).toEqual([]);
    const reconnected = await Device.connect((await signIn(sam)).token);
    devices.push(reconnected);
    expect(await reconnected.welcome()).toBe(seqOf(first.results[0]));
  });
});

describe("remembering changes", () => {
  const day = 24 * 60 * 60 * 1000;

  it("answers a change sent again for 90 days, as long as an unused session lasts", async () => {
    const start = Date.UTC(2026, 0, 1);
    vi.useFakeTimers({ toFake: ["Date"], now: start });
    const device = await connect((await signIn(alex)).token);
    const create = spaceCreate({ name: "Home" });
    const first = await device.push(create);
    const useDailyUntil = async (days: number) => {
      for (let time = Date.now() + day; time <= start + days * day; time += day) {
        vi.setSystemTime(time);
        await device.pull(1_000_000);
      }
    };

    await useDailyUntil(89);
    const within = await device.push(create);
    await useDailyUntil(90);
    const after = await device.push(create);

    expect(within.results).toEqual(first.results);
    expect(refusalOf(after.results[0])).toBe("A space with this id already exists.");
  });
});

describe("refused changes", () => {
  it.each([
    [
      "renaming someone else's personal space",
      async (samSpaces: { personal: string; inbox: string }) =>
        spaceRename(samSpaces.personal, "Mine now"),
      "There's no such space.",
    ],
    [
      "renaming someone else's Inbox",
      async (samSpaces: { personal: string; inbox: string }) =>
        spaceRename(samSpaces.inbox, "Mine now"),
      "There's no such space.",
    ],
    [
      "renaming a space that doesn't exist",
      async () => spaceRename(newId(), "Nowhere"),
      "There's no such space.",
    ],
    [
      "creating an Inbox",
      async () => spaceCreate({ name: "Another inbox", kind: SpaceKind.INBOX }),
      "Only personal and shared spaces can be created.",
    ],
    [
      "creating a space whose id isn't a UUID version 7",
      async () => spaceCreate({ name: "Home", spaceId: "home" }),
      "A space's id must be a UUID version 7.",
    ],
    [
      "creating a space with the id of one that exists",
      async (samSpaces: { personal: string; inbox: string }) =>
        spaceCreate({ name: "Home", spaceId: samSpaces.personal }),
      "A space with this id already exists.",
    ],
    [
      "a change that doesn't say when it was made",
      async () => ({ ...spaceCreate({ name: "Home" }), at: undefined }),
      "A change must say when it was made.",
    ],
    [
      "a change whose id isn't a UUID version 7",
      async () => spaceCreate({ name: "Home" }, { changeId: "change-1" }),
      "A change's id must be a UUID version 7.",
    ],
    [
      "a change of no kind the household knows",
      async () => ({ changeId: newId(), at: madeAt(Date.now()) }),
      "The household doesn't know this kind of change.",
    ],
  ])("refuses %s, sending nothing", async (_, makeChange, reason) => {
    const alexDevice = await connect((await signIn(alex)).token);
    const samDevice = await connect((await signIn(sam)).token);
    const samSpaces = await spacesOf(samDevice);
    await alexDevice.updates();

    const committed = await alexDevice.push(await makeChange(samSpaces));

    expect(refusalOf(committed.results[0])).toBe(reason);
    expect(await alexDevice.updates()).toEqual([]);
    expect(await samDevice.updates()).toEqual([]);
  });

  it("refuses renaming one's own Inbox", async () => {
    const device = await connect((await signIn(alex)).token);
    const { inbox } = await spacesOf(device);

    const committed = await device.push(spaceRename(inbox, "Captures"));

    expect(refusalOf(committed.results[0])).toBe("The Inbox can't be renamed.");
  });

  it("gives refused changes no number, and still applies the rest of the push", async () => {
    const device = await connect((await signIn(alex)).token);

    const committed = await device.push(
      spaceRename(newId(), "Nowhere"),
      spaceCreate({ name: "Home" }),
    );

    expect(committed.results[0]?.result.case).toBe("refused");
    expect(seqOf(committed.results[1])).toBe(2);
  });
});

describe("actions", () => {
  async function connectWithSeq(email: string): Promise<{ device: Device; seq: number }> {
    const device = await Device.connect((await signIn(email)).token);
    devices.push(device);
    return { device, seq: await device.welcome() };
  }

  it("applies an action's changes in order, each with its own number", async () => {
    const device = await connect((await signIn(alex)).token);
    const create = spaceCreate({ name: "Garden" }, { at: madeAt(Date.now() - 1000) });

    const committed = await device.push(
      ...together([create, spaceRename(spaceIdOf(create), "Garden plans")]),
    );

    const [created, renamed] = committed.results.map(seqOf);
    expect(renamed).toBe((created ?? 0) + 1);
    expect(describeRows(await device.updates())).toEqual([
      { space: "Garden plans", kind: SpaceKind.SHARED, ownerId: "" },
    ]);
  });

  it("applies none of an action's changes when one is refused, refusing each with its reason", async () => {
    const other = await connect((await signIn(sam)).token);
    const { device, seq } = await connectWithSeq(alex);
    await Promise.all([device.updates(), other.updates()]);

    const refused = await device.push(
      ...together([spaceCreate({ name: "Garden" }), spaceRename(newId(), "Nowhere")]),
    );
    const after = await device.push(spaceCreate({ name: "Shed" }));

    expect(refused.results.map(refusalOf)).toEqual([
      "There's no such space.",
      "There's no such space.",
    ]);
    expect(seqOf(after.results[0])).toBe(seq + 1);
    for (const each of [device, other]) {
      expect(describeRows(await each.updates())).toEqual([
        { space: "Shed", kind: SpaceKind.SHARED, ownerId: "" },
      ]);
    }
  });

  it("answers an action sent again as it did the first time, and changes nothing more", async () => {
    const device = await connect((await signIn(alex)).token);
    const create = spaceCreate({ name: "Garden" });
    const applied = together([create, spaceRename(spaceIdOf(create), "Garden plans")]);
    const refused = together([spaceCreate({ name: "Shed" }), spaceRename(newId(), "Nowhere")]);
    const first = await device.push(...applied, ...refused);
    await device.updates();

    const again = await device.push(...applied, ...refused);

    expect(again.results).toEqual(first.results);
    expect(await device.updates()).toEqual([]);
  });

  it("applies each action, and each change on its own, apart from the others in a push", async () => {
    const device = await connect((await signIn(alex)).token);
    const garden = spaceCreate({ name: "Garden" });

    const committed = await device.push(
      spaceRename(newId(), "Nowhere"),
      ...together([garden, spaceRename(spaceIdOf(garden), "Garden plans")]),
      ...together([spaceCreate({ name: "Shed" }), spaceRename(newId(), "Nowhere")]),
      spaceCreate({ name: "Attic" }),
    );

    expect(committed.results.map(({ result }) => result.case)).toEqual([
      "refused",
      "seq",
      "seq",
      "refused",
      "refused",
      "seq",
    ]);
    expect(describeRows(await device.updates()).map((row) => row.space)).toEqual([
      "Garden plans",
      "Attic",
    ]);
  });

  it("refuses an action whose id isn't a UUID version 7", async () => {
    const device = await connect((await signIn(alex)).token);

    const committed = await device.push(
      ...together([spaceCreate({ name: "Garden" }), spaceCreate({ name: "Shed" })], "action-1"),
    );

    expect(committed.results.map(refusalOf)).toEqual([
      "An action's id must be a UUID version 7.",
      "An action's id must be a UUID version 7.",
    ]);
    expect(await device.updates()).toEqual([]);
  });

  it("applies the rest of an action when one of its changes loses a conflict", async () => {
    const device = await connect((await signIn(alex)).token);
    const home = spaceCreate({ name: "Home" }, { at: madeAt(Date.now() - 2000) });
    await device.push(home, spaceRename(spaceIdOf(home), "Our home"));
    await device.updates();

    const committed = await device.push(
      ...together([
        spaceRename(spaceIdOf(home), "Old name", { at: madeAt(Date.now() - 1000) }),
        spaceCreate({ name: "Garden" }),
      ]),
    );

    expect(committed.results.map(({ result }) => result.case)).toEqual(["seq", "seq"]);
    expect(describeRows(await device.updates()).map((row) => row.space)).toEqual(
      expect.arrayContaining(["Our home", "Garden"]),
    );
  });
});

describe("conflicting changes", () => {
  const monday = Date.UTC(2026, 10, 16, 9);
  const tuesday = Date.UTC(2026, 10, 17, 9);

  it("keeps the rename made last, even when an older one made offline arrives after it", async () => {
    const alexDevice = await connect((await signIn(alex)).token);
    const samDevice = await connect((await signIn(sam)).token);
    const create = spaceCreate({ name: "Home" }, { at: madeAt(monday - 1) });
    await alexDevice.push(create);
    await Promise.all([alexDevice.updates(), samDevice.updates()]);

    await samDevice.push(spaceRename(spaceIdOf(create), "Tuesday's name", { at: madeAt(tuesday) }));
    await Promise.all([alexDevice.updates(), samDevice.updates()]);
    const late = await alexDevice.push(
      spaceRename(spaceIdOf(create), "Monday's name", { at: madeAt(monday) }),
    );

    expect(late.results[0]?.result.case).toBe("seq");
    expect(describeRows(await alexDevice.updates())).toEqual([
      { space: "Tuesday's name", kind: SpaceKind.SHARED, ownerId: "" },
    ]);
    expect(await samDevice.updates()).toEqual([]);
  });

  it("settles renames made at the same time by their change ids", async () => {
    const device = await connect((await signIn(alex)).token);
    const create = spaceCreate({ name: "Home" }, { at: madeAt(monday - 1) });
    await device.push(create);
    const [smaller, larger] = [newId(), newId()].sort();

    await device.push(
      spaceRename(spaceIdOf(create), "Larger id", { at: madeAt(monday), changeId: larger }),
    );
    await device.push(
      spaceRename(spaceIdOf(create), "Smaller id", { at: madeAt(monday), changeId: smaller }),
    );

    const rows = (await device.catchUp()).flatMap(({ rows }) => rows);
    expect(spaceNamed(rows, "Larger id")).toBeDefined();
    expect(spaceNamed(rows, "Smaller id")).toBeUndefined();
  });

  it("counts a time later than the household's clock as the household's time", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: monday });
    const device = await connect((await signIn(alex)).token);
    const create = spaceCreate({ name: "Home" }, { at: madeAt(monday - 1) });
    await device.push(create);

    await device.push(
      spaceRename(spaceIdOf(create), "From a fast clock", {
        at: madeAt(monday + 365 * 86_400_000),
      }),
    );
    vi.setSystemTime(monday + 1000);
    await device.push(spaceRename(spaceIdOf(create), "Made later", { at: madeAt(monday + 1000) }));

    const rows = (await device.catchUp()).flatMap(({ rows }) => rows);
    expect(spaceNamed(rows, "Made later")).toBeDefined();
  });
});

describe("space names", () => {
  const longest = "a".repeat(119);

  async function namesOn(device: Device): Promise<string[]> {
    const rows = (await device.catchUp()).flatMap(({ rows }) => rows);
    return rows.flatMap(({ row }) =>
      row.case === "space" && row.value.kind !== SpaceKind.INBOX ? [row.value.name] : [],
    );
  }

  it.each([
    ["a blank name", "   ", "A space's name can't be blank."],
    [
      "a name over 120 characters",
      `${longest}bc`,
      "A space's name can't be longer than 120 characters.",
    ],
  ])("refuses creating or renaming a space with %s", async (_, name, reason) => {
    const device = await connect((await signIn(alex)).token);
    const create = spaceCreate({ name: "Home" });
    await device.push(create);
    await device.updates();

    const committed = await device.push(
      spaceCreate({ name }),
      spaceRename(spaceIdOf(create), name),
    );

    expect(committed.results.map(refusalOf)).toEqual([reason, reason]);
    expect(await device.updates()).toEqual([]);
  });

  it("counts characters as code points, so a name of 120 with an emoji fits", async () => {
    const device = await connect((await signIn(alex)).token);

    const committed = await device.push(spaceCreate({ name: `${longest}🏡` }));

    expect(committed.results[0]?.result.case).toBe("seq");
  });

  it("drops spaces at the start and end of a name", async () => {
    const device = await connect((await signIn(alex)).token);
    const create = spaceCreate({ name: "  Garden  " });

    await device.push(create);
    const created = describeRows(await device.updates());
    await device.push(spaceRename(spaceIdOf(create), "\tGarden plans "));

    expect(created).toEqual([{ space: "Garden", kind: SpaceKind.SHARED, ownerId: "" }]);
    expect(describeRows(await device.updates())).toEqual([
      { space: "Garden plans", kind: SpaceKind.SHARED, ownerId: "" },
    ]);
  });

  it("refuses renaming a space to the name of another the member sees, ignoring case", async () => {
    const owner = await signIn(alex);
    const device = await connect(owner.token);
    const shared = spaceCreate({ name: "Garden" });
    await device.push(spaceCreate({ name: "Home" }), shared);
    const { personal } = await spacesOf(device);
    await device.updates();

    const committed = await device.push(
      spaceRename(spaceIdOf(shared), "HOME"),
      spaceRename(personal, "garden"),
      spaceRename(spaceIdOf(shared), "personal"),
    );

    expect(committed.results.map(refusalOf)).toEqual([
      "Another space you see is called “Home”.",
      "Another space you see is called “Garden”.",
      "Another space you see is called “Personal”.",
    ]);
    expect(await device.updates()).toEqual([]);
  });

  it("lets a space be renamed to its own name in another case", async () => {
    const device = await connect((await signIn(alex)).token);
    const create = spaceCreate({ name: "home" });
    await device.push(create);
    await device.updates();

    await device.push(spaceRename(spaceIdOf(create), "Home"));

    expect(describeRows(await device.updates())).toEqual([
      { space: "Home", kind: SpaceKind.SHARED, ownerId: "" },
    ]);
  });

  it("numbers a new space whose name another the member sees has, ignoring case", async () => {
    const device = await connect((await signIn(alex)).token);

    await device.push(
      spaceCreate({ name: "Groceries" }),
      spaceCreate({ name: "groceries", kind: SpaceKind.PERSONAL }),
      spaceCreate({ name: "Groceries" }),
      spaceCreate({ name: "Personal" }),
    );

    expect(await namesOn(device)).toEqual([
      "Personal",
      "Groceries",
      "groceries 2",
      "Groceries 3",
      "Personal 2",
    ]);
  });

  it("sends a numbered space to the device that created it under its new name", async () => {
    const device = await connect((await signIn(alex)).token);
    await device.push(spaceCreate({ name: "Home" }));
    await device.updates();

    await device.push(spaceCreate({ name: "Home" }));

    expect(describeRows(await device.updates())).toEqual([
      { space: "Home 2", kind: SpaceKind.SHARED, ownerId: "" },
    ]);
  });

  it("shortens a name before its number when the number would take it past 120 characters", async () => {
    const device = await connect((await signIn(alex)).token);
    const name = `${"a".repeat(117)} bc`;

    await device.push(spaceCreate({ name }), spaceCreate({ name }));

    expect(await namesOn(device)).toEqual(["Personal", name, `${"a".repeat(117)} 2`]);
  });

  it("doesn't count other members' personal spaces as clashes", async () => {
    const samDevice = await connect((await signIn(sam)).token);
    const alexDevice = await connect((await signIn(alex)).token);
    await samDevice.push(
      spaceCreate({ name: "Garden", kind: SpaceKind.PERSONAL }),
      spaceCreate({ name: "Work", kind: SpaceKind.PERSONAL }),
    );
    const shared = spaceCreate({ name: "Home" });

    await alexDevice.push(spaceCreate({ name: "Garden" }), shared);
    const renamed = await alexDevice.push(spaceRename(spaceIdOf(shared), "work"));

    expect(renamed.results[0]?.result.case).toBe("seq");
    expect(await namesOn(alexDevice)).toEqual(["Personal", "Garden", "work"]);
  });

  it("doesn't check the name of a rename that loses to one made later", async () => {
    const device = await connect((await signIn(alex)).token);
    const monday = Date.UTC(2026, 10, 16, 9);
    const create = spaceCreate({ name: "Garden" }, { at: madeAt(monday - 1) });
    await device.push(spaceCreate({ name: "Home" }), create);
    await device.push(spaceRename(spaceIdOf(create), "Yard", { at: madeAt(monday + 1) }));
    await device.updates();

    const late = await device.push(spaceRename(spaceIdOf(create), "Home", { at: madeAt(monday) }));

    expect(late.results[0]?.result.case).toBe("seq");
    expect(describeRows(await device.updates())).toEqual([
      { space: "Yard", kind: SpaceKind.SHARED, ownerId: "" },
    ]);
  });
});

describe("catching up", () => {
  it("sends a device what its member can see, and the household's latest number", async () => {
    const owner = await signIn(alex);
    const samDevice = await connect((await signIn(sam)).token);
    await samDevice.push(spaceCreate({ name: "Sam's", kind: SpaceKind.PERSONAL }));
    const latest = seqOf((await samDevice.push(spaceCreate({ name: "Home" }))).results[0]);
    const device = await connect(owner.token);

    const replies = await device.catchUp();

    expect(replies).toHaveLength(1);
    expect(replies[0]?.done).toBe(true);
    expect(Number(replies[0]?.cursor)).toBe(latest);
    const rows = describeRows(replies[0]?.rows ?? []);
    expect(rows).toHaveLength(5);
    expect(rows).toEqual(
      expect.arrayContaining([
        { member: "member" },
        { space: "", kind: SpaceKind.INBOX, ownerId: owner.memberId },
        { space: "Personal", kind: SpaceKind.PERSONAL, ownerId: owner.memberId },
        { member: "housemate" },
        { space: "Home", kind: SpaceKind.SHARED, ownerId: "" },
      ]),
    );
  });

  it("sends only what changed after the device's cursor", async () => {
    const device = await connect((await signIn(alex)).token);
    const create = spaceCreate({ name: "Home" });
    await device.push(create);
    const [caughtUp] = await device.catchUp();

    await device.push(spaceRename(spaceIdOf(create), "Our home"));
    await signIn(sam);
    const replies = await device.catchUp(Number(caughtUp?.cursor));

    expect(describeRows(replies.flatMap(({ rows }) => rows))).toEqual([
      { space: "Our home", kind: SpaceKind.SHARED, ownerId: "" },
      { member: "housemate" },
    ]);
  });

  it("sends a long catch-up in several replies, each within the limit", async () => {
    const device = await connect((await signIn(alex)).token);
    const spaces = Array.from({ length: pullReplyRowLimit + 10 }, (_, index) =>
      spaceCreate({ name: `Space ${index}` }),
    );
    await device.push(...spaces);

    const replies = await device.catchUp();

    expect(replies.length).toBeGreaterThan(1);
    for (const reply of replies) expect(reply.rows.length).toBeLessThanOrEqual(pullReplyRowLimit);
    const rows = replies.flatMap(({ rows }) => rows);
    expect(rows).toHaveLength(pullReplyRowLimit + 10 + 3);
    expect(rows.map(({ seq }) => Number(seq))).toEqual(
      rows.map(({ seq }) => Number(seq)).toSorted((a, b) => a - b),
    );
  });

  it("keeps the rows one change changed in the same reply", async () => {
    const samDevice = await connect((await signIn(sam)).token);
    const spaces = Array.from({ length: pullReplyRowLimit - 4 }, (_, index) =>
      spaceCreate({ name: `Space ${index}` }),
    );
    await samDevice.push(...spaces);
    const { token } = await signIn(alex);
    const device = await connect(token);

    const replies = await device.catchUp();

    expect(replies.map(({ rows }) => rows.length)).toEqual([pullReplyRowLimit - 3, 3]);
    expect(describeRows(replies[1]?.rows ?? [])).toContainEqual({ member: "member" });
  });

  it("catches up past more rows than a reply holds that the member doesn't see", async () => {
    const samDevice = await connect((await signIn(sam)).token);
    const personal = Array.from({ length: pullReplyRowLimit + 10 }, (_, index) =>
      spaceCreate({ name: `Sam's ${index}`, kind: SpaceKind.PERSONAL }),
    );
    await samDevice.push(...personal);
    await samDevice.push(spaceCreate({ name: "Home" }));
    const device = await connect((await signIn(alex)).token);

    const replies = await device.catchUp();

    expect(replies.length).toBeGreaterThan(1);
    const rows = describeRows(replies.flatMap(({ rows }) => rows));
    expect(rows).toHaveLength(5);
    expect(rows).toEqual(
      expect.arrayContaining([
        { member: "housemate" },
        { space: "Home", kind: SpaceKind.SHARED, ownerId: "" },
        { member: "member" },
      ]),
    );
  });

  it("sends a deleted row as deleted, only to the members who could see it", async () => {
    const alexDevice = await connect((await signIn(alex)).token);
    const samDevice = await connect((await signIn(sam)).token);
    const { memberId } = await signIn(alex);
    const deleted = [newId(), newId()];
    await runInDurableObject(theHousehold(), (_, { storage }) => {
      storage.sql.exec(
        `INSERT INTO tombstones (kind, id, visible_to, seq) VALUES ('space', ?, ?, 10), ('space', ?, NULL, 11)`,
        deleted[0],
        memberId,
        deleted[1],
      );
      storage.sql.exec("UPDATE household SET seq = 11");
    });

    const alexRows = (await alexDevice.catchUp()).flatMap(({ rows }) => rows);
    const samRows = (await samDevice.catchUp()).flatMap(({ rows }) => rows);

    expect(describeRows(alexRows).slice(-2)).toEqual([
      { deleted: deleted[0], kind: RowKind.SPACE },
      { deleted: deleted[1], kind: RowKind.SPACE },
    ]);
    expect(describeRows(samRows).slice(-1)).toEqual([{ deleted: deleted[1], kind: RowKind.SPACE }]);
  });
});

describe("members joining", () => {
  it("sends a new member to every connected device, and their spaces to nobody else", async () => {
    const device = await connect((await signIn(alex)).token);

    await signIn(sam);

    expect(describeRows(await device.updates())).toEqual([{ member: "housemate" }]);
  });
});

describe("storage from before sync", () => {
  it("numbers the members and spaces it holds, so that devices catch up with them", async () => {
    const alexId = newId();
    await runInDurableObject(theHousehold(), async (_, { storage }) => {
      await storage.deleteAll();
      migrate(storage, householdMigrations.slice(0, 3));
      storage.sql.exec(
        "INSERT INTO members (id, email, google_subject, name, joined_at) VALUES (?, ?, 'dev', 'Alex', ?)",
        alexId,
        alex,
        Date.now(),
      );
      storage.sql.exec(
        "INSERT INTO spaces (id, kind, owner_id, name, created_by, created_at) VALUES (?, 'shared', NULL, 'Home', ?, ?)",
        newId(),
        alexId,
        Date.now(),
      );
      migrate(storage, householdMigrations);
    });
    const device = await Device.connect(await theHousehold().startSession(alexId));
    devices.push(device);

    const welcomed = await device.welcome();
    const replies = await device.catchUp();

    expect(welcomed).toBe(2);
    expect(describeRows(replies.flatMap(({ rows }) => rows))).toEqual([
      { member: "Alex" },
      { space: "Home", kind: SpaceKind.SHARED, ownerId: "" },
    ]);
  });
});

function spaceIdOf(change: ReturnType<typeof spaceCreate>): string {
  if (change.change?.case !== "spaceCreate") throw new Error("Not a space being created");
  return change.change.value.spaceId ?? "";
}

async function spacesOf(device: Device): Promise<{ personal: string; inbox: string }> {
  const rows = (await device.catchUp()).flatMap(({ rows }) => rows);
  const own = rows.flatMap(({ row }) => (row.case === "space" ? [row.value] : []));
  return {
    personal: own.find(({ kind }) => kind === SpaceKind.PERSONAL)?.id ?? "",
    inbox: own.find(({ kind }) => kind === SpaceKind.INBOX)?.id ?? "",
  };
}

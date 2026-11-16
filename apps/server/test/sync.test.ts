import { reset, runInDurableObject } from "cloudflare:test";
import { newId, signedOutCloseCode } from "@foyer/shared";
import { SpaceKind } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import { type Row, RowKind } from "@foyer/shared/gen/foyer/sync/v1/sync_pb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { theHousehold } from "../src/household";
import { householdMigrations, migrate } from "../src/migrations";
import { pullReplyRowLimit, pullRows } from "../src/rows";
import { backendUrl, cookieSetBy, requestBackend } from "./backend";
import { Device, madeAt, openConnection, signIn, spaceCreate, spaceRename } from "./sync-device";

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

/** What each row is, in a form that's easy to compare. */
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
    const { memberId } = await signIn(alex);

    const pages = await runInDurableObject(theHousehold(), (_, { storage }) => [
      pullRows(storage.sql, memberId, 0, 2),
      pullRows(storage.sql, memberId, 1, 2),
    ]);

    expect(pages.map(({ rows, cursor, done }) => ({ rows: rows.length, cursor, done }))).toEqual([
      { rows: 3, cursor: 1, done: false },
      { rows: 0, cursor: 1, done: true },
    ]);
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

    const pulled = await runInDurableObject(theHousehold(), async (_, { storage }) => {
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
      return pullRows(storage.sql, alexId, 0);
    });

    expect(pulled.cursor).toBe(2);
    expect(describeRows(pulled.rows)).toEqual([
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

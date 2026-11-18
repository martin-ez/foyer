import { reset, runInDurableObject } from "cloudflare:test";
import { env, withEnv } from "cloudflare:workers";
import { timestampMs } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  a4Portrait,
  itemTitleLimit,
  pageMargin,
  spacePageId,
  stickerGap,
  taskStickerSize,
} from "@foyer/shared";
import { ItemKind } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import { PageKind } from "@foyer/shared/gen/foyer/page/v1/page_pb";
import { SpaceKind } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import { StickerKind } from "@foyer/shared/gen/foyer/sticker/v1/sticker_pb";
import type { Row } from "@foyer/shared/gen/foyer/sync/v1/sync_pb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { theHousehold } from "../src/household";
import { backendUrl, captureClient, requestBackend } from "./backend";
import { Device, idOf, itemCreate, pageCreate, signIn, stickerPlace } from "./sync-device";

const alex = "member@example.com";
const sam = "housemate@example.com";
const day = 24 * 60 * 60 * 1000;
const captureAddress = `${backendUrl}/foyer.capture.v1.CaptureService/Capture`;

const devices: Device[] = [];

afterEach(async () => {
  for (const device of devices.splice(0)) device.close();
  vi.useRealTimers();
  await reset();
});

function bearer(token: string) {
  return { headers: { Authorization: `Bearer ${token}` } };
}

async function connect(token: string): Promise<Device> {
  const device = await Device.connect(token);
  devices.push(device);
  await device.welcome();
  return device;
}

async function memberWithKey(email: string) {
  const { memberId, token } = await signIn(email);
  const device = await connect(token);
  const rows = (await device.catchUp()).flatMap(({ rows }) => rows);
  const inbox = rows.flatMap(({ row }) =>
    row.case === "space" && row.value.kind === SpaceKind.INBOX ? [row.value.id] : [],
  )[0];
  const { key } = await captureClient().makeKey({}, bearer(token));
  return { memberId, token, device, inbox: inbox ?? "", key };
}

function capture(key: string, title: string) {
  return captureClient().capture({ title }, bearer(key));
}

async function codeOf(call: Promise<unknown>): Promise<{ code?: Code; message?: string }> {
  try {
    await call;
    return {};
  } catch (error) {
    const { code, rawMessage } = ConnectError.from(error);
    return { code, message: rawMessage };
  }
}

function ofCase<Case extends NonNullable<Row["row"]["case"]>>(rows: Row[], kind: Case) {
  return rows.flatMap(({ row }) =>
    row.case === kind ? [row.value as Extract<Row["row"], { case: Case }>["value"]] : [],
  );
}

async function fillInboxPage(device: Device, inbox: string, number: number, lowestY: number) {
  const task = itemCreate({ spaceId: inbox });
  const pageId = spacePageId(inbox, number);
  const page = { pageId, kind: PageKind.SPACE, spaceId: inbox, number, ...a4Portrait };
  await device.push(
    pageCreate(page),
    task,
    stickerPlace({ pageId, itemId: idOf(task), y: lowestY }),
  );
  await device.updates();
}

const lastThatFits = a4Portrait.height - pageMargin - taskStickerSize.height;

describe("capturing with a key", () => {
  it("adds a task to the member's Inbox, which their devices receive at once", async () => {
    const { memberId, device, inbox, key, token } = await memberWithKey(alex);
    const other = await connect(token);

    await capture(key, "  Call the plumber  ");

    for (const each of [device, other]) {
      const rows = await each.updates();
      const [item] = ofCase(rows, "item");
      const [page] = ofCase(rows, "page");
      const [sticker] = ofCase(rows, "sticker");
      expect(item).toMatchObject({
        kind: ItemKind.TASK,
        spaceId: inbox,
        title: "Call the plumber",
        createdBy: memberId,
      });
      expect(page).toMatchObject({ id: spacePageId(inbox, 1), kind: PageKind.SPACE, number: 1 });
      expect(sticker).toMatchObject({
        pageId: spacePageId(inbox, 1),
        x: pageMargin,
        y: pageMargin,
        kind: StickerKind.TASK,
        itemId: item?.id,
        placedBy: memberId,
      });
    }
  });

  it("makes the task and its sticker at the household's time", async () => {
    const { device, key } = await memberWithKey(alex);
    const before = Date.now();

    await capture(key, "Call the plumber");

    const rows = await device.updates();
    const [item] = ofCase(rows, "item");
    const [sticker] = ofCase(rows, "sticker");
    for (const at of [item?.createdAt, sticker?.placedAt]) {
      expect(at && timestampMs(at)).toBeGreaterThanOrEqual(before);
      expect(at && timestampMs(at)).toBeLessThanOrEqual(Date.now());
    }
  });

  it("sends the task to no other member", async () => {
    const { key } = await memberWithKey(alex);
    const samDevice = await connect((await signIn(sam)).token);
    await samDevice.catchUp();

    await capture(key, "Call the plumber");

    expect(await samDevice.updates()).toEqual([]);
  });

  it("puts the sticker below the lowest one on the Inbox's newest page", async () => {
    const { device, inbox, key } = await memberWithKey(alex);
    await fillInboxPage(device, inbox, 1, lastThatFits);
    await fillInboxPage(device, inbox, 2, 100);

    await capture(key, "Call the plumber");

    const [sticker] = ofCase(await device.updates(), "sticker");
    expect(sticker).toMatchObject({
      pageId: spacePageId(inbox, 2),
      x: pageMargin,
      y: 100 + taskStickerSize.height + stickerGap,
    });
  });

  it("starts a new Inbox page when the newest is full", async () => {
    const { device, inbox, key } = await memberWithKey(alex);
    await fillInboxPage(device, inbox, 1, lastThatFits);

    await capture(key, "Call the plumber");

    const rows = await device.updates();
    expect(ofCase(rows, "page")).toEqual([
      expect.objectContaining({ id: spacePageId(inbox, 2), number: 2, ...a4Portrait }),
    ]);
    expect(ofCase(rows, "sticker")).toEqual([
      expect.objectContaining({ pageId: spacePageId(inbox, 2), x: pageMargin, y: pageMargin }),
    ]);
  });

  it("makes two tasks when the same capture is sent twice", async () => {
    const { device, key } = await memberWithKey(alex);

    await capture(key, "Call the plumber");
    await capture(key, "Call the plumber");

    const items = ofCase(await device.updates(), "item");
    expect(items.map(({ title }) => title)).toEqual(["Call the plumber", "Call the plumber"]);
    expect(new Set(items.map(({ id }) => id)).size).toBe(2);
  });

  it("answers a plain POST of JSON, as a Shortcut sends it, with an empty object", async () => {
    const { device, key } = await memberWithKey(alex);

    const answer = await requestBackend(captureAddress, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ title: "Call the plumber" }),
    });

    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({});
    expect(ofCase(await device.updates(), "item")).toHaveLength(1);
  });

  it("answers a refused title with a sentence a Shortcut can show", async () => {
    const { key } = await memberWithKey(alex);

    const answer = await requestBackend(captureAddress, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ title: " " }),
    });

    expect(answer.status).toBe(400);
    expect(await answer.json()).toEqual({
      code: "invalid_argument",
      message: "A title can't be blank.",
    });
  });
});

describe("refusing a capture", () => {
  it("refuses a blank title or one that's too long, and adds nothing", async () => {
    const { device, key } = await memberWithKey(alex);

    expect(await codeOf(capture(key, "   "))).toEqual({
      code: Code.InvalidArgument,
      message: "A title can't be blank.",
    });
    expect(await codeOf(capture(key, "a".repeat(itemTitleLimit + 1)))).toEqual({
      code: Code.InvalidArgument,
      message: `A title can't be longer than ${itemTitleLimit} characters.`,
    });
    expect(await device.updates()).toEqual([]);
  });

  it("takes a title of exactly the longest length", async () => {
    const { key } = await memberWithKey(alex);

    expect(await codeOf(capture(key, "a".repeat(itemTitleLimit)))).toEqual({});
  });

  it.each([
    ["no key", {}],
    ["a key that was never made", bearer("not-a-key")],
  ])("refuses a capture with %s as unauthenticated", async (_, options) => {
    const { device } = await memberWithKey(alex);

    const refused = await codeOf(captureClient().capture({ title: "Call the plumber" }, options));

    expect(refused.code).toBe(Code.Unauthenticated);
    expect(await device.updates()).toEqual([]);
  });

  it("refuses a wrong key before looking at the title", async () => {
    await memberWithKey(alex);

    expect((await codeOf(capture("not-a-key", " "))).code).toBe(Code.Unauthenticated);
  });

  it("refuses a session token in place of a key", async () => {
    const { token } = await memberWithKey(alex);

    expect((await codeOf(capture(token, "Call the plumber"))).code).toBe(Code.Unauthenticated);
  });

  it("refuses a key once it's replaced, and takes the new one", async () => {
    const { key, token } = await memberWithKey(alex);

    const { key: replacement } = await captureClient().makeKey({}, bearer(token));

    expect(replacement).not.toBe(key);
    expect((await codeOf(capture(key, "Call the plumber"))).code).toBe(Code.Unauthenticated);
    expect(await codeOf(capture(replacement, "Call the plumber"))).toEqual({});
  });

  it("refuses a key once it's removed", async () => {
    const { key, token } = await memberWithKey(alex);

    await captureClient().removeKey({}, bearer(token));

    expect((await codeOf(capture(key, "Call the plumber"))).code).toBe(Code.Unauthenticated);
  });

  it("refuses a key while its member's email is off the allowlist, and takes it once it's back", async () => {
    const { device, key } = await memberWithKey(alex);

    const whileRemoved = await runInDurableObject(theHousehold(), (household) =>
      withEnv({ ...env, HOUSEHOLD_MEMBERS: "[]" }, () =>
        household.capture(key, "Call the plumber"),
      ),
    );

    expect(whileRemoved).toBe("unauthenticated");
    expect(await device.updates()).toEqual([]);
    expect(await codeOf(capture(key, "Call the plumber"))).toEqual({});
  });

  it("keeps each member's key to their own Inbox", async () => {
    const alexs = await memberWithKey(alex);
    const sams = await memberWithKey(sam);

    await alexs.device.updates();

    await capture(sams.key, "Feed the cat");

    expect(await alexs.device.updates()).toEqual([]);
    expect(ofCase(await sams.device.updates(), "item")).toEqual([
      expect.objectContaining({ spaceId: sams.inbox, title: "Feed the cat" }),
    ]);
  });
});

describe("managing a capture key", () => {
  it("says there's no key until one is made", async () => {
    const { token } = await signIn(alex);
    const got = await captureClient().getKey({}, bearer(token));

    expect(got.exists).toBe(false);
    expect(got.createdAt).toBeUndefined();
    expect(got.lastUsedAt).toBeUndefined();
  });

  it("says when the key was made, and that it hasn't been used", async () => {
    const { token } = await signIn(alex);
    const before = Date.now();

    await captureClient().makeKey({}, bearer(token));

    const got = await captureClient().getKey({}, bearer(token));
    expect(got.exists).toBe(true);
    expect(got.createdAt && timestampMs(got.createdAt)).toBeGreaterThanOrEqual(before);
    expect(got.lastUsedAt).toBeUndefined();
  });

  it("makes keys of 32 random bytes in base64url, a new one each time", async () => {
    const { token } = await signIn(alex);

    const first = await captureClient().makeKey({}, bearer(token));
    const second = await captureClient().makeKey({}, bearer(token));

    for (const { key } of [first, second]) expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second.key).not.toBe(first.key);
  });

  it("moves the key's last use forward at most once a day", async () => {
    const { token } = await signIn(alex);
    const { key } = await captureClient().makeKey({}, bearer(token));
    const lastUsed = async () => {
      const { lastUsedAt } = await captureClient().getKey({}, bearer(token));
      return lastUsedAt && timestampMs(lastUsedAt);
    };
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = Date.UTC(2026, 10, 17, 9);

    vi.setSystemTime(start);
    await capture(key, "Call the plumber");
    vi.setSystemTime(start + day - 1);
    await capture(key, "Call the plumber");
    const withinADay = await lastUsed();
    vi.setSystemTime(start + day);
    await capture(key, "Call the plumber");

    expect(withinADay).toBe(start);
    expect(await lastUsed()).toBe(start + day);
  });

  it("says there's no key once it's removed", async () => {
    const { token } = await signIn(alex);
    await captureClient().makeKey({}, bearer(token));

    await captureClient().removeKey({}, bearer(token));

    expect((await captureClient().getKey({}, bearer(token))).exists).toBe(false);
  });

  it("keeps only a hash of the key", async () => {
    const { token } = await signIn(alex);
    const { key } = await captureClient().makeKey({}, bearer(token));

    const stored = await runInDurableObject(theHousehold(), (_, state) =>
      state.storage.sql.exec("SELECT * FROM capture_keys").toArray(),
    );

    expect(stored).toHaveLength(1);
    expect(JSON.stringify(stored)).not.toContain(key);
  });

  it.each([
    ["making", () => captureClient().makeKey({})],
    ["removing", () => captureClient().removeKey({})],
    ["looking at", () => captureClient().getKey({})],
  ])("refuses %s a key without a session", async (_, call) => {
    expect((await codeOf(call())).code).toBe(Code.Unauthenticated);
  });

  it("refuses a capture key in place of a session", async () => {
    const { key } = await memberWithKey(alex);

    expect((await codeOf(captureClient().getKey({}, bearer(key)))).code).toBe(Code.Unauthenticated);
  });
});

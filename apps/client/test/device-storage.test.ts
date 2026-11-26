import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { dayPageId, newId } from "@foyer/shared";
import { RowSchema } from "@foyer/shared/gen/foyer/sync/v1/sync_pb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as DeviceStorage from "../src/sync/device-storage";
import { openNodeSqlite } from "./node-sqlite";

const files = vi.hoisted(() => ({ folder: "", open: new Map<string, { close(): void }>() }));
const keychain = vi.hoisted(() => new Map<string, string>());

vi.mock("expo-secure-store", () => ({
  getItemAsync: async (key: string) => keychain.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    keychain.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    keychain.delete(key);
  },
}));

vi.mock("expo-sqlite", () => ({
  openDatabaseAsync: async (name: string) => {
    const database = openNodeSqlite(join(files.folder, name));
    files.open.set(name, { close: () => database.raw.close() });
    return {
      ...database,
      closeAsync: async () => {
        files.open.delete(name);
        database.raw.close();
      },
    };
  },
  deleteDatabaseAsync: async (name: string) => {
    if (files.open.has(name)) throw new Error(`Unable to delete ${name}, which is open`);
    rmSync(join(files.folder, name), { force: true });
  },
}));

async function launchApp(): Promise<typeof DeviceStorage> {
  for (const database of files.open.values()) database.close();
  files.open.clear();
  vi.resetModules();
  return import("../src/sync/device-storage");
}

const change = { changeId: "a", encoded: new Uint8Array([1]), describe: "a change" };

const nothingKept = { rows: [], cursors: new Map(), opened: new Map() };

beforeEach(() => {
  files.folder = mkdtempSync(join(tmpdir(), "foyer-device-"));
  keychain.clear();
});

afterEach(() => {
  for (const database of files.open.values()) database.close();
  files.open.clear();
  rmSync(files.folder, { recursive: true, force: true });
});

describe("what the iPad keeps of a member's household", () => {
  it("keeps each member's household apart, for the next launch", async () => {
    const me = newId();
    const housemate = newId();
    let app = await launchApp();
    app.deviceStorageOf(me).store?.keepCursor("", 5n);
    app.deviceStorageOf(me).unsent?.keep([change]);
    await app.deviceStorageOf(me).store?.load();

    app = await launchApp();

    expect((await app.deviceStorageOf(me).store?.load())?.cursors).toEqual(new Map([["", 5n]]));
    expect(await app.deviceStorageOf(me).unsent?.load()).toEqual([change]);
    expect((await app.deviceStorageOf(housemate).store?.load())?.cursors).toEqual(new Map());
  });

  it("forgets everything kept for a member when they sign out, and keeps afresh after", async () => {
    const me = newId();
    const app = await launchApp();
    app.deviceStorageOf(me).store?.keepCursor("", 5n);
    app.deviceStorageOf(me).unsent?.keep([change]);
    await app.deviceStorageOf(me).store?.load();

    await app.forgetDeviceStorage(me);
    const after = app.deviceStorageOf(me);

    expect((await after.store?.load())?.cursors).toEqual(new Map());
    expect(await after.unsent?.load()).toEqual([]);
    after.store?.keepCursor("", 7n);
    await after.store?.load();
    const next = (await launchApp()).deviceStorageOf(me);
    expect((await next.store?.load())?.cursors).toEqual(new Map([["", 7n]]));
  });

  it("forgets what a member kept at an earlier launch, before anything opened it", async () => {
    const me = newId();
    let app = await launchApp();
    app.deviceStorageOf(me).store?.keepCursor("", 5n);
    await app.deviceStorageOf(me).store?.load();

    app = await launchApp();
    await app.forgetDeviceStorage(me);

    expect((await app.deviceStorageOf(me).store?.load())?.cursors).toEqual(new Map());
  });
});

describe("what the iPad keeps once a member's session has ended", () => {
  async function sessionEnded(member: string) {
    let app = await launchApp();
    app.deviceStorageOf(member).store?.keepCursor("", 5n);
    app.deviceStorageOf(member).store?.keepOpened("page", 1_000);
    app.deviceStorageOf(member).unsent?.keep([change]);
    await app.forgetEndedSession(member);
    app = await launchApp();
    return app;
  }

  it("keeps only the member's unsent changes, for when they sign in again", async () => {
    const me = newId();
    const app = await sessionEnded(me);

    await app.forgetOtherMembers(me);

    const kept = app.deviceStorageOf(me);
    expect(await kept.store?.load()).toEqual(nothingKept);
    expect(await kept.unsent?.load()).toEqual([change]);
  });

  it("deletes them once someone else signs in", async () => {
    const me = newId();
    const housemate = newId();
    const app = await sessionEnded(me);

    await app.forgetOtherMembers(housemate);

    expect(await (await launchApp()).deviceStorageOf(me).unsent?.load()).toEqual([]);
  });

  it("deletes them when someone else signs in before the app is launched again", async () => {
    const me = newId();
    const app = await launchApp();
    app.deviceStorageOf(me).unsent?.keep([change]);
    await app.forgetEndedSession(me);

    await app.forgetOtherMembers(newId());

    expect(await app.deviceStorageOf(me).unsent?.load()).toEqual([]);
    expect(await (await launchApp()).deviceStorageOf(me).unsent?.load()).toEqual([]);
  });

  it("keeps them when the member signs in again before the session ends a second time", async () => {
    const me = newId();
    const app = await sessionEnded(me);
    await app.forgetOtherMembers(me);
    app.deviceStorageOf(me).unsent?.keep([{ ...change, changeId: "b" }]);

    await app.forgetEndedSession(me);

    expect(await (await launchApp()).deviceStorageOf(me).unsent?.load()).toEqual([
      change,
      { ...change, changeId: "b" },
    ]);
  });

  it("deletes an earlier member's unsent changes when another member's session ends too", async () => {
    const me = newId();
    const housemate = newId();
    let app = await sessionEnded(me);
    await app.forgetOtherMembers(housemate);
    app.deviceStorageOf(housemate).unsent?.keep([change]);
    await app.forgetEndedSession(housemate);
    app = await launchApp();

    await app.forgetOtherMembers(housemate);

    expect(await app.deviceStorageOf(me).unsent?.load()).toEqual([]);
    expect(await app.deviceStorageOf(housemate).unsent?.load()).toEqual([change]);
  });
});

describe("what the iPad keeps once someone else signs in over a member", () => {
  const day = dayPageId("2026-11-26");
  const home = newId();
  const stroke = newId();

  async function signedInWithACopy(app: typeof DeviceStorage, member: string) {
    await app.forgetOtherMembers(member);
    const { store, unsent } = app.deviceStorageOf(member);
    store?.keepRow({
      kind: "space",
      id: home,
      pageId: null,
      row: create(RowSchema, {
        seq: 3n,
        row: { case: "space", value: { id: home, name: "Home" } },
      }),
    });
    store?.keepRow({
      kind: "stroke",
      id: stroke,
      pageId: day,
      row: create(RowSchema, {
        seq: 4n,
        row: { case: "stroke", value: { id: stroke, pageId: day } },
      }),
    });
    store?.keepCursor("", 5n);
    store?.keepCursor(day, 4n);
    store?.keepOpened(day, 1_000);
    unsent?.keep([change]);
    await store?.load();
  }

  it("deletes the first member's copy of the household and their ink, but not their unsent changes", async () => {
    const me = newId();
    const housemate = newId();
    let app = await launchApp();
    await signedInWithACopy(app, me);

    await app.forgetOtherMembers(housemate);

    expect(await app.deviceStorageOf(me).store?.load()).toEqual(nothingKept);
    app = await launchApp();
    expect(await app.deviceStorageOf(me).store?.load()).toEqual(nothingKept);
    expect(await app.deviceStorageOf(me).unsent?.load()).toEqual([change]);
  });

  it("keeps the copy of a member signed in again, as at each launch", async () => {
    const me = newId();
    let app = await launchApp();
    await signedInWithACopy(app, me);
    app = await launchApp();

    await app.forgetOtherMembers(me);

    const kept = await app.deviceStorageOf(me).store?.load();
    expect(kept?.rows).toHaveLength(2);
    expect(kept?.cursors).toEqual(
      new Map([
        ["", 5n],
        [day, 4n],
      ]),
    );
    expect(kept?.opened).toEqual(new Map([[day, 1_000]]));
  });

  it("keeps the first member's unsent changes to send once they sign in again, whoever signs in meanwhile", async () => {
    const me = newId();
    const housemate = newId();
    let app = await launchApp();
    await signedInWithACopy(app, me);
    await app.forgetOtherMembers(housemate);
    await app.forgetEndedSession(housemate);
    await app.forgetOtherMembers(newId());
    app = await launchApp();

    await app.forgetOtherMembers(me);

    expect(await app.deviceStorageOf(me).unsent?.load()).toEqual([change]);
    expect(await app.deviceStorageOf(me).store?.load()).toEqual(nothingKept);
  });

  it("leaves nothing on the iPad for a member who signed out, once someone else signs in", async () => {
    const me = newId();
    const app = await launchApp();
    await signedInWithACopy(app, me);
    await app.forgetDeviceStorage(me);

    await app.forgetOtherMembers(newId());

    expect(readdirSync(files.folder).filter((file) => file.includes(me))).toEqual([]);
  });

  it("deletes the second member's copy in turn when the first signs in over them", async () => {
    const me = newId();
    const housemate = newId();
    const app = await launchApp();
    await signedInWithACopy(app, me);
    await signedInWithACopy(app, housemate);

    await app.forgetOtherMembers(me);

    expect(await app.deviceStorageOf(housemate).store?.load()).toEqual(nothingKept);
    expect(await app.deviceStorageOf(housemate).unsent?.load()).toEqual([change]);
    expect(await app.deviceStorageOf(me).unsent?.load()).toEqual([change]);
  });
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newId } from "@foyer/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as DeviceStorage from "../src/sync/device-storage";
import { openNodeSqlite } from "./node-sqlite";

const files = vi.hoisted(() => ({ folder: "", open: new Map<string, { close(): void }>() }));

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

beforeEach(() => {
  files.folder = mkdtempSync(join(tmpdir(), "foyer-device-"));
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

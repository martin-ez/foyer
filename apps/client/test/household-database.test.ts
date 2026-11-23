import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { dayPageId } from "@foyer/shared";
import { type Row, RowSchema } from "@foyer/shared/gen/foyer/sync/v1/sync_pb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyLayout, HouseholdDatabase } from "../src/sync/household-database";
import { openNodeSqlite } from "./node-sqlite";

const day = dayPageId("2026-11-25");
const nextDay = dayPageId("2026-11-26");
const home = "019a8f4e-5c00-7000-8000-0000000000a2";

function spaceRow(seq: number, name: string): Row {
  return create(RowSchema, { seq: BigInt(seq), row: { case: "space", value: { id: home, name } } });
}

function strokeRow(seq: number, id: string, pageId: string): Row {
  return create(RowSchema, { seq: BigInt(seq), row: { case: "stroke", value: { id, pageId } } });
}

function change(changeId: string) {
  return { changeId, encoded: new Uint8Array([1, 2, 3]), describe: `change ${changeId}` };
}

let folder: string;
let file: string;
let opened: ReturnType<typeof openNodeSqlite>[];
let removed: string[];

function launch(open = () => Promise.resolve(openNodeSqlite(file))): HouseholdDatabase {
  const database = new HouseholdDatabase(
    open().then((sql) => {
      opened.push(sql);
      return sql;
    }),
    async () => {
      removed.push(file);
      rmSync(file, { force: true });
    },
  );
  return database;
}

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "foyer-household-"));
  file = join(folder, "household.db");
  opened = [];
  removed = [];
});

afterEach(() => {
  for (const { raw } of opened) if (raw.isOpen) raw.close();
  rmSync(folder, { recursive: true, force: true });
});

describe("the household's copy on the iPad", () => {
  it("keeps rows, where the device caught up to and when pages were opened, for the next launch", async () => {
    const database = launch();
    database.keepRow({ kind: "space", id: home, pageId: null, row: spaceRow(3, "Home") });
    database.keepRow({ kind: "stroke", id: "a", pageId: day, row: strokeRow(4, "a", day) });
    database.keepCursor("", 5n);
    database.keepCursor(day, 4n);
    database.keepOpened(day, 1_000);
    await database.load();

    const kept = await launch().load();

    expect(kept.rows).toEqual([spaceRow(3, "Home"), strokeRow(4, "a", day)]);
    expect(kept.cursors).toEqual(
      new Map([
        ["", 5n],
        [day, 4n],
      ]),
    );
    expect(kept.opened).toEqual(new Map([[day, 1_000]]));
  });

  it("keeps each row as last received, and forgets deleted rows", async () => {
    const database = launch();
    database.keepRow({ kind: "space", id: home, pageId: null, row: spaceRow(3, "Home") });
    database.keepRow({ kind: "space", id: home, pageId: null, row: spaceRow(6, "Our home") });
    database.keepRow({ kind: "stroke", id: "a", pageId: day, row: strokeRow(4, "a", day) });
    database.forgetRow("stroke", "a");

    expect((await database.load()).rows).toEqual([spaceRow(6, "Our home")]);
  });

  it("forgets the strokes, ink cursor and opening time of pages it no longer keeps, and nothing else", async () => {
    const database = launch();
    database.keepRow({ kind: "space", id: home, pageId: null, row: spaceRow(3, "Home") });
    database.keepRow({ kind: "stroke", id: "a", pageId: day, row: strokeRow(4, "a", day) });
    database.keepRow({ kind: "stroke", id: "b", pageId: nextDay, row: strokeRow(5, "b", nextDay) });
    database.keepCursor("", 5n);
    database.keepCursor(day, 4n);
    database.keepCursor(nextDay, 5n);
    database.keepOpened(day, 1_000);

    database.forgetPages([day]);
    const kept = await database.load();

    expect(kept.rows).toEqual([spaceRow(3, "Home"), strokeRow(5, "b", nextDay)]);
    expect(kept.cursors).toEqual(
      new Map([
        ["", 5n],
        [nextDay, 5n],
      ]),
    );
    expect(kept.opened).toEqual(new Map());
  });

  it("keeps unsent changes in the order they were made, until they're forgotten", async () => {
    const database = launch();
    database.unsent.keep([change("a"), change("b")]);
    database.unsent.keep([change("c")]);
    database.unsent.forget(["b"]);
    await database.load();

    expect(await launch().unsent.load()).toEqual([change("a"), change("c")]);
  });

  it("rebuilds a copy of another layout from nothing, keeping unsent changes and opening times", async () => {
    const database = launch();
    database.keepRow({ kind: "space", id: home, pageId: null, row: spaceRow(3, "Home") });
    database.keepCursor("", 5n);
    database.keepOpened(day, 1_000);
    database.unsent.keep([change("a"), change("b")]);
    await database.load();
    const earlier = openNodeSqlite(file);
    opened.push(earlier);
    earlier.raw.exec(`
      DROP TABLE household_rows;
      CREATE TABLE household_rows (kind TEXT, id TEXT, seq INTEGER, row BLOB);
      PRAGMA user_version = ${copyLayout + 1};`);

    const rebuilt = launch();
    const kept = await rebuilt.load();

    expect(kept.rows).toEqual([]);
    expect(kept.cursors).toEqual(new Map());
    expect(kept.opened).toEqual(new Map([[day, 1_000]]));
    expect(await rebuilt.unsent.load()).toEqual([change("a"), change("b")]);
    rebuilt.keepRow({ kind: "space", id: home, pageId: null, row: spaceRow(7, "Home") });
    expect((await rebuilt.load()).rows).toEqual([spaceRow(7, "Home")]);
  });

  it("starts afresh when what it kept can't be read", async () => {
    const database = launch();
    database.keepRow({ kind: "space", id: home, pageId: null, row: spaceRow(3, "Home") });
    database.keepCursor("", 5n);
    database.keepOpened(day, 1_000);
    await database.load();
    const earlier = openNodeSqlite(file);
    opened.push(earlier);
    earlier.raw.exec("UPDATE household_rows SET row = x'ff'");

    const kept = await launch().load();

    expect(kept).toEqual({ rows: [], cursors: new Map(), opened: new Map([[day, 1_000]]) });
  });

  it("closes and deletes the database when forgotten, and keeps nothing after", async () => {
    const database = launch();
    database.keepRow({ kind: "space", id: home, pageId: null, row: spaceRow(3, "Home") });
    database.unsent.keep([change("a")]);

    await database.forget();
    database.keepCursor("", 5n);
    database.unsent.keep([change("b")]);

    expect(removed).toEqual([file]);
    expect(opened[0]?.raw.isOpen).toBe(false);
    expect(database.isForgotten).toBe(true);
    expect(await database.load()).toEqual({ rows: [], cursors: new Map(), opened: new Map() });
    expect(await database.unsent.load()).toEqual([]);
    expect(await launch().unsent.load()).toEqual([]);
  });

  it("keeps nothing when the database can't be opened", async () => {
    const database = launch(() => Promise.reject(new Error("No room")));

    database.keepCursor("", 5n);
    database.unsent.keep([change("a")]);

    expect(await database.load()).toEqual({ rows: [], cursors: new Map(), opened: new Map() });
    expect(await database.unsent.load()).toEqual([]);
  });
});

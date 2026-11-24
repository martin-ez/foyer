import { fromBinary, toBinary } from "@bufbuild/protobuf";
import { type Row, RowSchema } from "@foyer/shared/gen/foyer/sync/v1/sync_pb";
import type {
  HouseholdStore,
  KeptChange,
  KeptHousehold,
  KeptRow,
  UnsentChanges,
} from "./household-sync";

/** A value bound to a statement's `?`. */
export type BindValue = string | number | null | Uint8Array;

/** The part of a SQLite database, as expo-sqlite opens it, that a `HouseholdDatabase` uses. */
export type SqlDatabase = {
  execAsync(source: string): Promise<void>;
  getAllAsync<T>(source: string, params: BindValue[]): Promise<T[]>;
  prepareAsync(source: string): Promise<{
    executeAsync(params: BindValue[]): Promise<unknown>;
    finalizeAsync(): Promise<void>;
  }>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
  closeAsync(): Promise<void>;
};

/** The layout of the copy of the household's data. A database made with another layout is rebuilt
 *  from the household, keeping only the tables in `keptAcrossLayouts`. */
export const copyLayout = 1;

const keptAcrossLayouts = ["unsent_changes", "opened_pages"];

const keptTables = `
  CREATE TABLE IF NOT EXISTS unsent_changes (
    position INTEGER PRIMARY KEY AUTOINCREMENT,
    change_id TEXT NOT NULL UNIQUE,
    encoded BLOB NOT NULL,
    describe TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS opened_pages (
    page_id TEXT PRIMARY KEY,
    opened_at INTEGER NOT NULL
  ) WITHOUT ROWID;`;

const copyTables = `
  CREATE TABLE household_rows (
    kind TEXT NOT NULL,
    id TEXT NOT NULL,
    page_id TEXT,
    row BLOB NOT NULL,
    PRIMARY KEY (kind, id)
  ) WITHOUT ROWID;
  CREATE INDEX household_rows_by_page ON household_rows (page_id) WHERE page_id IS NOT NULL;
  CREATE TABLE cursors (
    page_id TEXT PRIMARY KEY,
    cursor INTEGER NOT NULL
  ) WITHOUT ROWID;`;

type Write = { source: string; values: BindValue[] };

const nothingKept: KeptHousehold = { rows: [], cursors: new Map(), opened: new Map() };

/** A device's copy of its member's household in SQLite, with the ink of the pages it keeps, when
 *  each was last opened, and unsent changes. Writes are kept in order, in one transaction for each
 *  turn of the event loop, and all or none. If the database can't be opened, nothing is kept. */
export class HouseholdDatabase implements HouseholdStore {
  /** The member's changes the household hasn't saved yet, which a rebuild keeps. */
  readonly unsent: UnsentChanges;

  readonly #database: Promise<SqlDatabase | null>;
  readonly #remove: () => Promise<void>;
  #writes: Write[] = [];
  #work: Promise<unknown> = Promise.resolve();
  #closed: Promise<void> | null = null;
  #discarding = false;

  /** `open` opens the database's file, and `remove` deletes it once it's closed. */
  constructor(open: Promise<SqlDatabase>, remove: () => Promise<void>) {
    this.#database = open.then(
      async (database) => {
        await prepare(database);
        return database;
      },
      () => null,
    );
    this.#remove = remove;
    this.unsent = {
      load: () =>
        this.#read([], async (database) => {
          const kept = await database.getAllAsync<{
            change_id: string;
            encoded: Uint8Array;
            describe: string;
          }>("SELECT change_id, encoded, describe FROM unsent_changes ORDER BY position", []);
          return kept.map(({ change_id, encoded, describe }) => ({
            changeId: change_id,
            encoded,
            describe,
          }));
        }),
      keep: (changes: KeptChange[]) => {
        for (const { changeId, encoded, describe } of changes) {
          this.#write(
            "INSERT OR IGNORE INTO unsent_changes (change_id, encoded, describe) VALUES (?, ?, ?)",
            changeId,
            encoded,
            describe,
          );
        }
      },
      forget: (changeIds: string[]) => {
        for (const changeId of changeIds) {
          this.#write("DELETE FROM unsent_changes WHERE change_id = ?", changeId);
        }
      },
    };
  }

  /** Resolves once the database is closed, after it was forgotten or kept only its unsent changes,
   *  and is null while it's open. Once closed, it keeps nothing. */
  get closed(): Promise<void> | null {
    return this.#closed;
  }

  load(): Promise<KeptHousehold> {
    return this.#read(nothingKept, async (database) => {
      const stored = await database.getAllAsync<{ row: Uint8Array }>(
        "SELECT row FROM household_rows",
        [],
      );
      const cursors = await database.getAllAsync<{ page_id: string; cursor: number }>(
        "SELECT page_id, cursor FROM cursors",
        [],
      );
      const opened = await database.getAllAsync<{ page_id: string; opened_at: number }>(
        "SELECT page_id, opened_at FROM opened_pages",
        [],
      );
      const openedAt = new Map(opened.map(({ page_id, opened_at }) => [page_id, opened_at]));
      let rows: Row[];
      try {
        rows = stored.map(({ row }) => fromBinary(RowSchema, row));
      } catch {
        return { ...nothingKept, opened: openedAt };
      }
      return {
        rows,
        cursors: new Map(cursors.map(({ page_id, cursor }) => [page_id, BigInt(cursor)])),
        opened: openedAt,
      };
    });
  }

  keepRow({ kind, id, pageId, row }: KeptRow): void {
    this.#write(
      "INSERT OR REPLACE INTO household_rows (kind, id, page_id, row) VALUES (?, ?, ?, ?)",
      kind,
      id,
      pageId,
      toBinary(RowSchema, row),
    );
  }

  forgetRow(kind: string, id: string): void {
    this.#write("DELETE FROM household_rows WHERE kind = ? AND id = ?", kind, id);
  }

  keepCursor(pageId: string, cursor: bigint): void {
    this.#write(
      "INSERT OR REPLACE INTO cursors (page_id, cursor) VALUES (?, ?)",
      pageId,
      Number(cursor),
    );
  }

  keepOpened(pageId: string, at: number): void {
    this.#write(
      "INSERT OR REPLACE INTO opened_pages (page_id, opened_at) VALUES (?, ?)",
      pageId,
      at,
    );
  }

  forgetPages(pageIds: readonly string[]): void {
    for (const pageId of pageIds) {
      if (pageId === "") continue;
      this.#write("DELETE FROM household_rows WHERE page_id = ?", pageId);
      this.#write("DELETE FROM cursors WHERE page_id = ?", pageId);
      this.#write("DELETE FROM opened_pages WHERE page_id = ?", pageId);
    }
  }

  /** Stops keeping anything, waits for what's being written, closes the database and deletes it.
   *  Resolves once it's deleted. */
  forget(): Promise<void> {
    if (!this.#closed) {
      this.#discarding = true;
      this.#writes = [];
    }
    return this.#close(this.#remove);
  }

  /** Stops keeping anything, and once what's being written is written, empties the copy and when
   *  pages were opened, keeping only the unsent changes, for the next database opened on the same
   *  file to read. Resolves once it's closed. */
  keepOnlyUnsent(): Promise<void> {
    if (!this.#closed) {
      for (const table of ["household_rows", "cursors", "opened_pages"]) {
        this.#write(`DELETE FROM ${table}`);
      }
    }
    return this.#close(async () => undefined);
  }

  #close(after: () => Promise<void>): Promise<void> {
    this.#closed ??= (async () => {
      await this.#work;
      const database = await this.#database;
      await database?.closeAsync().catch(() => undefined);
      await after().catch(() => undefined);
    })();
    return this.#closed;
  }

  #write(source: string, ...values: BindValue[]): void {
    if (this.#closed) return;
    this.#writes.push({ source, values });
    if (this.#writes.length === 1) this.#work = this.#work.then(() => this.#flush());
  }

  async #flush(): Promise<void> {
    const writes = this.#writes;
    this.#writes = [];
    const database = await this.#database;
    if (!database || writes.length === 0 || this.#discarding) return;
    const loseAllTogether = () => undefined;
    await database
      .withTransactionAsync(async () => {
        const statements = new Map<string, Awaited<ReturnType<SqlDatabase["prepareAsync"]>>>();
        try {
          for (const { source, values } of writes) {
            let statement = statements.get(source);
            if (!statement) {
              statement = await database.prepareAsync(source);
              statements.set(source, statement);
            }
            await statement.executeAsync(values);
          }
        } finally {
          for (const statement of statements.values()) await statement.finalizeAsync();
        }
      })
      .catch(loseAllTogether);
  }

  #read<T>(fallback: T, read: (database: SqlDatabase) => Promise<T>): Promise<T> {
    const result = this.#work.then(async () => {
      const database = await this.#database;
      if (!database || this.#closed) return fallback;
      return read(database).catch(() => fallback);
    });
    this.#work = result;
    return result;
  }
}

async function prepare(database: SqlDatabase): Promise<void> {
  await database.execAsync("PRAGMA journal_mode = WAL");
  await database.execAsync(keptTables);
  const [version] = await database.getAllAsync<{ user_version: number }>("PRAGMA user_version", []);
  if (version?.user_version === copyLayout) return;
  const tables = await database.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    [],
  );
  await database.withTransactionAsync(async () => {
    for (const { name } of tables) {
      if (!keptAcrossLayouts.includes(name)) await database.execAsync(`DROP TABLE "${name}"`);
    }
    await database.execAsync(copyTables);
    await database.execAsync(`PRAGMA user_version = ${copyLayout}`);
  });
}

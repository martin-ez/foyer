import { newId } from "@foyer/shared";

/** A change to the household's storage: SQL statements, or a function for a change that SQL alone
 *  can't make, such as giving new rows their ids. A function must not call code that may change
 *  later, because it has to make the same change whenever it runs. */
export type Migration = string | ((sql: SqlStorage) => void);

/** Changes to the household's storage, numbered by their position from 1. Add new ones at the end,
 *  and never change, reorder or remove one that has been merged. */
export const householdMigrations: readonly Migration[] = [
  `CREATE TABLE members (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    google_subject TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    joined_at INTEGER NOT NULL
  )`,
  `CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    member_id TEXT NOT NULL REFERENCES members (id),
    created_at INTEGER NOT NULL,
    last_used_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_by_member ON sessions (member_id)`,
  (sql) => {
    sql.exec(`CREATE TABLE spaces (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('inbox', 'personal', 'shared')),
      owner_id TEXT REFERENCES members (id),
      name TEXT,
      created_by TEXT NOT NULL REFERENCES members (id),
      created_at INTEGER NOT NULL,
      CHECK ((owner_id IS NULL) = (kind = 'shared')),
      CHECK ((name IS NULL) = (kind = 'inbox'))
    );
    CREATE UNIQUE INDEX one_inbox_per_member ON spaces (owner_id) WHERE kind = 'inbox'`);

    const now = Date.now();
    const members = sql.exec<{ id: string }>("SELECT id FROM members ORDER BY joined_at").toArray();
    for (const { id } of members) {
      for (const [kind, name] of [
        ["inbox", null],
        ["personal", "Personal"],
      ]) {
        sql.exec(
          "INSERT INTO spaces (id, kind, owner_id, name, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          newId(),
          kind,
          id,
          name,
          id,
          now,
        );
      }
    }
  },
];

/** Runs, in order, each migration the storage hasn't run yet, in its own transaction. A migration
 *  that fails is undone and stops the rest. Storage that ran newer migrations is left as it is. */
export function migrate(storage: DurableObjectStorage, migrations: readonly Migration[]): void {
  const { sql } = storage;
  sql.exec(
    "CREATE TABLE IF NOT EXISTS migrations (number INTEGER PRIMARY KEY, ran_at INTEGER NOT NULL)",
  );
  const lastRun =
    sql.exec<{ number: number | null }>("SELECT max(number) AS number FROM migrations").one()
      .number ?? 0;

  migrations.slice(lastRun).forEach((migration, index) => {
    storage.transactionSync(() => {
      if (typeof migration === "string") sql.exec(migration);
      else migration(sql);
      sql.exec(
        "INSERT INTO migrations (number, ran_at) VALUES (?, ?)",
        lastRun + index + 1,
        Date.now(),
      );
    });
  });
}

/** Changes to the household's storage, numbered by their position from 1. Add new ones at the end,
 *  and never change, reorder or remove one that has been merged. */
export const householdMigrations: readonly string[] = [
  `CREATE TABLE members (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    google_subject TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    joined_at INTEGER NOT NULL
  )`,
];

/** Runs, in order, each migration the storage hasn't run yet, in its own transaction. A migration
 *  that fails is undone and stops the rest. Storage that ran newer migrations is left as it is. */
export function migrate(storage: DurableObjectStorage, migrations: readonly string[]): void {
  const { sql } = storage;
  sql.exec(
    "CREATE TABLE IF NOT EXISTS migrations (number INTEGER PRIMARY KEY, ran_at INTEGER NOT NULL)",
  );
  const lastRun =
    sql.exec<{ number: number | null }>("SELECT max(number) AS number FROM migrations").one()
      .number ?? 0;

  migrations.slice(lastRun).forEach((statements, index) => {
    storage.transactionSync(() => {
      sql.exec(statements);
      sql.exec(
        "INSERT INTO migrations (number, ran_at) VALUES (?, ?)",
        lastRun + index + 1,
        Date.now(),
      );
    });
  });
}

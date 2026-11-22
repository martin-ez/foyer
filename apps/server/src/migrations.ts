import { newId } from "@foyer/shared";
import { isLocalBackend } from "./local";

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
  (sql) => {
    sql.exec(`CREATE TABLE household (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      seq INTEGER NOT NULL
    );
    ALTER TABLE members ADD COLUMN seq INTEGER NOT NULL DEFAULT 0;
    CREATE INDEX members_by_seq ON members (seq);
    ALTER TABLE spaces ADD COLUMN seq INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE spaces ADD COLUMN name_at INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE spaces ADD COLUMN name_change_id TEXT NOT NULL DEFAULT '';
    CREATE INDEX spaces_by_seq ON spaces (seq);
    CREATE TABLE tombstones (
      kind TEXT NOT NULL,
      id TEXT NOT NULL,
      visible_to TEXT REFERENCES members (id),
      seq INTEGER NOT NULL,
      PRIMARY KEY (kind, id)
    );
    CREATE INDEX tombstones_by_seq ON tombstones (seq);
    CREATE TABLE changes (
      id TEXT PRIMARY KEY,
      member_id TEXT NOT NULL REFERENCES members (id),
      seq INTEGER,
      refused TEXT,
      received_at INTEGER NOT NULL,
      CHECK ((seq IS NULL) != (refused IS NULL))
    );
    CREATE INDEX changes_by_received_at ON changes (received_at)`);

    let seq = 0;
    const members = sql.exec<{ id: string }>("SELECT id FROM members ORDER BY joined_at, id");
    for (const { id } of members.toArray()) {
      sql.exec("UPDATE members SET seq = ? WHERE id = ?", ++seq, id);
    }
    const spaces = sql.exec<{ id: string }>("SELECT id FROM spaces ORDER BY created_at, id");
    for (const { id } of spaces.toArray()) {
      sql.exec("UPDATE spaces SET seq = ?, name_at = created_at WHERE id = ?", ++seq, id);
    }
    sql.exec("INSERT INTO household (id, seq) VALUES (1, ?)", seq);
  },
  `CREATE TABLE pages (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('month', 'week', 'day', 'space', 'item')),
    space_id TEXT REFERENCES spaces (id),
    number INTEGER,
    item_id TEXT,
    width REAL NOT NULL CHECK (width > 0),
    height REAL NOT NULL CHECK (height > 0),
    created_by TEXT NOT NULL REFERENCES members (id),
    created_at INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    CHECK ((space_id IS NULL) = (kind != 'space')),
    CHECK ((number IS NULL) = (kind != 'space')),
    CHECK ((item_id IS NULL) = (kind != 'item'))
  );
  CREATE INDEX pages_by_seq ON pages (seq)`,
  `CREATE TABLE live_points (
    day TEXT PRIMARY KEY,
    points INTEGER NOT NULL
  )`,
  `CREATE TABLE items (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('task', 'event', 'note')),
    space_id TEXT NOT NULL REFERENCES spaces (id),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    date TEXT,
    created_by TEXT NOT NULL REFERENCES members (id),
    created_at INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    space_at INTEGER NOT NULL,
    space_change_id TEXT NOT NULL,
    title_at INTEGER NOT NULL,
    title_change_id TEXT NOT NULL,
    description_at INTEGER NOT NULL,
    description_change_id TEXT NOT NULL,
    date_at INTEGER NOT NULL,
    date_change_id TEXT NOT NULL
  );
  CREATE INDEX items_by_seq ON items (seq);
  CREATE INDEX items_by_space ON items (space_id);
  CREATE TABLE stickers (
    id TEXT PRIMARY KEY,
    page_id TEXT NOT NULL REFERENCES pages (id),
    x REAL NOT NULL,
    y REAL NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('task', 'event', 'note')),
    item_id TEXT NOT NULL REFERENCES items (id),
    placed_at INTEGER NOT NULL,
    placed_change_id TEXT NOT NULL,
    placed_by TEXT NOT NULL REFERENCES members (id),
    seq INTEGER NOT NULL
  );
  CREATE INDEX stickers_by_seq ON stickers (seq);
  CREATE INDEX stickers_by_page ON stickers (page_id);
  CREATE INDEX stickers_by_item ON stickers (item_id)`,
  `CREATE TABLE hidden_rows (
    kind TEXT NOT NULL,
    id TEXT NOT NULL,
    member_id TEXT NOT NULL REFERENCES members (id),
    seq INTEGER NOT NULL,
    PRIMARY KEY (kind, id, member_id)
  );
  CREATE INDEX hidden_rows_by_seq ON hidden_rows (seq)`,
  `CREATE TABLE completions (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES items (id),
    occurrence TEXT NOT NULL,
    done_at INTEGER NOT NULL,
    done_by TEXT NOT NULL REFERENCES members (id),
    seq INTEGER NOT NULL,
    UNIQUE (item_id, occurrence)
  );
  CREATE INDEX completions_by_seq ON completions (seq);
  CREATE TABLE last_ticks (
    item_id TEXT NOT NULL REFERENCES items (id),
    occurrence TEXT NOT NULL,
    at INTEGER NOT NULL,
    change_id TEXT NOT NULL,
    PRIMARY KEY (item_id, occurrence)
  );
  CREATE INDEX pages_by_item ON pages (item_id) WHERE item_id IS NOT NULL`,
  `ALTER TABLE items ADD COLUMN repeat TEXT;
  ALTER TABLE items ADD COLUMN repeat_from TEXT CHECK (repeat_from IN ('schedule', 'completion'));
  ALTER TABLE items ADD COLUMN repeat_at INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE items ADD COLUMN repeat_change_id TEXT NOT NULL DEFAULT '';
  ALTER TABLE completions ADD COLUMN tick_change_id TEXT`,
  `ALTER TABLE items ADD COLUMN parent_id TEXT;
  ALTER TABLE items ADD COLUMN parent_at INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE items ADD COLUMN parent_change_id TEXT NOT NULL DEFAULT '';
  CREATE INDEX items_by_parent ON items (parent_id) WHERE parent_id IS NOT NULL`,
  `CREATE TABLE capture_keys (
    id TEXT PRIMARY KEY,
    member_id TEXT NOT NULL UNIQUE REFERENCES members (id),
    token_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER
  )`,
  `CREATE TABLE google_connections (
    member_id TEXT PRIMARY KEY REFERENCES members (id),
    refresh_token TEXT NOT NULL,
    scope TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('connected', 'needs_reconnecting')),
    time_zone TEXT NOT NULL,
    connected_at INTEGER NOT NULL,
    access_token TEXT,
    access_token_expires_at INTEGER,
    seq INTEGER NOT NULL
  );
  CREATE INDEX google_connections_by_seq ON google_connections (seq);
  CREATE TABLE space_calendars (
    space_id TEXT PRIMARY KEY REFERENCES spaces (id),
    member_id TEXT NOT NULL REFERENCES members (id),
    google_calendar_id TEXT NOT NULL,
    name_in_google TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX space_calendars_by_member ON space_calendars (member_id)`,
  `PRAGMA defer_foreign_keys = on;
  CREATE TABLE old_items AS SELECT * FROM items;
  DROP TABLE items;
  CREATE TABLE items (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('task', 'event', 'note')),
    space_id TEXT NOT NULL REFERENCES spaces (id),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    date TEXT,
    created_by TEXT REFERENCES members (id),
    created_at INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    space_at INTEGER NOT NULL,
    space_change_id TEXT NOT NULL,
    title_at INTEGER NOT NULL,
    title_change_id TEXT NOT NULL,
    description_at INTEGER NOT NULL,
    description_change_id TEXT NOT NULL,
    date_at INTEGER NOT NULL,
    date_change_id TEXT NOT NULL,
    repeat TEXT,
    repeat_from TEXT CHECK (repeat_from IN ('schedule', 'completion')),
    repeat_at INTEGER NOT NULL DEFAULT 0,
    repeat_change_id TEXT NOT NULL DEFAULT '',
    parent_id TEXT,
    parent_at INTEGER NOT NULL DEFAULT 0,
    parent_change_id TEXT NOT NULL DEFAULT '',
    starts_on TEXT,
    ends_on TEXT,
    starts_at INTEGER,
    ends_at INTEGER,
    time_at INTEGER NOT NULL DEFAULT 0,
    time_change_id TEXT NOT NULL DEFAULT '',
    CHECK (created_by IS NOT NULL OR kind = 'event'),
    CHECK ((starts_on IS NULL) = (ends_on IS NULL)),
    CHECK ((starts_at IS NULL) = (ends_at IS NULL)),
    CHECK ((kind = 'event') = ((starts_on IS NULL) != (starts_at IS NULL)))
  );
  INSERT INTO items (id, kind, space_id, title, description, date, created_by, created_at, seq,
    space_at, space_change_id, title_at, title_change_id, description_at, description_change_id,
    date_at, date_change_id, repeat, repeat_from, repeat_at, repeat_change_id, parent_id, parent_at,
    parent_change_id)
  SELECT id, kind, space_id, title, description, date, created_by, created_at, seq,
    space_at, space_change_id, title_at, title_change_id, description_at, description_change_id,
    date_at, date_change_id, repeat, repeat_from, repeat_at, repeat_change_id, parent_id, parent_at,
    parent_change_id
  FROM old_items;
  DROP TABLE old_items;
  CREATE INDEX items_by_seq ON items (seq);
  CREATE INDEX items_by_space ON items (space_id);
  CREATE INDEX items_by_parent ON items (parent_id) WHERE parent_id IS NOT NULL;
  ALTER TABLE space_calendars ADD COLUMN time_zone TEXT NOT NULL DEFAULT 'UTC';
  UPDATE space_calendars SET time_zone = coalesce(
    (SELECT time_zone FROM google_connections
     WHERE google_connections.member_id = space_calendars.member_id),
    'UTC');
  ALTER TABLE space_calendars ADD COLUMN sync_token TEXT;
  ALTER TABLE space_calendars ADD COLUMN read_at INTEGER;
  ALTER TABLE space_calendars ADD COLUMN lost_at INTEGER;
  CREATE UNIQUE INDEX space_calendars_by_google_id ON space_calendars (google_calendar_id);
  CREATE TABLE google_events (
    item_id TEXT PRIMARY KEY,
    google_calendar_id TEXT NOT NULL,
    google_event_id TEXT NOT NULL,
    etag TEXT,
    fields TEXT,
    UNIQUE (google_calendar_id, google_event_id)
  );
  CREATE TABLE google_event_writes (
    item_id TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    tries INTEGER NOT NULL,
    next_attempt_at INTEGER NOT NULL
  );
  CREATE TABLE google_event_removals (
    google_calendar_id TEXT NOT NULL,
    google_event_id TEXT NOT NULL,
    tries INTEGER NOT NULL,
    next_attempt_at INTEGER NOT NULL,
    PRIMARY KEY (google_calendar_id, google_event_id)
  )`,
  `ALTER TABLE stickers ADD COLUMN occurrence TEXT;
  CREATE TABLE household_jobs (name TEXT PRIMARY KEY);
  INSERT INTO household_jobs (name) VALUES ('place calendar stickers')`,
  `ALTER TABLE items ADD COLUMN time TEXT;
  INSERT OR IGNORE INTO household_jobs (name) VALUES ('place calendar stickers')`,
  `ALTER TABLE items ADD COLUMN series_id TEXT;
  CREATE INDEX items_by_series ON items (series_id) WHERE series_id IS NOT NULL;
  CREATE TABLE google_series (
    google_calendar_id TEXT NOT NULL,
    google_event_id TEXT NOT NULL,
    series_id TEXT NOT NULL UNIQUE,
    made_until INTEGER,
    PRIMARY KEY (google_calendar_id, google_event_id)
  );
  UPDATE space_calendars SET sync_token = NULL`,
  `CREATE TABLE text_groups (
    id TEXT PRIMARY KEY,
    page_id TEXT NOT NULL REFERENCES pages (id),
    x REAL NOT NULL,
    y REAL NOT NULL,
    width REAL NOT NULL CHECK (width > 0),
    placed_at INTEGER NOT NULL,
    placed_change_id TEXT NOT NULL,
    placed_by TEXT NOT NULL REFERENCES members (id),
    width_at INTEGER NOT NULL,
    width_change_id TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES members (id),
    created_at INTEGER NOT NULL,
    seq INTEGER NOT NULL
  );
  CREATE INDEX text_groups_by_seq ON text_groups (seq);
  CREATE INDEX text_groups_by_page ON text_groups (page_id);
  CREATE TABLE text_blocks (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES text_groups (id),
    block_order TEXT NOT NULL,
    order_at INTEGER NOT NULL,
    order_change_id TEXT NOT NULL,
    markdown TEXT NOT NULL,
    markdown_at INTEGER NOT NULL,
    markdown_change_id TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES members (id),
    created_at INTEGER NOT NULL,
    seq INTEGER NOT NULL
  );
  CREATE INDEX text_blocks_by_seq ON text_blocks (seq);
  CREATE INDEX text_blocks_by_group ON text_blocks (group_id)`,
  `ALTER TABLE capture_keys ADD COLUMN captures_day TEXT;
  ALTER TABLE capture_keys ADD COLUMN captures INTEGER NOT NULL DEFAULT 0`,
];

/** Work on the household's data that needs today's code rather than the code of the migration
 *  that queued it, by adding its name to the household_jobs table. It runs after every migration,
 *  and must have no effect on storage that has nothing for it to do. */
export type HouseholdJob = (storage: DurableObjectStorage) => void;

/** Runs, each in its own transaction, the jobs that migrations queued, and forgets them. A job
 *  that fails is undone and stays queued, to run again next time. Queued jobs this code doesn't
 *  know are left for code that does. */
export function runJobs(
  storage: DurableObjectStorage,
  jobs: Readonly<Record<string, HouseholdJob>>,
): void {
  const { sql } = storage;
  const queued = sql.exec<{ name: string }>("SELECT name FROM household_jobs").toArray();
  for (const { name } of queued) {
    const job = jobs[name];
    if (!job) continue;
    try {
      storage.transactionSync(() => {
        job(storage);
        sql.exec("DELETE FROM household_jobs WHERE name = ?", name);
      });
    } catch (error) {
      console.error(`The household's job “${name}” failed: ${error}`);
    }
  }
}

/** Runs, in order, each migration the storage hasn't run yet, in its own transaction. A migration
 *  that fails is undone and stops the rest, with an error that names it by its number. Storage
 *  that ran newer migrations is left as it is. */
export function migrate(storage: DurableObjectStorage, migrations: readonly Migration[]): void {
  const { sql } = storage;
  sql.exec(
    "CREATE TABLE IF NOT EXISTS migrations (number INTEGER PRIMARY KEY, ran_at INTEGER NOT NULL)",
  );
  const lastRun =
    sql.exec<{ number: number | null }>("SELECT max(number) AS number FROM migrations").one()
      .number ?? 0;

  migrations.slice(lastRun).forEach((migration, index) => {
    const number = lastRun + index + 1;
    try {
      storage.transactionSync(() => {
        if (typeof migration === "string") sql.exec(migration);
        else migration(sql);
        sql.exec("INSERT INTO migrations (number, ran_at) VALUES (?, ?)", number, Date.now());
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const failed = `Storage change ${number} in apps/server/src/migrations.ts failed`;
      throw new Error(`${failed}: ${reason}`, { cause: error });
    }
  });
}

const startingLocallyAfresh =
  "If a branch's storage change ran here and merging main moved it later in that list, start the " +
  "local household afresh: stop the local backend, delete apps/server/.wrangler/state, which " +
  "loses everything stored locally, and start it again.";

/** Runs the household's migrations, as `migrate` does. On a local backend, the error for one that
 *  fails also says how to start the local household afresh. */
export function migrateHousehold(storage: DurableObjectStorage): void {
  try {
    migrate(storage, householdMigrations);
  } catch (error) {
    if (!isLocalBackend() || !(error instanceof Error)) throw error;
    throw new Error(`${error.message}\n${startingLocallyAfresh}`, { cause: error.cause });
  }
}

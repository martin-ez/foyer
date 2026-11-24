import { DatabaseSync } from "node:sqlite";
import type { BindValue, SqlDatabase } from "../src/sync/household-database";

/** A SQLite database file opened with Node's own SQLite, behaving as expo-sqlite's does for what a
 *  `HouseholdDatabase` uses. */
export function openNodeSqlite(path: string): SqlDatabase & { raw: DatabaseSync } {
  const raw = new DatabaseSync(path);
  const run = (source: string, params: BindValue[]) => raw.prepare(source).all(...params);
  return {
    raw,
    execAsync: async (source) => {
      raw.exec(source);
    },
    getAllAsync: async <T>(source: string, params: BindValue[]) => run(source, params) as T[],
    prepareAsync: async (source) => {
      const statement = raw.prepare(source);
      return {
        executeAsync: async (params) => statement.run(...params),
        finalizeAsync: async () => undefined,
      };
    },
    withTransactionAsync: async (task) => {
      raw.exec("BEGIN");
      try {
        await task();
        raw.exec("COMMIT");
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    },
    closeAsync: async () => {
      raw.close();
    },
  };
}

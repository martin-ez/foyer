import { deleteDatabaseAsync, openDatabaseAsync } from "expo-sqlite";
import { HouseholdDatabase } from "./household-database";
import type { HouseholdStore, UnsentChanges } from "./household-sync";

/** What a device keeps of its member's household between launches. */
export type DeviceStorage = { unsent?: UnsentChanges; store?: HouseholdStore };

const databases = new Map<string, HouseholdDatabase>();

function fileOf(memberId: string): string {
  return `household-${memberId}.db`;
}

/** On the iPad, a SQLite database of the member's own: a copy of what the household sends, the ink
 *  of the pages it keeps, and the member's unsent changes. */
export function deviceStorageOf(memberId: string): DeviceStorage {
  let database = databases.get(memberId);
  if (!database || database.isForgotten) {
    const deleted = database?.forget() ?? Promise.resolve();
    const file = fileOf(memberId);
    database = new HouseholdDatabase(
      deleted.then(() => openDatabaseAsync(file)),
      () => deleteDatabaseAsync(file),
    );
    databases.set(memberId, database);
  }
  return { unsent: database.unsent, store: database };
}

/** Deletes everything the iPad keeps for the member, as when they sign out. */
export async function forgetDeviceStorage(memberId: string): Promise<void> {
  const database = databases.get(memberId);
  if (database) return database.forget();
  await deleteDatabaseAsync(fileOf(memberId)).catch(() => undefined);
}

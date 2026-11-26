import * as SecureStore from "expo-secure-store";
import { deleteDatabaseAsync, openDatabaseAsync } from "expo-sqlite";
import { HouseholdDatabase } from "./household-database";
import type { HouseholdStore, UnsentChanges } from "./household-sync";

/** What a device keeps of its member's household between launches. */
export type DeviceStorage = { unsent?: UnsentChanges; store?: HouseholdStore };

const databases = new Map<string, HouseholdDatabase>();

const unsentOfEndedSession = "unsent-changes-of-ended-session";
const householdCopyOf = "household-copy-of";

function fileOf(memberId: string): string {
  return `household-${memberId}.db`;
}

function databaseOf(memberId: string): HouseholdDatabase {
  const earlier = databases.get(memberId);
  if (earlier && !earlier.closed) return earlier;
  const file = fileOf(memberId);
  const database = new HouseholdDatabase(
    (earlier?.closed ?? Promise.resolve()).then(() => openDatabaseAsync(file)),
    () => deleteDatabaseAsync(file),
  );
  databases.set(memberId, database);
  return database;
}

/** On the iPad, a SQLite database of the member's own: a copy of what the household sends, the ink
 *  of the pages it keeps, and the member's unsent changes. */
export function deviceStorageOf(memberId: string): DeviceStorage {
  const database = databaseOf(memberId);
  return { unsent: database.unsent, store: database };
}

/** Deletes everything the iPad keeps for the member, as when they sign out. */
export async function forgetDeviceStorage(memberId: string): Promise<void> {
  await stopHoldingCopyOf(memberId);
  const database = databases.get(memberId);
  if (database && !database.closed) return database.forget();
  await database?.closed;
  await deleteDatabaseAsync(fileOf(memberId)).catch(() => undefined);
}

/** Forgets what the iPad keeps for a member whose session the household ended, except their unsent
 *  changes, which it sends once they sign in again. If someone else signs in first, they're
 *  deleted (`forgetOtherMembers`). */
export async function forgetEndedSession(memberId: string): Promise<void> {
  await forgetEndedSessionOfOthers(memberId);
  await SecureStore.setItemAsync(unsentOfEndedSession, memberId);
  await stopHoldingCopyOf(memberId);
  await databaseOf(memberId).keepOnlyUnsent();
}

/** Forgets what the iPad keeps for anyone but the member who just signed in. A member whose session
 *  ended loses their unsent changes, which only they may send. A member someone signed in over
 *  keeps only theirs, which the iPad sends once they sign in again. */
export async function forgetOtherMembers(memberId: string): Promise<void> {
  await forgetEndedSessionOfOthers(memberId);
  const held = await SecureStore.getItemAsync(householdCopyOf);
  if (held === memberId) return;
  if (held !== null) await databaseOf(held).keepOnlyUnsent();
  await SecureStore.setItemAsync(householdCopyOf, memberId);
}

async function forgetEndedSessionOfOthers(memberId: string): Promise<void> {
  const kept = await SecureStore.getItemAsync(unsentOfEndedSession);
  if (kept === null) return;
  if (kept !== memberId) await forgetDeviceStorage(kept);
  await SecureStore.deleteItemAsync(unsentOfEndedSession);
}

async function stopHoldingCopyOf(memberId: string): Promise<void> {
  if ((await SecureStore.getItemAsync(householdCopyOf)) === memberId) {
    await SecureStore.deleteItemAsync(householdCopyOf);
  }
}

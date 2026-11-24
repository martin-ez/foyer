import { forgetUnsentChanges, unsentChangesOf } from "./browser-unsent-changes";
import type { DeviceStorage } from "./device-storage";

/** In the browser, only the member's unsent changes, in IndexedDB: what the household sends is
 *  kept in memory. */
export function deviceStorageOf(memberId: string): DeviceStorage {
  return { unsent: unsentChangesOf(memberId) };
}

/** Forgets the member's unsent changes, as when they sign out. */
export function forgetDeviceStorage(memberId: string): Promise<void> {
  return forgetUnsentChanges(memberId);
}

/** Forgets the member's unsent changes once the household ends their session: only the iPad keeps
 *  them for when the member signs in again. */
export function forgetEndedSession(memberId: string): Promise<void> {
  return forgetUnsentChanges(memberId);
}

/** Does nothing: the browser keeps each member's unsent changes apart, and never sends them as
 *  another member's. */
export async function forgetOtherMembers(_memberId: string): Promise<void> {}

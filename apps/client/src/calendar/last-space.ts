import * as SecureStore from "expo-secure-store";

const key = "calendar-space";

/** The space last picked for something added from the calendar, which the iPad keeps for itself,
 *  in the Keychain, the one place the app stores anything; or null when none was picked. */
export async function readLastSpace(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

/** Keeps the space last picked for something added from the calendar on this device. */
export async function keepLastSpace(spaceId: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, spaceId);
  } catch {}
}

import * as SecureStore from "expo-secure-store";

const key = "first-screen";

/** The first screen chosen on this iPad, which it keeps for itself in the Keychain, the one place
 *  the app stores anything; or null when none was chosen. */
export function readStoredFirstScreen(): string | null {
  try {
    return SecureStore.getItem(key);
  } catch {
    return null;
  }
}

/** Keeps the first screen chosen on this iPad. */
export function storeFirstScreen(screen: string): void {
  try {
    SecureStore.setItem(key, screen);
  } catch {}
}

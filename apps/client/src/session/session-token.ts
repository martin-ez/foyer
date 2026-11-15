import * as SecureStore from "expo-secure-store";

const key = "session-token";
let kept: string | null | undefined;

/** The session token the iPad app keeps in the Keychain, or null when nobody is signed in. */
export async function readSessionToken(): Promise<string | null> {
  kept ??= await SecureStore.getItemAsync(key);
  return kept;
}

/** Keeps a session token in the Keychain. */
export async function keepSessionToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(key, token);
  kept = token;
}

/** Forgets the session token. */
export async function forgetSessionToken(): Promise<void> {
  await SecureStore.deleteItemAsync(key);
  kept = null;
}

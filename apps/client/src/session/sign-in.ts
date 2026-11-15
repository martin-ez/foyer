import { openAuthSessionAsync } from "expo-web-browser";
import { backendUrl, sessionClient } from "../backend/backend";
import { finishSignIn, type Session } from "./session";
import { keepSessionToken } from "./session-token";

/** Signs in with Google in the system's sign-in sheet, which returns to `foyer://signed-in`. */
export async function signInWithGoogle(): Promise<Session> {
  const result = await openAuthSessionAsync(
    `${backendUrl}/auth/google?app=ipad`,
    "foyer://signed-in",
  );
  if (result.type !== "success") return { status: "signed-out" };
  return finishSignIn(result.url, sessionClient, keepSessionToken);
}

/** The iPad app is never opened by sign-in returning to it, so there's no problem to report. */
export function problemFromSignIn(): string | undefined {
  return undefined;
}

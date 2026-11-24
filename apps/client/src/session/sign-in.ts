import { openAuthSessionAsync } from "expo-web-browser";
import { backendUrl, sessionClient } from "../backend/backend";
import { finishSignIn, type Session } from "./session";
import { keepSessionToken } from "./session-token";

/** Signs in with Google in the system's sign-in sheet, which returns to `foyer://signed-in`. */
export function signInWithGoogle(): Promise<Session> {
  return signInAt(`${backendUrl}/auth/google?app=ipad`);
}

/** Signs in as `email` at the local backend's sign-in without Google, in a private sheet, which
 *  the system opens without first asking to use the backend's address. Only development builds
 *  have it. */
export const signInWithoutGoogle = __DEV__
  ? (email: string): Promise<Session> =>
      signInAt(`${backendUrl}/auth/dev?email=${encodeURIComponent(email)}&app=ipad`, {
        preferEphemeralSession: true,
      })
  : undefined;

/** Signs in with the one-time code that sign-in without Google gave a computer for the iPad at
 *  the local backend, which a real iPad can't reach at `localhost`. Only development builds have
 *  it. */
export const signInWithCode = __DEV__
  ? (code: string): Promise<Session> =>
      finishSignIn(
        `foyer://signed-in?code=${encodeURIComponent(code)}`,
        sessionClient,
        keepSessionToken,
      )
  : undefined;

async function signInAt(
  address: string,
  options?: { preferEphemeralSession: boolean },
): Promise<Session> {
  const result = await openAuthSessionAsync(address, "foyer://signed-in", options);
  if (result.type !== "success") return { status: "signed-out" };
  return finishSignIn(result.url, sessionClient, keepSessionToken);
}

/** The iPad app is never opened by sign-in returning to it, so there's no problem to report. */
export function problemFromSignIn(): string | undefined {
  return undefined;
}

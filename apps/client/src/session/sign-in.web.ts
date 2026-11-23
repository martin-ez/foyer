import { describeSignInError, type Session } from "./session";

const errorParameter = "sign-in-error";

/** Leaves the web app for Google, which returns to the app once the backend has set the session's
 *  cookie. The page is replaced, so this never resolves. */
export function signInWithGoogle(): Promise<Session> {
  window.location.assign("/auth/google");
  return new Promise(() => {});
}

/** The web app offers no way to sign in without Google: open the backend's `/auth/dev` instead. */
export const signInWithoutGoogle = undefined;

/** Why sign-in just returned to the web app without signing the person in, if it did. Reading it
 *  removes it from the address, so it's reported once. */
export function problemFromSignIn(): string | undefined {
  const address = new URL(window.location.href);
  const error = address.searchParams.get(errorParameter);
  if (!error) return undefined;
  address.searchParams.delete(errorParameter);
  window.history.replaceState(window.history.state, "", address);
  return describeSignInError(error);
}

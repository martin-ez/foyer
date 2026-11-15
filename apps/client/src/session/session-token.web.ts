/** The web app keeps no session token: the browser holds the session in a cookie that scripts
 *  can't read, and sends it on every call. */
export async function readSessionToken(): Promise<string | null> {
  return null;
}

/** Does nothing on the web, where the backend sets the session's cookie. */
export async function keepSessionToken(_token: string): Promise<void> {}

/** Does nothing on the web, where the backend removes the session's cookie when signing out. */
export async function forgetSessionToken(): Promise<void> {}

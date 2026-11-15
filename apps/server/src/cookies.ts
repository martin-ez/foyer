/** The cookie that holds a web session's token. */
export const sessionCookieName = "foyer_session";

const sessionCookieLifetimeSeconds = 90 * 24 * 60 * 60;

/** Sets the web session's cookie, which lasts as long as an unused session does. Only the backend
 *  reads it, and only from the backend's own site. */
export function sessionCookie(token: string, url: URL): string {
  return cookie(sessionCookieName, token, { path: "/", maxAge: sessionCookieLifetimeSeconds, url });
}

/** Removes the web session's cookie. */
export function removedSessionCookie(url: URL): string {
  return cookie(sessionCookieName, "", { path: "/", maxAge: 0, url });
}

/** Writes a cookie that scripts can't read and other sites can't send. It's marked secure whenever
 *  the backend is reached over HTTPS. */
export function cookie(
  name: string,
  value: string,
  options: { path: string; maxAge: number; url: URL },
): string {
  const attributes = [
    `${name}=${value}`,
    `Path=${options.path}`,
    `Max-Age=${options.maxAge}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (options.url.protocol === "https:") attributes.push("Secure");
  return attributes.join("; ");
}

/** The value of a cookie that a request carries, or null. */
export function readCookie(headers: Headers, name: string): string | null {
  for (const pair of headers.get("Cookie")?.split(";") ?? []) {
    const [key, ...value] = pair.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

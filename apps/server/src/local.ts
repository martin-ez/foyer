import { env } from "cloudflare:workers";

/** Whether this is a local backend, run on a computer for development or tests, where people may
 *  sign in without Google. A deployed backend never is. */
export function isLocalBackend(): boolean {
  return env.DEV_SIGN_IN === "1";
}

/** Whether a request was made to this computer, as it is to the local backend. */
export function isLocalAddress(url: URL): boolean {
  return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

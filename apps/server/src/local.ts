/** Whether a request was made to this computer, as it is to the local backend. */
export function isLocalAddress(url: URL): boolean {
  return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

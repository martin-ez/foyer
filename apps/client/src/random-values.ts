type GetRandomValues = <T extends Uint8Array>(array: T) => T;

/** Gives a runtime without Web Crypto, such as the iPad app's, `crypto.getRandomValues`, which
 *  shared code makes ids with. A runtime that has its own keeps it. */
export function provideRandomValues(getRandomValues: GetRandomValues): void {
  const runtime = globalThis as { crypto?: { getRandomValues?: unknown } };
  if (typeof runtime.crypto?.getRandomValues === "function") return;
  runtime.crypto = { ...runtime.crypto, getRandomValues };
}

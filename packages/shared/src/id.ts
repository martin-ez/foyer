declare const crypto: { getRandomValues<T extends Uint8Array>(array: T): T };

/** Makes a new id: a UUID version 7, as a lowercase string. It starts with the time it was made,
 *  so ids sort by when they were made, to the millisecond, and the rest is random. Runtimes without
 *  Web Crypto, such as the iPad app's, must provide `crypto.getRandomValues` first. */
export function newId(): string {
  const time = Date.now().toString(16).padStart(12, "0");
  const random = Array.from(crypto.getRandomValues(new Uint8Array(10)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const variant = (0x8 | (Number.parseInt(random.charAt(3), 16) & 0x3)).toString(16);

  return [
    time.slice(0, 8),
    time.slice(8),
    `7${random.slice(0, 3)}`,
    `${variant}${random.slice(4, 7)}`,
    random.slice(7, 19),
  ].join("-");
}

/** Whether a value is an id as `newId` makes them: a UUID version 7, as a lowercase string. */
export function isId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

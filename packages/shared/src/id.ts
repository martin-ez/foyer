declare const crypto: { getRandomValues<T extends Uint8Array>(array: T): T };

const highLimit = 2 ** 26;
const lowLimit = 2 ** 48;

type Made = { time: number; high: number; low: number };

let last: Made = { time: -1, high: 0, low: 0 };

/** Makes a new id: a UUID version 7, as a lowercase string, starting with the time it was made.
 *  Ids from one runtime increase in the order they're made, even within a millisecond or after
 *  the clock goes back. Runtimes without Web Crypto must provide `crypto.getRandomValues` first. */
export function newId(): string {
  const now = Date.now();
  last = now > last.time ? { time: now, ...randomBits() } : following(last);
  const time = last.time.toString(16).padStart(12, "0");

  return [
    time.slice(0, 8),
    time.slice(8),
    `7${(last.high >>> 14).toString(16).padStart(3, "0")}`,
    (0x8000 | (last.high & 0x3fff)).toString(16),
    last.low.toString(16).padStart(12, "0"),
  ].join("-");
}

/** Whether a value is an id as `newId` makes them: a UUID version 7, as a lowercase string. */
export function isId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

function randomBits(): Omit<Made, "time"> {
  const bytes = Array.from(crypto.getRandomValues(new Uint8Array(10)));
  return { high: toNumber(bytes.slice(0, 4)) % highLimit, low: toNumber(bytes.slice(4)) };
}

function following({ time, high, low }: Made): Made {
  if (low + 1 < lowLimit) return { time, high, low: low + 1 };
  if (high + 1 < highLimit) return { time, high: high + 1, low: 0 };
  return { time: time + 1, high: 0, low: 0 };
}

function toNumber(bytes: number[]): number {
  return bytes.reduce((number, byte) => number * 256 + byte, 0);
}

/** Makes a new secret, such as a session token: 32 random bytes, written in base64url. */
export function newSecret(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/** The SHA-256 hash of a secret, written in lowercase hex. */
export async function hashSecret(secret: string): Promise<string> {
  const digest = await sha256(secret);
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The SHA-256 hash of a text's UTF-8 bytes. */
export async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

/** Writes bytes in base64url, without padding. */
export function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

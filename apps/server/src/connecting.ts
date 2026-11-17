import type { ConnectingResult } from "./calendars";
import { type GoogleClient, googleCallbackPath } from "./google";
import { calendarClient, connectingAddress } from "./google-calendar";
import { theHousehold } from "./household";
import { newSecret, sha256, toBase64Url } from "./secrets";

/** The app a person connects Google Calendar from, which they return to. */
export type ConnectingApp = "web" | "ipad";

const statePrefix = "calendar.";
const connectingLifetime = 10 * 60 * 1000;
const keyLabel = "Foyer: connecting Google Calendar";

type Connecting = { memberId: string; app: ConnectingApp; timeZone: string; expiresAt: number };

/** The address that asks Google for access to a member's calendars, returning to `app`, or null
 *  when Google isn't set up. Who is connecting travels in its signed `state`, valid for 10 minutes,
 *  so it works from the iPad's sign-in sheet, which carries no session. */
export async function startConnecting(
  url: URL,
  memberId: string,
  app: ConnectingApp,
  timeZone: string,
): Promise<string | null> {
  const client = calendarClient();
  if (!client) return null;
  const connecting: Connecting = {
    memberId,
    app,
    timeZone,
    expiresAt: Date.now() + connectingLifetime,
  };
  const payload = encode(JSON.stringify({ ...connecting, nonce: newSecret() }));
  const key = await signingKey(client);
  const state = `${statePrefix}${payload}.${await sign(key, payload)}`;
  const codeVerifier = await sign(key, `verifier.${payload}`);
  return connectingAddress(client, {
    origin: url.origin,
    redirectUri: `${url.origin}${googleCallbackPath}`,
    state,
    codeChallenge: toBase64Url(await sha256(codeVerifier)),
    accountHint: (await theHousehold().googleSubjectOf(memberId)) ?? "",
  });
}

/** Whether Google returned to the backend after connecting Google Calendar, rather than after
 *  signing in. */
export function isConnecting(url: URL): boolean {
  return url.searchParams.get("state")?.startsWith(statePrefix) ?? false;
}

/** Finishes connecting Google Calendar once Google returns to the backend, and returns to the app
 *  the person connected from: with `google-calendar-error` to the web app's first page, or with
 *  `error` to `foyer://google-calendar` on the iPad, unless it connected or the person cancelled. */
export async function finishConnecting(url: URL): Promise<Response> {
  const client = calendarClient();
  const state = url.searchParams.get("state") ?? "";
  const connecting = client ? await readState(client, state) : null;
  if (!client || !connecting) return returnToApp(url, "web", "failed");
  if (url.searchParams.get("error") === "access_denied") return returnToApp(url, connecting.app);
  const code = url.searchParams.get("code");
  if (!code) return returnToApp(url, connecting.app, "failed");

  const payload = state.slice(statePrefix.length).split(".")[0] ?? "";
  const result = await theHousehold().connectGoogle(connecting.memberId, {
    code,
    codeVerifier: await sign(await signingKey(client), `verifier.${payload}`),
    redirectUri: `${url.origin}${googleCallbackPath}`,
    timeZone: connecting.timeZone,
  });
  return returnToApp(url, connecting.app, result === "connected" ? undefined : result);
}

async function readState(client: GoogleClient, state: string): Promise<Connecting | null> {
  const [payload = "", signature = ""] = state.slice(statePrefix.length).split(".");
  const key = await signingKey(client);
  const signed = await crypto.subtle
    .verify("HMAC", key, decodeBytes(signature), new TextEncoder().encode(payload))
    .catch(() => false);
  if (!signed) return null;
  const connecting = JSON.parse(new TextDecoder().decode(decodeBytes(payload))) as Connecting;
  return connecting.expiresAt > Date.now() ? connecting : null;
}

function returnToApp(
  url: URL,
  app: ConnectingApp,
  error?: Exclude<ConnectingResult, "connected">,
): Response {
  const address = new URL(app === "ipad" ? "foyer://google-calendar" : `${url.origin}/`);
  if (error) address.searchParams.set(app === "ipad" ? "error" : "google-calendar-error", error);
  return new Response(null, {
    status: 302,
    headers: { Location: address.toString(), "Cache-Control": "no-store" },
  });
}

async function signingKey(client: GoogleClient): Promise<CryptoKey> {
  const hmac = { name: "HMAC", hash: "SHA-256" };
  const secret = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(client.secret),
    hmac,
    false,
    ["sign"],
  );
  const derived = await crypto.subtle.sign("HMAC", secret, new TextEncoder().encode(keyLabel));
  return crypto.subtle.importKey("raw", derived, hmac, false, ["sign", "verify"]);
}

async function sign(key: CryptoKey, text: string): Promise<string> {
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  return toBase64Url(new Uint8Array(signature));
}

function encode(text: string): string {
  return toBase64Url(new TextEncoder().encode(text));
}

function decodeBytes(text: string): Uint8Array {
  try {
    const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return new Uint8Array();
  }
}

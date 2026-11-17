import { env, exports, withEnv } from "cloudflare:workers";
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { CaptureService } from "@foyer/shared/gen/foyer/capture/v1/capture_pb";
import { SessionService } from "@foyer/shared/gen/foyer/session/v1/session_pb";
import { vi } from "vitest";
import worker from "../src/index";

/** Where the deployed backend answers in tests. */
export const backendUrl = "https://foyer.test";

/** Where the local backend answers in tests. */
export const localBackendUrl = "http://localhost:8787";

const redirectModeTheWorkersRuntimeAccepts: RequestInit["redirect"] = "manual";

/** Makes a request to the backend, as a browser or an app would. */
export function requestBackend(url: string, init: RequestInit = {}): Promise<Response> {
  return exports.default.fetch(
    new Request(url, { ...init, redirect: redirectModeTheWorkersRuntimeAccepts }),
  );
}

/** Makes a request to the backend while some of its settings are changed. Only the Worker sees
 *  the change, not the household. */
export async function requestBackendWith(
  settings: Partial<Cloudflare.Env>,
  url: string,
): Promise<Response> {
  return (await withEnv({ ...env, ...settings }, () => worker.fetch(new Request(url)))) as Response;
}

/** Calls the backend's session service. */
export function sessionClient() {
  return createClient(SessionService, backendTransport());
}

/** Calls the backend's capture service. */
export function captureClient() {
  return createClient(CaptureService, backendTransport());
}

function backendTransport() {
  return createConnectTransport({
    baseUrl: backendUrl,
    fetch: (input, init) => requestBackend(input.toString(), init),
  });
}

/** A Google account, as Google's ID token describes it. */
export type GoogleClaims = {
  sub: string;
  email: string;
  email_verified?: boolean;
  given_name?: string;
  name?: string;
  aud?: string;
  iss?: string;
  exp?: number;
};

/** The account that signs in with Google in tests, on the allowlist. */
export const member: GoogleClaims = {
  sub: "100000000000000000001",
  email: "member@example.com",
  email_verified: true,
  given_name: "Alex",
  name: "Alex Doe",
};

/** Makes Google's token endpoint answer with an ID token for an account, and returns what the
 *  Worker sent it. Every other request still goes out. */
export function googleSigningIn(claims: GoogleClaims, status = 200) {
  const realFetch = globalThis.fetch;
  const requests: URLSearchParams[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    if (request.url !== "https://oauth2.googleapis.com/token") return realFetch(input, init);
    requests.push(new URLSearchParams(new TextDecoder().decode(await request.arrayBuffer())));
    if (status !== 200) return Response.json({ error: "invalid_grant" }, { status });
    return Response.json({ id_token: idToken(claims), token_type: "Bearer" });
  });
  return requests;
}

function idToken(claims: GoogleClaims): string {
  const payload = {
    aud: env.GOOGLE_CLIENT_ID,
    iss: "https://accounts.google.com",
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...claims,
  };
  return [{ alg: "RS256", typ: "JWT" }, payload, "signature"]
    .map((part) => base64Url(typeof part === "string" ? part : JSON.stringify(part)))
    .join(".");
}

function base64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

/** Signs in with Google from the start, as a browser would: opens `/auth/google`, comes back from
 *  Google with a code, and returns where the backend then sends the browser. */
export async function signInWithGoogle(
  claims: GoogleClaims,
  options: {
    app?: "ipad";
    tamper?: (callback: URL) => void;
    keepCookie?: boolean;
    googleStatus?: number;
  } = {},
) {
  const start = await requestBackend(
    `${backendUrl}/auth/google${options.app ? `?app=${options.app}` : ""}`,
  );
  const google = new URL(start.headers.get("Location") ?? "");
  const pending = cookiesSetBy(start).find((cookie) => cookie.startsWith("foyer_sign_in="));

  const callback = new URL(google.searchParams.get("redirect_uri") ?? "");
  callback.searchParams.set("code", "google-code");
  callback.searchParams.set("state", google.searchParams.get("state") ?? "");
  options.tamper?.(callback);

  const tokenRequests = googleSigningIn(claims, options.googleStatus);
  const returned = await requestBackend(callback.toString(), {
    headers: options.keepCookie === false ? {} : { Cookie: pending?.split(";")[0] ?? "" },
  });
  return { start, google, returned, tokenRequests };
}

/** The cookies a response sets, each as its `Set-Cookie` value. */
export function cookiesSetBy(response: Response): string[] {
  return response.headers.getSetCookie();
}

/** The web session cookie a response sets, as a `Cookie` header would carry it, or undefined. */
export function sessionCookieSetBy(response: Response): string | undefined {
  return cookiesSetBy(response)
    .find((cookie) => cookie.startsWith("foyer_session="))
    ?.split(";")[0];
}

/** The cookie a response sets with a name: its `value`, and its attributes by lowercase name. */
export function cookieSetBy(
  response: Response,
  name: string,
): Record<string, string | true> | undefined {
  const set = cookiesSetBy(response).find((cookie) => cookie.startsWith(`${name}=`));
  if (!set) return undefined;
  const [pair = "", ...attributes] = set.split(";").map((part) => part.trim());
  return Object.fromEntries([
    ["value", pair.slice(name.length + 1)],
    ...attributes.map((attribute) => {
      const [key = "", value] = attribute.split("=");
      return [key.toLowerCase(), value ?? true];
    }),
  ]);
}

/** Where a redirect sends the browser. */
export function locationOf(response: Response): URL {
  return new URL(response.headers.get("Location") ?? "");
}

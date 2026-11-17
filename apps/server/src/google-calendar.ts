import { env } from "cloudflare:workers";
import { answerAsFakeGoogle } from "./fake-google";
import { type GoogleClient, googleClient, readIdToken } from "./google";

/** The permission Foyer asks for to make and use calendars: only those it creates itself. */
export const calendarScope = "https://www.googleapis.com/auth/calendar.app.created";

const authorizationEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
const fakeAuthorizationPath = "/auth/dev/google";
const tokenEndpoint = "https://oauth2.googleapis.com/token";
const revocationEndpoint = "https://oauth2.googleapis.com/revoke";
const calendarsEndpoint = "https://www.googleapis.com/calendar/v3/calendars";

const fakeClient: GoogleClient = { id: "fake-google-client", secret: "fake-google-client-secret" };

/** Whether connecting Google Calendar uses the fake Google in `fake-google.ts` instead of Google:
 *  wherever people can sign in without Google, that is locally and in tests. */
export function usesFakeGoogle(): boolean {
  return env.DEV_SIGN_IN === "1";
}

/** The client that asks for calendar access: the one people sign in with, or, with the fake Google,
 *  a stand-in when that isn't set. Null, logging why, when Google isn't set up. */
export function calendarClient(): GoogleClient | null {
  if (!usesFakeGoogle()) return googleClient();
  const id = env.GOOGLE_CLIENT_ID?.trim();
  const secret = env.GOOGLE_CLIENT_SECRET?.trim();
  return id && secret ? { id, secret } : fakeClient;
}

/** The address that asks Google for lasting access to the calendars Foyer creates, and who the
 *  account is, preferring the account `accountHint` names. With the fake Google, it's the fake's
 *  page on the backend at `origin`. */
export function connectingAddress(
  client: GoogleClient,
  request: {
    origin: string;
    redirectUri: string;
    state: string;
    codeChallenge: string;
    accountHint: string;
  },
): string {
  const address = new URL(
    usesFakeGoogle() ? `${request.origin}${fakeAuthorizationPath}` : authorizationEndpoint,
  );
  const parameters = new URLSearchParams({
    client_id: client.id,
    redirect_uri: request.redirectUri,
    response_type: "code",
    scope: `openid ${calendarScope}`,
    access_type: "offline",
    prompt: "consent",
    state: request.state,
    code_challenge: request.codeChallenge,
    code_challenge_method: "S256",
  });
  if (request.accountHint) parameters.set("login_hint", request.accountHint);
  address.search = parameters.toString();
  return address.toString();
}

/** Access to a Google account's calendars that Google granted. */
export type GrantedAccess = {
  /** Google's id for the account. */
  subject: string;
  /** The permissions granted, which may leave out some that were asked for. */
  scopes: string[];
  refreshToken: string | null;
  accessToken: string;
  expiresAt: number;
};

/** Exchanges the code that Google sent back for the access it grants. Throws when Google refuses
 *  the code or its answer isn't for this client. */
export async function grantedAccessFor(
  client: GoogleClient,
  answer: { code: string; codeVerifier: string; redirectUri: string },
): Promise<GrantedAccess> {
  const response = await askGoogle(
    new Request(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: answer.code,
        code_verifier: answer.codeVerifier,
        client_id: client.id,
        client_secret: client.secret,
        redirect_uri: answer.redirectUri,
        grant_type: "authorization_code",
      }),
    }),
  );
  if (!response.ok) {
    throw new Error(`Google refused the code, with ${response.status}: ${await response.text()}`);
  }
  const granted = (await response.json()) as TokenAnswer;
  if (typeof granted.id_token !== "string") throw new Error("Google's answer has no ID token");
  const claims = readIdToken(granted.id_token);
  if (claims.aud !== client.id) throw new Error("Google's ID token is for another client");
  if (typeof claims.sub !== "string") throw new Error("Google's ID token has no account id");
  const { accessToken, expiresAt } = accessIn(granted);
  return {
    subject: claims.sub,
    scopes: typeof granted.scope === "string" ? granted.scope.split(" ") : [],
    refreshToken: typeof granted.refresh_token === "string" ? granted.refresh_token : null,
    accessToken,
    expiresAt,
  };
}

/** What became of asking Google for something: its answer, or that it no longer accepts Foyer's
 *  access, or that it failed for another reason, which may pass. */
export type GoogleAnswer<T> = { ok: T } | { revoked: true } | { failed: string };

/** A new access token for the access a refresh token holds, or that Google no longer accepts it. */
export async function refreshAccess(
  client: GoogleClient,
  refreshToken: string,
): Promise<GoogleAnswer<{ accessToken: string; expiresAt: number }>> {
  const response = await askGoogleSafely(
    new Request(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: client.id,
        client_secret: client.secret,
        grant_type: "refresh_token",
      }),
    }),
  );
  if ("failed" in response) return response;
  const { ok } = response;
  if (ok.status === 400 || ok.status === 401) {
    const { error } = (await ok.json().catch(() => ({}))) as { error?: unknown };
    if (error === "invalid_grant") return { revoked: true };
  }
  if (!ok.ok) return { failed: `Google answered ${ok.status} to a refresh` };
  return { ok: accessIn((await ok.json()) as TokenAnswer) };
}

/** Revokes a token and the access it belongs to, so Google stops accepting any of its tokens. */
export async function revokeAccess(token: string): Promise<GoogleAnswer<null>> {
  const response = await askGoogleSafely(
    new Request(revocationEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    }),
  );
  if ("failed" in response) return response;
  if (response.ok.ok || response.ok.status === 400) return { ok: null };
  return { failed: `Google answered ${response.ok.status} to a revocation` };
}

/** What became of a call to Google's Calendar API: as `GoogleAnswer`, or that the calendar no
 *  longer exists, or that Google didn't accept the access token, which a fresh one may fix. */
export type CalendarAnswer<T> = GoogleAnswer<T> | { gone: true } | { unauthorized: true };

/** Creates a calendar in the account an access token is for, and returns Google's id for it. */
export async function createCalendar(
  accessToken: string,
  calendar: { name: string; timeZone: string },
): Promise<CalendarAnswer<string>> {
  const answer = await callCalendars(accessToken, calendarsEndpoint, "POST", {
    summary: calendar.name,
    timeZone: calendar.timeZone,
  });
  if (!("ok" in answer)) return answer;
  const { id } = answer.ok as { id?: unknown };
  return typeof id === "string" ? { ok: id } : { failed: "Google's new calendar has no id" };
}

/** Renames a calendar that Foyer created. */
export async function renameCalendar(
  accessToken: string,
  calendarId: string,
  name: string,
): Promise<CalendarAnswer<null>> {
  const address = `${calendarsEndpoint}/${encodeURIComponent(calendarId)}`;
  const answer = await callCalendars(accessToken, address, "PATCH", { summary: name });
  return "ok" in answer ? { ok: null } : answer;
}

type TokenAnswer = {
  access_token?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
  scope?: unknown;
  id_token?: unknown;
};

function accessIn(granted: TokenAnswer): { accessToken: string; expiresAt: number } {
  if (typeof granted.access_token !== "string") {
    throw new Error("Google's answer has no access token");
  }
  const lifetime = typeof granted.expires_in === "number" ? granted.expires_in : 0;
  return { accessToken: granted.access_token, expiresAt: Date.now() + lifetime * 1000 };
}

async function callCalendars(
  accessToken: string,
  address: string,
  method: string,
  body: unknown,
): Promise<CalendarAnswer<unknown>> {
  const response = await askGoogleSafely(
    new Request(address, {
      method,
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  if ("failed" in response) return response;
  const { ok } = response;
  if (ok.status === 401) return { unauthorized: true };
  if (ok.status === 404 || ok.status === 410) return { gone: true };
  if (!ok.ok) return { failed: `Google's Calendar API answered ${ok.status}` };
  return { ok: await ok.json() };
}

async function askGoogleSafely(request: Request): Promise<{ ok: Response } | { failed: string }> {
  try {
    return { ok: await askGoogle(request) };
  } catch (error) {
    return { failed: `Couldn't reach Google: ${error}` };
  }
}

function askGoogle(request: Request): Promise<Response> {
  return usesFakeGoogle() ? answerAsFakeGoogle(request) : fetch(request);
}

import { newId } from "@foyer/shared";
import { toBase64Url } from "./secrets";

/** A calendar that the fake Google holds: the account it's in, its name and its time zone. */
export type FakeCalendar = { subject: string; name: string; timeZone: string };

/** The account that the fake Google's page offers besides the one asked for. */
export const fakeOtherAccount = "fake-google-other-account";

/** Stands in for the parts of Google that connecting Google Calendar uses: its token and
 *  revocation endpoints and the Calendar API's calendars, so that agents, web checks and tests can
 *  connect without Google. Its codes and tokens name the account they're for, so they keep working
 *  after the backend restarts; what it holds besides, such as calendars and revoked access, is kept
 *  in memory. */
export class FakeGoogle {
  /** The calendars it holds, by id. */
  readonly calendars = new Map<string, FakeCalendar>();
  /** While true, every request fails, as when Google can't be reached. */
  down = false;
  readonly #grants = new Map<string, string>();
  readonly #revoked = new Set<string>();

  /** A code that the token endpoint exchanges for access to an account, with the permissions in
   *  `scope`, separated by spaces. */
  codeFor(subject: string, scope: string): string {
    return `fake-code.${encode(JSON.stringify({ subject, scope }))}`;
  }

  /** Stops accepting every access given to an account so far, as when its owner removes Foyer's
   *  access in their Google account. */
  revokeAccessOf(subject: string): void {
    for (const [grant, holder] of this.#grants) if (holder === subject) this.#revoked.add(grant);
  }

  /** Whether any access given to an account is still accepted. */
  hasAccess(subject: string): boolean {
    return [...this.#grants].some(
      ([grant, holder]) => holder === subject && !this.#revoked.has(grant),
    );
  }

  /** The calendars in an account. */
  calendarsOf(subject: string): FakeCalendar[] {
    return [...this.calendars.values()].filter((calendar) => calendar.subject === subject);
  }

  /** Forgets everything, as a fresh start would. */
  reset(): void {
    this.calendars.clear();
    this.#grants.clear();
    this.#revoked.clear();
    this.down = false;
  }

  /** Answers a request made to Google, as Google would. */
  async answer(request: Request): Promise<Response> {
    if (this.down) return new Response("Google is down", { status: 503 });
    const url = new URL(request.url);
    const address = `${url.origin}${url.pathname}`;
    if (address === "https://oauth2.googleapis.com/token" && request.method === "POST") {
      return this.#token(await formIn(request));
    }
    if (address === "https://oauth2.googleapis.com/revoke" && request.method === "POST") {
      return this.#revoke(await formIn(request));
    }
    if (url.origin === "https://www.googleapis.com" && url.pathname.startsWith(calendarsPath)) {
      return this.#calendarsCall(request, url);
    }
    return new Response(null, { status: 404 });
  }

  #token(form: URLSearchParams): Response {
    if (form.get("grant_type") === "authorization_code") {
      const granted = decodeCode(form.get("code") ?? "");
      if (!granted) return Response.json({ error: "invalid_grant" }, { status: 400 });
      const grant = newId();
      this.#grants.set(grant, granted.subject);
      const idToken = [{ alg: "none" }, idClaims(granted.subject, form.get("client_id") ?? "")]
        .map((part) => encode(JSON.stringify(part)))
        .concat("fake-signature")
        .join(".");
      return Response.json({
        access_token: token("access", granted.subject, grant),
        expires_in: accessLifetimeSeconds,
        refresh_token: token("refresh", granted.subject, grant),
        scope: granted.scope,
        token_type: "Bearer",
        id_token: idToken,
      });
    }
    if (form.get("grant_type") === "refresh_token") {
      const held = this.#accepted(form.get("refresh_token") ?? "", "refresh");
      if (!held) return Response.json({ error: "invalid_grant" }, { status: 400 });
      return Response.json({
        access_token: token("access", held.subject, held.grant),
        expires_in: accessLifetimeSeconds,
        token_type: "Bearer",
      });
    }
    return Response.json({ error: "unsupported_grant_type" }, { status: 400 });
  }

  #revoke(form: URLSearchParams): Response {
    const read = readToken(form.get("token") ?? "");
    if (!read) return Response.json({ error: "invalid_token" }, { status: 400 });
    this.#revoked.add(read.grant);
    return new Response(null, { status: 200 });
  }

  async #calendarsCall(request: Request, url: URL): Promise<Response> {
    const bearer = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    const held = this.#accepted(bearer, "access");
    if (!held) return Response.json({ error: { code: 401 } }, { status: 401 });
    const calendarId = decodeURIComponent(url.pathname.slice(calendarsPath.length + 1));
    const body = (await request.json().catch(() => ({}))) as {
      summary?: unknown;
      timeZone?: unknown;
    };

    if (calendarId === "" && request.method === "POST") {
      const id = `fake-${newId()}@group.calendar.google.com`;
      const calendar = {
        subject: held.subject,
        name: String(body.summary ?? ""),
        timeZone: String(body.timeZone ?? "UTC"),
      };
      this.calendars.set(id, calendar);
      return Response.json(calendarAnswer(id, calendar));
    }
    const calendar = this.calendars.get(calendarId);
    if (!calendar || calendar.subject !== held.subject) {
      return Response.json({ error: { code: 404 } }, { status: 404 });
    }
    if (request.method === "PATCH") {
      if (typeof body.summary === "string") calendar.name = body.summary;
      return Response.json(calendarAnswer(calendarId, calendar));
    }
    if (request.method === "GET") return Response.json(calendarAnswer(calendarId, calendar));
    return new Response(null, { status: 405 });
  }

  #accepted(text: string, kind: "access" | "refresh"): { subject: string; grant: string } | null {
    const read = readToken(text);
    if (!read || read.kind !== kind || this.#revoked.has(read.grant)) return null;
    return read.expiresAt > Date.now() ? read : null;
  }
}

/** The fake Google that the backend asks while `usesFakeGoogle()` says so. */
export const fakeGoogle = new FakeGoogle();

/** Answers a request made to Google with the fake Google. */
export function answerAsFakeGoogle(request: Request): Promise<Response> {
  return fakeGoogle.answer(request);
}

/** The fake Google's page that asks for calendar access, where the backend sends people to connect
 *  locally. It offers to continue as the account asked for, as another account, or without calendar
 *  access, and to cancel. Each returns to the backend as Google would. */
export function fakeConsentPage(url: URL): Response {
  const redirectUri = url.searchParams.get("redirect_uri") ?? "";
  if (!redirectUri.startsWith(`${url.origin}/`)) return new Response(null, { status: 400 });
  const state = url.searchParams.get("state") ?? "";
  const scope = url.searchParams.get("scope") ?? "";
  const account = url.searchParams.get("login_hint") || "fake-google-account";
  const back = (parameters: Record<string, string>) => {
    const address = new URL(redirectUri);
    for (const [name, value] of Object.entries({ ...parameters, state })) {
      address.searchParams.set(name, value);
    }
    return escapeHtml(address.toString());
  };
  const choices = [
    [`Continue as ${account}`, back({ code: fakeGoogle.codeFor(account, scope) })],
    ["Continue with another account", back({ code: fakeGoogle.codeFor(fakeOtherAccount, scope) })],
    ["Continue without calendar access", back({ code: fakeGoogle.codeFor(account, "openid") })],
    ["Cancel", back({ error: "access_denied" })],
  ];
  const page = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Fake Google</title></head>
<body style="font-family: sans-serif; padding: 24px">
<h1>Fake Google</h1>
<p>Stands in for Google while developing Foyer. Foyer asks to see, create, change and delete the calendars it creates.</p>
<ul>${choices.map(([label, href]) => `<li><a href="${href}">${escapeHtml(label ?? "")}</a></li>`).join("")}</ul>
</body>
</html>`;
  return new Response(page, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

const calendarsPath = "/calendar/v3/calendars";

async function formIn(request: Request): Promise<URLSearchParams> {
  return new URLSearchParams(new TextDecoder().decode(await request.arrayBuffer()));
}

function calendarAnswer(id: string, calendar: FakeCalendar) {
  return { kind: "calendar#calendar", id, summary: calendar.name, timeZone: calendar.timeZone };
}

function idClaims(subject: string, clientId: string) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return { iss: "https://accounts.google.com", aud: clientId, sub: subject, exp };
}

const accessLifetimeSeconds = 3600;

function token(kind: "access" | "refresh", subject: string, grant: string): string {
  const parts = [`fake-${kind}`, encode(subject), grant];
  const expiresAt = Date.now() + accessLifetimeSeconds * 1000;
  return (kind === "access" ? [...parts, String(expiresAt), newId()] : parts).join(".");
}

function readToken(
  text: string,
): { kind: string; subject: string; grant: string; expiresAt: number } | null {
  const [prefix = "", subject = "", grant = "", expiresAt = ""] = text.split(".");
  const kind = prefix.replace(/^fake-/, "");
  if (!prefix.startsWith("fake-") || !grant) return null;
  const decoded = decode(subject);
  const expiry = kind === "access" ? Number(expiresAt) : Number.POSITIVE_INFINITY;
  return decoded === null ? null : { kind, subject: decoded, grant, expiresAt: expiry };
}

function decodeCode(code: string): { subject: string; scope: string } | null {
  if (!code.startsWith("fake-code.")) return null;
  try {
    const { subject, scope } = JSON.parse(decode(code.slice("fake-code.".length)) ?? "");
    return typeof subject === "string" && typeof scope === "string" ? { subject, scope } : null;
  } catch {
    return null;
  }
}

function encode(text: string): string {
  return toBase64Url(new TextEncoder().encode(text));
}

function decode(text: string): string | null {
  try {
    const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
    return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  } catch {
    return null;
  }
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

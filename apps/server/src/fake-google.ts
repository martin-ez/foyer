import { newId } from "@foyer/shared";
import { type FakeOccurrence, fakeOccurrences } from "./fake-series";
import { toBase64Url } from "./secrets";

/** A calendar that the fake Google holds: the account it's in, its name, its time zone and its
 *  events by id, including those deleted. `version` counts its events' changes, and sync tokens
 *  from before `droppedBefore` are no longer accepted. */
export type FakeCalendar = {
  subject: string;
  name: string;
  timeZone: string;
  events: Map<string, FakeEvent>;
  version: number;
  droppedBefore: number;
};

/** An event that the fake Google holds, as Google's Calendar API sends it, with the version of its
 *  calendar that last changed it. A series has `recurrence`, and an occurrence of one, which the
 *  fake holds only once it's changed or deleted, `recurringEventId`. */
export type FakeEvent = {
  id: string;
  status: "confirmed" | "cancelled";
  etag: string;
  summary?: string;
  description?: string;
  start: FakeEventTime;
  end: FakeEventTime;
  created: string;
  updated: string;
  recurrence?: string[];
  recurringEventId?: string;
  originalStartTime?: FakeEventTime;
  version: number;
};

/** When a fake event starts or ends: a day, or a moment as RFC 3339, with the time zone a series
 *  with times repeats in. */
export type FakeEventTime = { date?: string; dateTime?: string; timeZone?: string };

/** The fields of an event that a test sets as if someone changed it in Google Calendar. */
export type FakeEventFields = Partial<
  Pick<FakeEvent, "summary" | "description" | "start" | "end" | "recurrence">
>;

/** The account that the fake Google's page offers besides the one asked for. */
export const fakeOtherAccount = "fake-google-other-account";

/** Stands in for Google's token and revocation endpoints and Calendar API, so agents, web checks
 *  and tests connect without Google. Its codes and tokens name their account, so they survive a
 *  restart; calendars, events and revoked access are only kept in memory. */
export class FakeGoogle {
  /** The calendars it holds, by id. */
  readonly calendars = new Map<string, FakeCalendar>();
  /** While true, every request fails, as when Google can't be reached. */
  down = false;
  /** While true, Google refuses every event it's asked to create or change as invalid. */
  refusingEvents = false;
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

  /** The events in a calendar that aren't deleted, or none when it doesn't exist: single events,
   *  repeating series, and the occurrences changed in their series. */
  eventsOf(calendarId: string): FakeEvent[] {
    const events = this.calendars.get(calendarId)?.events.values() ?? [];
    return [...events].filter(({ status }) => status !== "cancelled");
  }

  /** The occurrences of a repeating series that aren't deleted and happen at least partly between
   *  two moments, in milliseconds since 1970, soonest first, as Google lists a series' instances. */
  instancesOf(
    calendarId: string,
    seriesId: string,
    between: { from?: number; to?: number } = {},
  ): FakeEvent[] {
    const calendar = this.#calendar(calendarId);
    const series = calendar.events.get(seriesId);
    if (!series?.recurrence || series.status === "cancelled") return [];
    const { from = Number.NEGATIVE_INFINITY, to = Date.now() + 3 * 365 * day } = between;
    return fakeOccurrences(series, calendar.timeZone, to)
      .map((occurrence) => {
        const id = `${seriesId}_${occurrence.suffix}`;
        return calendar.events.get(id) ?? occurrenceMadeFrom(series, occurrence);
      })
      .filter((event) => event.status !== "cancelled")
      .filter((event) => {
        const [start, end] = [event.start, event.end].map(momentOf);
        return (end ?? 0) > from && (start ?? 0) < to;
      });
  }

  /** Adds an event to a calendar, as if someone added it in Google Calendar, and returns it. */
  addEvent(calendarId: string, fields: FakeEventFields): FakeEvent {
    const calendar = this.#calendar(calendarId);
    const now = new Date().toISOString();
    const event: FakeEvent = {
      id: `google${newId().replaceAll("-", "")}`,
      status: "confirmed",
      etag: "",
      start: {},
      end: {},
      created: now,
      updated: now,
      version: 0,
    };
    calendar.events.set(event.id, event);
    this.changeEvent(calendarId, event.id, fields);
    return event;
  }

  /** Changes an event's fields, as if someone changed it in Google Calendar: a single event, a
   *  whole series, or one occurrence of a series. */
  changeEvent(calendarId: string, eventId: string, fields: FakeEventFields): void {
    const event = this.#held(calendarId, eventId);
    Object.assign(event, fields);
    this.#touch(calendarId, event);
  }

  /** Deletes an event, as if someone deleted it in Google Calendar: a single event, a whole series
   *  with its changed occurrences, or one occurrence of a series. */
  removeEvent(calendarId: string, eventId: string): void {
    for (const event of this.#withOccurrences(calendarId, this.#held(calendarId, eventId))) {
      event.status = "cancelled";
      this.#touch(calendarId, event);
    }
  }

  /** Moves an event, or a whole series with its changed occurrences, to another calendar, keeping
   *  its id, as if someone moved it in Google Calendar, where a calendar shared with them can be in
   *  another account. */
  moveEvent(calendarId: string, eventId: string, destinationId: string): FakeEvent {
    const event = this.#held(calendarId, eventId);
    const destination = this.#calendar(destinationId);
    let moved: FakeEvent | undefined;
    for (const each of this.#withOccurrences(calendarId, event)) {
      const copy: FakeEvent = { ...each, start: { ...each.start }, end: { ...each.end } };
      destination.events.set(each.id, copy);
      this.#touch(destinationId, copy);
      each.status = "cancelled";
      this.#touch(calendarId, each);
      if (each === event) moved = copy;
    }
    return moved ?? event;
  }

  /** Stops accepting a calendar's sync tokens given so far, as Google sometimes does, so the next
   *  read must read every event again. */
  dropSyncTokens(calendarId: string): void {
    const calendar = this.#calendar(calendarId);
    calendar.droppedBefore = calendar.version + 1;
  }

  /** Forgets everything, as a fresh start would. */
  reset(): void {
    this.calendars.clear();
    this.#grants.clear();
    this.#revoked.clear();
    this.down = false;
    this.refusingEvents = false;
  }

  #calendar(calendarId: string): FakeCalendar {
    const calendar = this.calendars.get(calendarId);
    if (!calendar) throw new Error(`There's no calendar ${calendarId}`);
    return calendar;
  }

  #held(calendarId: string, eventId: string): FakeEvent {
    const calendar = this.#calendar(calendarId);
    const event = calendar.events.get(eventId) ?? this.#occurrenceOf(calendar, eventId);
    if (!event) throw new Error(`Calendar ${calendarId} has no event ${eventId}`);
    calendar.events.set(eventId, event);
    return event;
  }

  #occurrenceOf(calendar: FakeCalendar, eventId: string): FakeEvent | null {
    const split = eventId.lastIndexOf("_");
    const series = calendar.events.get(eventId.slice(0, split));
    if (split < 0 || !series?.recurrence || series.status === "cancelled") return null;
    const suffix = eventId.slice(split + 1);
    const due = Date.parse(
      suffix.replace(
        /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z)?$/,
        (_, y, m, d, h, i, s) =>
          h === undefined ? `${y}-${m}-${d}` : `${y}-${m}-${d}T${h}:${i}:${s}Z`,
      ),
    );
    if (Number.isNaN(due)) return null;
    const found = fakeOccurrences(series, calendar.timeZone, due + 1).find(
      (occurrence) => occurrence.suffix === suffix,
    );
    return found ? occurrenceMadeFrom(series, found) : null;
  }

  #withOccurrences(calendarId: string, event: FakeEvent): FakeEvent[] {
    if (!event.recurrence) return [event];
    const held = [...this.#calendar(calendarId).events.values()];
    return [event, ...held.filter(({ recurringEventId }) => recurringEventId === event.id)];
  }

  #touch(calendarId: string, event: FakeEvent): void {
    const calendar = this.#calendar(calendarId);
    calendar.version += 1;
    event.version = calendar.version;
    event.etag = `"${calendar.version}-${newId()}"`;
    const updated = Math.max(Date.now(), Date.parse(event.updated) + 1);
    event.updated = new Date(updated).toISOString();
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
    const [calendarId = "", collection, eventId, action] = url.pathname
      .slice(calendarsPath.length + 1)
      .split("/")
      .map(decodeURIComponent);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    if (calendarId === "" && request.method === "POST") {
      const id = `fake-${newId()}@group.calendar.google.com`;
      const calendar: FakeCalendar = {
        subject: held.subject,
        name: String(body.summary ?? ""),
        timeZone: String(body.timeZone ?? "UTC"),
        events: new Map(),
        version: 0,
        droppedBefore: 0,
      };
      this.calendars.set(id, calendar);
      return Response.json(calendarAnswer(id, calendar));
    }
    const calendar = this.calendars.get(calendarId);
    if (!calendar || calendar.subject !== held.subject) return notFound();
    if (collection === "events") {
      return this.#eventsCall(request, url, { calendarId, calendar, eventId, action, body });
    }
    if (collection !== undefined) return notFound();
    if (request.method === "PATCH") {
      if (typeof body.summary === "string") calendar.name = body.summary;
      return Response.json(calendarAnswer(calendarId, calendar));
    }
    if (request.method === "GET") return Response.json(calendarAnswer(calendarId, calendar));
    return new Response(null, { status: 405 });
  }

  #eventsCall(
    request: Request,
    url: URL,
    call: {
      calendarId: string;
      calendar: FakeCalendar;
      eventId: string | undefined;
      action: string | undefined;
      body: Record<string, unknown>;
    },
  ): Response {
    const { calendarId, calendar, eventId, action, body } = call;
    if (eventId === undefined) {
      if (request.method === "GET") return this.#listEvents(calendar, url);
      if (request.method !== "POST") return new Response(null, { status: 405 });
      const id = String(body.id ?? `google${newId().replaceAll("-", "")}`);
      if (!/^[a-v0-9]{5,1024}$/.test(id)) return invalid("Invalid resource id value.");
      if (calendar.events.has(id)) return Response.json({ error: { code: 409 } }, { status: 409 });
      const problem = this.#eventProblem(body);
      if (problem) return invalid(problem);
      const now = new Date().toISOString();
      const event: FakeEvent = {
        id,
        status: "confirmed",
        etag: "",
        start: {},
        end: {},
        created: now,
        updated: now,
        version: 0,
      };
      applyFields(event, body);
      calendar.events.set(id, event);
      this.#touch(calendarId, event);
      return Response.json(eventAnswer(event));
    }
    const event = calendar.events.get(eventId) ?? this.#occurrenceOf(calendar, eventId);
    if (!event) return notFound();
    if (action === "instances" && request.method === "GET") {
      if (!event.recurrence) return notFound();
      if (event.status === "cancelled") return new Response(null, { status: 410 });
      return this.#listInstances(calendarId, calendar, eventId, url);
    }
    if (action === "move" && request.method === "POST") {
      if (event.status === "cancelled") return notFound();
      if (event.recurringEventId) return invalid("Cannot change the organizer of an instance.");
      const destinationId = url.searchParams.get("destination") ?? "";
      const destination = this.calendars.get(destinationId);
      if (!destination || destination.subject !== calendar.subject) return notFound();
      return Response.json(eventAnswer(this.moveEvent(calendarId, eventId, destinationId)));
    }
    if (action !== undefined) return notFound();
    if (request.method === "GET") return Response.json(eventAnswer(event));
    if (event.status === "cancelled") return new Response(null, { status: 410 });
    if (request.method === "DELETE") {
      this.removeEvent(calendarId, eventId);
      return new Response(null, { status: 204 });
    }
    if (request.method !== "PATCH") return new Response(null, { status: 405 });
    const expected = request.headers.get("If-Match");
    if (expected !== null && expected !== event.etag) {
      return Response.json({ error: { code: 412 } }, { status: 412 });
    }
    const changed = { ...event, start: { ...event.start }, end: { ...event.end } };
    applyFields(changed, body);
    const problem = this.#eventProblem(changed);
    if (problem) return invalid(problem);
    Object.assign(event, changed);
    calendar.events.set(eventId, event);
    this.#touch(calendarId, event);
    return Response.json(eventAnswer(event));
  }

  #listInstances(calendarId: string, calendar: FakeCalendar, seriesId: string, url: URL) {
    const momentIn = (name: string) => {
      const at = Date.parse(url.searchParams.get(name) ?? "");
      return Number.isNaN(at) ? undefined : at;
    };
    const from = momentIn("timeMin");
    const to = momentIn("timeMax");
    const instances = this.instancesOf(calendarId, seriesId, {
      ...(from === undefined ? {} : { from }),
      ...(to === undefined ? {} : { to }),
    });
    const pageSize = Math.min(Number(url.searchParams.get("maxResults") ?? "250") || 250, 2500);
    const offset = Number(url.searchParams.get("pageToken")?.replace(/^fake-page\./, "") ?? "0");
    const more = offset + pageSize < instances.length;
    return Response.json({
      kind: "calendar#events",
      timeZone: calendar.timeZone,
      items: instances.slice(offset, offset + pageSize).map(eventAnswer),
      ...(more ? { nextPageToken: `fake-page.${offset + pageSize}` } : {}),
    });
  }

  #listEvents(calendar: FakeCalendar, url: URL): Response {
    const pageToken = url.searchParams.get("pageToken");
    const syncToken = url.searchParams.get("syncToken");
    const pageSize = Number(url.searchParams.get("maxResults") ?? "250") || 250;
    let since: number | null = null;
    let offset = 0;
    if (pageToken) {
      const [sinceText = "", offsetText = "0"] = pageToken.replace(/^fake-page\./, "").split(".");
      since = sinceText === "full" ? null : Number(sinceText);
      offset = Number(offsetText);
    } else if (syncToken) {
      since = Number(syncToken.replace(/^fake-sync\./, ""));
      if (!Number.isInteger(since) || since < calendar.droppedBefore) {
        return Response.json({ error: { code: 410 } }, { status: 410 });
      }
    }
    const events = [...calendar.events.values()]
      .filter((event) =>
        since === null
          ? event.status !== "cancelled" || event.recurringEventId !== undefined
          : event.version > since,
      )
      .sort((a, b) => a.version - b.version);
    const page = events.slice(offset, offset + pageSize);
    const more = offset + pageSize < events.length;
    return Response.json({
      kind: "calendar#events",
      timeZone: calendar.timeZone,
      items: page.map(eventAnswer),
      ...(more
        ? { nextPageToken: `fake-page.${since ?? "full"}.${offset + pageSize}` }
        : { nextSyncToken: `fake-sync.${calendar.version}` }),
    });
  }

  #eventProblem(event: Record<string, unknown>): string | null {
    if (this.refusingEvents) return "Invalid event.";
    const start = event.start as FakeEventTime | undefined;
    const end = event.end as FakeEventTime | undefined;
    if (!start || !end) return "Missing time.";
    if (
      Boolean(start.date) !== Boolean(end.date) ||
      Boolean(start.dateTime) === Boolean(start.date)
    ) {
      return "Start and end times must either both be date or both be dateTime.";
    }
    const from = Date.parse(start.date ?? start.dateTime ?? "");
    const to = Date.parse(end.date ?? end.dateTime ?? "");
    if (Number.isNaN(from) || Number.isNaN(to)) return "Invalid time.";
    if (start.date ? to <= from : to < from) return "The specified time range is empty.";
    return null;
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

/** The fake Google's calendars and their events, on a page of the backend, to change them locally
 *  as if in Google Calendar: add an event, change its title or delete it, delete a calendar, or
 *  drop a calendar's sync tokens. Each change returns to the page. */
export async function fakeCalendarPage(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "POST") {
    const form = await formIn(request);
    const calendarId = form.get("calendar") ?? "";
    const eventId = form.get("event") ?? "";
    try {
      switch (form.get("action")) {
        case "add-event":
          fakeGoogle.addEvent(
            calendarId,
            fakeEventFields(form, fakeGoogle.calendars.get(calendarId)),
          );
          break;
        case "change-title":
          fakeGoogle.changeEvent(calendarId, eventId, { summary: form.get("title") ?? "" });
          break;
        case "delete-event":
          fakeGoogle.removeEvent(calendarId, eventId);
          break;
        case "delete-calendar":
          fakeGoogle.calendars.delete(calendarId);
          break;
        case "drop-sync-tokens":
          fakeGoogle.dropSyncTokens(calendarId);
          break;
      }
    } catch (error) {
      return new Response(String(error), { status: 400 });
    }
    return new Response(null, { status: 303, headers: { Location: url.pathname } });
  }
  if (request.method !== "GET") return new Response(null, { status: 405 });

  const form = (action: string, fields: string, label: string, calendarId: string, eventId = "") =>
    `<form method="post" style="display: inline">
<input type="hidden" name="action" value="${action}">
<input type="hidden" name="calendar" value="${escapeHtml(calendarId)}">
<input type="hidden" name="event" value="${escapeHtml(eventId)}">
${fields}<button>${escapeHtml(label)}</button></form>`;
  const calendars = [...fakeGoogle.calendars].map(([id, calendar]) => {
    const name = `${calendar.name} (${calendar.subject})`;
    const events = fakeGoogle.eventsOf(id).map((event) => {
      const [from, to] = [event.start, event.end].map((time) => time.date ?? time.dateTime);
      const summary = escapeHtml(event.summary ?? "");
      const repeats = event.recurrence ? `, repeating ${event.recurrence.join(" ")}` : "";
      const one = event.recurringEventId ? ", one occurrence changed in its series" : "";
      const when = `${from} to ${to}${repeats}${one}`;
      const title = `<input name="title" aria-label="New title of ${summary}" value="${summary}">`;
      return `<li><strong>${escapeHtml(event.summary ?? "(No title)")}</strong>, ${escapeHtml(when)}
${form("change-title", title, "Change title", id, event.id)}
${form("delete-event", "", `Delete ${event.summary ?? "event"}`, id, event.id)}</li>`;
    });
    return `<section aria-label="${escapeHtml(name)}">
<h2>${escapeHtml(name)}</h2>
<p>Time zone: ${escapeHtml(calendar.timeZone)}</p>
<ul>${events.join("") || "<li>No events</li>"}</ul>
${form(
  "add-event",
  `<input name="title" aria-label="Title" placeholder="Title" required>
<input name="starts" aria-label="Starts" placeholder="2026-11-20 or 2026-11-20T19:00:00Z" required>
<input name="ends" aria-label="Ends" placeholder="2026-11-21 or 2026-11-20T20:00:00Z" required>
<input name="repeats" aria-label="Repeats" placeholder="Repeats, as FREQ=WEEKLY;BYDAY=TU">`,
  "Add event",
  id,
)}
${form("delete-calendar", "", "Delete calendar", id)}
${form("drop-sync-tokens", "", "Drop sync tokens", id)}
</section>`;
  });
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Fake Google Calendar</title></head>
<body style="font-family: sans-serif; padding: 24px">
<h1>Fake Google Calendar</h1>
<p>Stands in for Google Calendar while developing Foyer. All-day events end the day after their last day, as in Google. A repeating event repeats by an iCalendar rule, as FREQ=WEEKLY;BYDAY=TU or FREQ=DAILY;COUNT=5; changing its title or deleting it changes the whole series.</p>
${calendars.join("") || "<p>No calendars yet.</p>"}
</body>
</html>`;
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function fakeEventFields(form: URLSearchParams, calendar?: FakeCalendar): FakeEventFields {
  const repeats =
    form
      .get("repeats")
      ?.trim()
      .replace(/^RRULE:/i, "") ?? "";
  const zone = repeats && calendar ? { timeZone: calendar.timeZone } : {};
  const time = (value: string): FakeEventTime =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) ? { date: value } : { dateTime: value, ...zone };
  return {
    summary: form.get("title") ?? "",
    start: time(form.get("starts") ?? ""),
    end: time(form.get("ends") ?? ""),
    ...(repeats ? { recurrence: [`RRULE:${repeats}`] } : {}),
  };
}

const calendarsPath = "/calendar/v3/calendars";

async function formIn(request: Request): Promise<URLSearchParams> {
  return new URLSearchParams(new TextDecoder().decode(await request.arrayBuffer()));
}

function calendarAnswer(id: string, calendar: FakeCalendar) {
  return { kind: "calendar#calendar", id, summary: calendar.name, timeZone: calendar.timeZone };
}

function eventAnswer({ version: _, ...event }: FakeEvent) {
  return { kind: "calendar#event", ...event };
}

function applyFields(event: FakeEvent, body: Record<string, unknown>): void {
  if (typeof body.summary === "string") event.summary = body.summary;
  if (typeof body.description === "string") event.description = body.description;
  for (const end of ["start", "end"] as const) {
    const time = body[end];
    if (time === undefined || time === null || typeof time !== "object") continue;
    const merged: Record<string, unknown> = { ...event[end], ...time };
    for (const [key, value] of Object.entries(merged)) if (value === null) delete merged[key];
    event[end] = merged as FakeEventTime;
  }
}

const day = 24 * 60 * 60_000;

function occurrenceMadeFrom(series: FakeEvent, occurrence: FakeOccurrence): FakeEvent {
  return {
    id: `${series.id}_${occurrence.suffix}`,
    status: "confirmed",
    etag: `"${series.version}-${occurrence.suffix}"`,
    ...(series.summary === undefined ? {} : { summary: series.summary }),
    ...(series.description === undefined ? {} : { description: series.description }),
    start: occurrence.start,
    end: occurrence.end,
    created: series.created,
    updated: series.updated,
    recurringEventId: series.id,
    originalStartTime: { ...occurrence.start },
    version: series.version,
  };
}

function momentOf(time: FakeEventTime): number | undefined {
  const at = Date.parse(time.dateTime ?? time.date ?? "");
  return Number.isNaN(at) ? undefined : at;
}

function notFound(): Response {
  return Response.json({ error: { code: 404 } }, { status: 404 });
}

function invalid(message: string): Response {
  return Response.json({ error: { code: 400, message } }, { status: 400 });
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

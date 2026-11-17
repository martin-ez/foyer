import { DurableObject, env } from "cloudflare:workers";
import { create, fromBinary, type MessageInitShape, toBinary } from "@bufbuild/protobuf";
import { newId, signedOutCloseCode } from "@foyer/shared";
import {
  type DeviceMessage,
  DeviceMessageSchema,
  HouseholdMessageSchema,
  type Push,
} from "@foyer/shared/gen/foyer/sync/v1/sync_pb";
import { isOnAllowlist } from "./allowlist";
import { applyPush } from "./changes";
import { type LiveConnection, LiveLane, newLiveConnection } from "./live";
import { householdMigrations, migrate } from "./migrations";
import { canSeePage } from "./pages";
import { latestSeq, nextSeq, pullRows, readRows, type VisibleRow } from "./rows";
import { hashSecret, newSecret } from "./secrets";
import { canSee, createFirstSpaces } from "./spaces";

/** What every member sees of a member. */
export type Member = { id: string; name: string };

/** A Google account that signed in: Google's id for it, its email and its owner's first name. */
export type GoogleAccount = { subject: string; email: string; name: string };

const day = 24 * 60 * 60 * 1000;

/** How long a session lasts without being used. */
export const sessionLifetime = 90 * day;

/** How long the iPad app has to exchange its one-time code for a session. */
export const signInCodeLifetime = 60 * 1000;

type SignInCode = { memberId: string; expiresAt: number };

/** A session that hasn't ended, and whether this use moved its last use forward. */
export type LiveSession = { sessionId: string; member: Member; renewed: boolean };

/** The headers in which the Worker tells the household whose session opens a sync connection. */
export const syncConnectionHeaders = { member: "Foyer-Member", session: "Foyer-Session" };

type SyncConnection = { memberId: string; sessionId: string; live: LiveConnection };

type HouseholdMessageInit = MessageInitShape<typeof HouseholdMessageSchema>["message"];

/** The household's hub, with its own SQLite storage. Starting it runs the storage migrations it
 *  hasn't run yet, before it answers anything. It keeps devices in sync over WebSockets, which stay
 *  open while it sleeps, and answers their "ping" with "pong" without waking. */
export class Household extends DurableObject<Env> {
  readonly #signInCodes = new Map<string, SignInCode>();
  readonly #live: LiveLane;

  constructor(ctx: DurableObjectState, bindings: Env) {
    super(ctx, bindings);
    migrate(ctx.storage, householdMigrations);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    this.#live = new LiveLane(ctx, (memberId, pageId) =>
      canSeePage(ctx.storage.sql, memberId, pageId),
    );
  }

  /** Opens a sync connection for the session the Worker checked, named by the headers in
   *  `syncConnectionHeaders`, and welcomes it with the number of the household's latest change. */
  override async fetch(request: Request): Promise<Response> {
    const memberId = request.headers.get(syncConnectionHeaders.member);
    const sessionId = request.headers.get(syncConnectionHeaders.session);
    if (!memberId || !sessionId || request.headers.get("Upgrade") !== "websocket") {
      return new Response(null, { status: 400 });
    }
    const { 0: device, 1: household } = new WebSocketPair();
    this.ctx.acceptWebSocket(household);
    const live = newLiveConnection(Date.now());
    household.serializeAttachment({ memberId, sessionId, live } satisfies SyncConnection);
    sendIfOpen(household, {
      case: "welcome",
      value: { seq: BigInt(latestSeq(this.ctx.storage.sql)) },
    });
    return new Response(null, { status: 101, webSocket: device });
  }

  /** Answers a device's pull, applies its pushes, and passes what it says on the live lane to the
   *  devices on its page. A connection whose session has ended is closed instead, and one that
   *  sends something other than a sync message is closed as broken. */
  override async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const connection = this.#stillSignedIn(socket);
    if (!connection || typeof message === "string") return;
    let received: DeviceMessage;
    try {
      received = fromBinary(DeviceMessageSchema, new Uint8Array(message));
    } catch {
      this.#live.closed(socket);
      socket.close(1007, "That isn't a sync message.");
      return;
    }

    switch (received.message.case) {
      case "pull": {
        const { sql } = this.ctx.storage;
        const cursor = Number(received.message.value.cursor);
        const page = pullRows(sql, connection.memberId, cursor);
        const value = { rows: page.rows, cursor: BigInt(page.cursor), done: page.done };
        sendIfOpen(socket, { case: "pullReply", value });
        return;
      }
      case "push":
        this.#push(socket, connection.memberId, received.message.value);
        return;
      case "enter":
        this.#live.enter(socket, received.message.value.pageId);
        return;
      case "leave":
        this.#live.leave(socket);
        return;
      case "point":
        this.#live.point(socket, received.message.value.x, received.message.value.y);
        return;
    }
  }

  /** Takes a device whose connection closed off its page. */
  override async webSocketClose(socket: WebSocket): Promise<void> {
    this.#live.closed(socket);
  }

  /** Takes a device whose connection broke off its page. */
  override async webSocketError(socket: WebSocket): Promise<void> {
    this.#live.closed(socket);
  }

  /** Takes devices the household hasn't heard from for a minute off their pages. */
  override async alarm(): Promise<void> {
    this.#live.checkForSilence();
  }

  #push(sender: WebSocket, memberId: string, push: Push): void {
    const { sql } = this.ctx.storage;
    const now = Date.now();
    sql.exec("DELETE FROM changes WHERE received_at <= ?", now - sessionLifetime);
    const { results, changed, unchanged } = applyPush(this.ctx.storage, memberId, push, now);
    this.#sendUpdates(readRows(sql, changed));
    if (changed.length > 0) this.#live.checkSight();
    const asTheyAre = readRows(sql, unchanged)
      .filter(({ visibleTo }) => visibleTo === null || visibleTo === memberId)
      .map(({ row }) => row);
    if (asTheyAre.length > 0) sendIfOpen(sender, { case: "updates", value: { rows: asTheyAre } });
    sendIfOpen(sender, { case: "committed", value: { pushId: push.pushId, results } });
  }

  #sendUpdates(rows: VisibleRow[]): void {
    if (rows.length === 0) return;
    for (const socket of this.ctx.getWebSockets()) {
      const connection = this.#stillSignedIn(socket);
      if (!connection) continue;
      const visible = rows
        .filter(({ visibleTo }) => visibleTo === null || visibleTo === connection.memberId)
        .map(({ row }) => row);
      if (visible.length > 0) sendIfOpen(socket, { case: "updates", value: { rows: visible } });
    }
  }

  #stillSignedIn(socket: WebSocket): SyncConnection | null {
    const connection = socket.deserializeAttachment() as SyncConnection | null;
    if (connection && this.#liveSession("id", connection.sessionId)) return connection;
    this.#live.closed(socket);
    closeIfOpen(socket, signedOutCloseCode, "The session has ended.");
    return null;
  }

  /** Confirms the household's SQLite storage answers. */
  ping(): string {
    return this.ctx.storage.sql.exec<{ status: string }>("SELECT 'ok' AS status").one().status;
  }

  /** Lets a Google account in when its email is on the allowlist, as the member who signed in with
   *  it before, or as a new member with their first spaces, whom connected devices then receive.
   *  Returns null for an account that isn't let in. */
  join(account: GoogleAccount): Member | null {
    if (!isOnAllowlist(account.email)) return null;
    const { sql } = this.ctx.storage;
    const [existing] = sql
      .exec<Member>("SELECT id, name FROM members WHERE google_subject = ?", account.subject)
      .toArray();
    if (existing) {
      sql.exec("UPDATE members SET email = ? WHERE id = ?", account.email, existing.id);
      return existing;
    }
    const member = { id: newId(), name: account.name };
    this.ctx.storage.transactionSync(() => {
      const seq = nextSeq(sql);
      sql.exec(
        "INSERT INTO members (id, email, google_subject, name, joined_at, seq) VALUES (?, ?, ?, ?, ?, ?)",
        member.id,
        account.email,
        account.subject,
        member.name,
        Date.now(),
        seq,
      );
      createFirstSpaces(sql, member.id, seq);
    });
    this.#sendUpdates(readRows(sql, [{ kind: "member", id: member.id }]));
    return member;
  }

  /** Whether a member can see a space, and so its items: every member sees every shared space, and
   *  only its owner sees an Inbox or a personal space. */
  canSee(memberId: string, spaceId: string): boolean {
    return canSee(this.ctx.storage.sql, memberId, spaceId);
  }

  /** Lets an email on the allowlist in without Google, for local development: as the first member
   *  who signed in with it, or as a new member named after it. Returns null for an email that isn't
   *  let in. */
  joinWithoutGoogle(email: string): Member | null {
    const address = email.trim().toLowerCase();
    if (!isOnAllowlist(address)) return null;
    const [existing] = this.ctx.storage.sql
      .exec<Member>(
        "SELECT id, name FROM members WHERE lower(email) = ? ORDER BY joined_at LIMIT 1",
        address,
      )
      .toArray();
    return (
      existing ??
      this.join({ subject: `dev:${address}`, email: address, name: address.split("@")[0] ?? "" })
    );
  }

  /** Starts a session for a member and returns its token, of which only a hash is stored. Removes
   *  the sessions that ended unused. */
  async startSession(memberId: string): Promise<string> {
    const token = newSecret();
    const tokenHash = await hashSecret(token);
    const now = Date.now();
    const { sql } = this.ctx.storage;
    sql.exec("DELETE FROM sessions WHERE last_used_at <= ?", now - sessionLifetime);
    sql.exec(
      "INSERT INTO sessions (id, token_hash, member_id, created_at, last_used_at) VALUES (?, ?, ?, ?, ?)",
      newId(),
      tokenHash,
      memberId,
      now,
      now,
    );
    return token;
  }

  /** Gives a member a one-time code, valid for a minute, that the iPad app exchanges for a session.
   *  Codes are only kept in memory. */
  issueSignInCode(memberId: string): string {
    const code = newSecret();
    this.#signInCodes.set(code, { memberId, expiresAt: Date.now() + signInCodeLifetime });
    return code;
  }

  /** Exchanges a one-time code for a new session, once. Returns null for a code that was never
   *  given, was used, or expired, and for a member whose email has left the allowlist. */
  async finishSignIn(code: string): Promise<{ token: string; member: Member } | null> {
    const now = Date.now();
    const signInCode = this.#signInCodes.get(code);
    for (const [given, { expiresAt }] of this.#signInCodes) {
      if (given === code || expiresAt <= now) this.#signInCodes.delete(given);
    }
    if (!signInCode || signInCode.expiresAt <= now) return null;

    const [member] = this.ctx.storage.sql
      .exec<Member & { email: string }>(
        "SELECT id, name, email FROM members WHERE id = ?",
        signInCode.memberId,
      )
      .toArray();
    if (!member || !isOnAllowlist(member.email)) return null;
    return {
      token: await this.startSession(member.id),
      member: { id: member.id, name: member.name },
    };
  }

  /** The session a token belongs to, or null once it has ended. A session ends after 90 days
   *  without use, or once its member's email leaves the allowlist. Using a session moves its last
   *  use forward at most once a day, and `renewed` says when this use did. */
  async sessionFor(token: string): Promise<LiveSession | null> {
    return this.#liveSession("token_hash", await hashSecret(token));
  }

  /** Ends the session a token belongs to, if it hasn't ended already, and closes its sync
   *  connections. */
  async endSession(token: string): Promise<void> {
    this.ctx.storage.sql.exec("DELETE FROM sessions WHERE token_hash = ?", await hashSecret(token));
    for (const socket of this.ctx.getWebSockets()) this.#stillSignedIn(socket);
  }

  #liveSession(by: "id" | "token_hash", value: string): LiveSession | null {
    const { sql } = this.ctx.storage;
    const [session] = sql
      .exec<{ id: string; last_used_at: number; member_id: string; name: string; email: string }>(
        `SELECT sessions.id, sessions.last_used_at, members.id AS member_id, members.name, members.email
         FROM sessions JOIN members ON members.id = sessions.member_id
         WHERE sessions.${by} = ?`,
        value,
      )
      .toArray();
    if (!session) return null;

    const now = Date.now();
    if (session.last_used_at <= now - sessionLifetime) {
      sql.exec("DELETE FROM sessions WHERE id = ?", session.id);
      return null;
    }
    if (!isOnAllowlist(session.email)) {
      sql.exec("DELETE FROM sessions WHERE member_id = ?", session.member_id);
      return null;
    }
    const renewed = session.last_used_at <= now - day;
    if (renewed) sql.exec("UPDATE sessions SET last_used_at = ? WHERE id = ?", now, session.id);
    return {
      sessionId: session.id,
      member: { id: session.member_id, name: session.name },
      renewed,
    };
  }
}

/** The one household this deployment holds. */
export function theHousehold(): DurableObjectStub<Household> {
  return env.HOUSEHOLD.getByName("household");
}

function sendIfOpen(socket: WebSocket, message: HouseholdMessageInit): void {
  try {
    socket.send(toBinary(HouseholdMessageSchema, create(HouseholdMessageSchema, { message })));
  } catch {}
}

function closeIfOpen(socket: WebSocket, code: number, reason: string): void {
  try {
    socket.close(code, reason);
  } catch {}
}

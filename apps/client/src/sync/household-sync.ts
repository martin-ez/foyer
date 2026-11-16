import { create, fromBinary, type MessageInitShape, toBinary } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import { newId, signedOutCloseCode } from "@foyer/shared";
import type { Member } from "@foyer/shared/gen/foyer/member/v1/member_pb";
import { type Space, SpaceKind, SpaceSchema } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import {
  type Change,
  ChangeSchema,
  DeviceMessageSchema,
  HouseholdMessageSchema,
  type Row,
  RowKind,
} from "@foyer/shared/gen/foyer/sync/v1/sync_pb";

/** Where the device stands with the household. */
export type SyncStatus = "connecting" | "catching-up" | "up-to-date" | "offline" | "signed-out";

/** What the device knows of the household, with its own changes applied before they're saved. */
export type SyncState = {
  status: SyncStatus;
  members: Member[];
  /** The spaces the member sees: their Inbox, their personal spaces, then the shared ones, each
   *  kind in the order they were made. */
  spaces: Space[];
  /** How many changes the household hasn't saved yet. */
  unsaved: number;
  /** A sentence for each change the household refused, which the device undid. */
  problems: string[];
};

/** A connection to the household that a `Connect` opened. */
export type Connection = { send(data: Uint8Array | string): void; close(): void };

/** What a connection reports: that it opened, each message, and that it closed, with its code. */
export type ConnectionEvents = {
  opened(): void;
  received(data: Uint8Array | string): void;
  closed(code: number): void;
};

/** Opens a connection to the household's sync address, carrying the device's session. */
export type Connect = (events: ConnectionEvents) => Connection;

/** How often a connected device says it's still there. */
export const keepAliveInterval = 30_000;

/** How long a connection may stay silent before the device gives up on it and connects again. */
export const silenceLimit = 75_000;

/** The longest wait between attempts to connect again. */
export const longestReconnectDelay = 30_000;

/** At most this many changes go in one push. */
export const pushChangeLimit = 100;

type Pending = { change: Change; describe: string; pushId?: string };

/** Keeps a device in step with the household: catches up when it connects, applies what others
 *  change as they change it, and sends the member's own changes, which show at once and wait
 *  until the household commits or refuses them. It connects again after the connection drops,
 *  waiting longer after each failed attempt, and stops once the session has ended. What it knows
 *  is kept in memory, so a new instance catches up in full. */
export class HouseholdSync {
  readonly #memberId: string;
  readonly #connect: Connect;
  readonly #listeners = new Set<() => void>();
  readonly #members = new Map<string, { seq: bigint; member: Member }>();
  readonly #spaces = new Map<string, { seq: bigint; space: Space }>();
  readonly #deleted = new Map<string, bigint>();
  #pending: Pending[] = [];
  #problems: string[] = [];
  #cursor = 0n;
  #status: SyncStatus = "offline";
  #state: SyncState;
  #connection: Connection | null = null;
  #stopped = true;
  #attempts = 0;
  #lastHeard = 0;
  #reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  #keepAliveTimer: ReturnType<typeof setInterval> | undefined;

  constructor(options: { memberId: string; connect: Connect }) {
    this.#memberId = options.memberId;
    this.#connect = options.connect;
    this.#state = this.#currentState();
  }

  /** Connects, and keeps connecting again until stopped or signed out. */
  start(): void {
    if (!this.#stopped) return;
    this.#stopped = false;
    this.#open();
  }

  /** Closes the connection and stops connecting again. */
  stop(): void {
    this.#stopped = true;
    clearTimeout(this.#reconnectTimer);
    this.#drop();
    if (this.#status !== "signed-out") this.#status = "offline";
    this.#changed();
  }

  /** What the device knows now. The same object until something changes. */
  readonly getState = (): SyncState => this.#state;

  /** Calls a listener whenever the state changes, until the returned function is called. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** Creates a personal or shared space, and returns its id. */
  createSpace(kind: SpaceKind.PERSONAL | SpaceKind.SHARED, name: string): string {
    const spaceId = newId();
    this.#change(`creating “${name}”`, { case: "spaceCreate", value: { spaceId, kind, name } });
    return spaceId;
  }

  /** Renames a personal or shared space. */
  renameSpace(spaceId: string, name: string): void {
    this.#change(`renaming a space to “${name}”`, {
      case: "spaceRename",
      value: { spaceId, name },
    });
  }

  /** Forgets the refused changes the state reports. */
  dismissProblems(): void {
    this.#problems = [];
    this.#changed();
  }

  #change(describe: string, change: MessageInitShape<typeof ChangeSchema>["change"]): void {
    const made = create(ChangeSchema, {
      changeId: newId(),
      at: timestampFromMs(Date.now()),
      change,
    });
    this.#pending.push({ change: made, describe });
    this.#pushUnsent();
    this.#changed();
  }

  #open(): void {
    this.#status = "connecting";
    this.#changed();
    const events: ConnectionEvents = {
      opened: () => {
        if (this.#connection === connection) this.#heard();
      },
      received: (data) => {
        if (this.#connection === connection) this.#receive(data);
      },
      closed: (code) => {
        if (this.#connection === connection) this.#closed(code);
      },
    };
    const connection = this.#connect(events);
    this.#connection = connection;
    this.#heard();
    clearInterval(this.#keepAliveTimer);
    this.#keepAliveTimer = setInterval(() => this.#keepAlive(), keepAliveInterval);
  }

  #keepAlive(): void {
    if (Date.now() - this.#lastHeard > silenceLimit) {
      this.#closed(0);
      return;
    }
    this.#connection?.send("ping");
  }

  #heard(): void {
    this.#lastHeard = Date.now();
  }

  #receive(data: Uint8Array | string): void {
    this.#heard();
    if (typeof data === "string") return;
    const { message } = fromBinary(HouseholdMessageSchema, data);
    switch (message.case) {
      case "welcome":
        this.#attempts = 0;
        this.#status = "catching-up";
        this.#send({ case: "pull", value: { cursor: this.#cursor } });
        this.#pushUnsent();
        break;
      case "pullReply":
        this.#apply(message.value.rows);
        if (message.value.done) {
          this.#cursor = message.value.cursor;
          this.#status = "up-to-date";
        } else {
          this.#send({ case: "pull", value: { cursor: message.value.cursor } });
        }
        break;
      case "updates":
        this.#apply(message.value.rows);
        if (this.#status === "up-to-date") {
          for (const { seq } of message.value.rows) if (seq > this.#cursor) this.#cursor = seq;
        }
        break;
      case "committed":
        for (const { changeId, result } of message.value.results) {
          const pending = this.#pending.find(({ change }) => change.changeId === changeId);
          this.#pending = this.#pending.filter((each) => each !== pending);
          if (pending && result.case === "refused") {
            this.#problems.push(`Couldn't save ${pending.describe}: ${result.value.reason}`);
          }
        }
        break;
    }
    this.#changed();
  }

  #apply(rows: Row[]): void {
    for (const { seq, row } of rows) {
      switch (row.case) {
        case "member":
          if (this.#isNewer("member", row.value.id, seq, this.#members)) {
            this.#members.set(row.value.id, { seq, member: row.value });
          }
          break;
        case "space":
          if (this.#isNewer("space", row.value.id, seq, this.#spaces)) {
            this.#spaces.set(row.value.id, { seq, space: row.value });
          }
          break;
        case "deleted": {
          const kind = row.value.kind === RowKind.MEMBER ? "member" : "space";
          const rows = kind === "member" ? this.#members : this.#spaces;
          if (this.#isNewer(kind, row.value.id, seq, rows)) {
            rows.delete(row.value.id);
            this.#deleted.set(`${kind} ${row.value.id}`, seq);
          }
          break;
        }
      }
    }
  }

  #isNewer(kind: string, id: string, seq: bigint, rows: Map<string, { seq: bigint }>): boolean {
    const known = rows.get(id)?.seq ?? this.#deleted.get(`${kind} ${id}`) ?? -1n;
    return seq >= known;
  }

  #pushUnsent(): void {
    if (this.#status !== "catching-up" && this.#status !== "up-to-date") return;
    for (;;) {
      const unsent = this.#pending.filter(({ pushId }) => !pushId).slice(0, pushChangeLimit);
      if (unsent.length === 0) return;
      const pushId = newId();
      for (const pending of unsent) pending.pushId = pushId;
      const changes = unsent.map(({ change }) => change);
      this.#send({ case: "push", value: { pushId, changes } });
    }
  }

  #send(message: MessageInitShape<typeof DeviceMessageSchema>["message"]): void {
    this.#connection?.send(toBinary(DeviceMessageSchema, create(DeviceMessageSchema, { message })));
  }

  #closed(code: number): void {
    this.#drop();
    for (const pending of this.#pending) pending.pushId = undefined;
    if (code === signedOutCloseCode) {
      this.#stopped = true;
      this.#status = "signed-out";
    } else {
      this.#status = "offline";
      if (!this.#stopped) {
        const delay = Math.min(1000 * 2 ** this.#attempts, longestReconnectDelay);
        this.#attempts += 1;
        this.#reconnectTimer = setTimeout(() => this.#open(), delay);
      }
    }
    this.#changed();
  }

  #drop(): void {
    clearInterval(this.#keepAliveTimer);
    const connection = this.#connection;
    this.#connection = null;
    connection?.close();
  }

  #changed(): void {
    this.#state = this.#currentState();
    for (const listener of this.#listeners) listener();
  }

  #currentState(): SyncState {
    const spaces = new Map([...this.#spaces].map(([id, { space }]) => [id, space]));
    for (const { change } of this.#pending) {
      if (change.change.case === "spaceCreate") {
        const { spaceId, kind, name } = change.change.value;
        const ownerId = kind === SpaceKind.PERSONAL ? this.#memberId : "";
        if (!spaces.has(spaceId)) {
          spaces.set(spaceId, create(SpaceSchema, { id: spaceId, kind, ownerId, name }));
        }
      } else if (change.change.case === "spaceRename") {
        const { spaceId, name } = change.change.value;
        const space = spaces.get(spaceId);
        if (space) spaces.set(spaceId, { ...space, name });
      }
    }
    return {
      status: this.#status,
      members: [...this.#members.values()]
        .map(({ member }) => member)
        .sort((a, b) => a.id.localeCompare(b.id)),
      spaces: [...spaces.values()].sort(
        (a, b) => kindOrder[a.kind] - kindOrder[b.kind] || a.id.localeCompare(b.id),
      ),
      unsaved: this.#pending.length,
      problems: [...this.#problems],
    };
  }
}

const kindOrder: Record<SpaceKind, number> = {
  [SpaceKind.INBOX]: 0,
  [SpaceKind.PERSONAL]: 1,
  [SpaceKind.SHARED]: 2,
  [SpaceKind.UNSPECIFIED]: 3,
};

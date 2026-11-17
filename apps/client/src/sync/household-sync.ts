import { create, fromBinary, type MessageInitShape, toBinary } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import {
  clashingName,
  freeSpaceName,
  itemTitleProblem,
  newId,
  pageSizeFor,
  signedOutCloseCode,
  spaceNameProblem,
} from "@foyer/shared";
import { type Item, ItemKind, ItemSchema } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import type { Member } from "@foyer/shared/gen/foyer/member/v1/member_pb";
import { type Page, PageKind, PageSchema } from "@foyer/shared/gen/foyer/page/v1/page_pb";
import { type Space, SpaceKind, SpaceSchema } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import {
  type Sticker,
  StickerKind,
  StickerSchema,
} from "@foyer/shared/gen/foyer/sticker/v1/sticker_pb";
import {
  type Change,
  ChangeSchema,
  DeviceMessageSchema,
  HouseholdMessageSchema,
  type Row,
  RowKind,
} from "@foyer/shared/gen/foyer/sync/v1/sync_pb";
import { spotInSpace } from "../page/sticker-layout";
import { LiveLane } from "./live-lane";

/** Where the device stands with the household. */
export type SyncStatus = "connecting" | "catching-up" | "up-to-date" | "offline" | "signed-out";

/** What the device knows of the household, with its own changes applied before they're saved. */
export type SyncState = {
  status: SyncStatus;
  members: Member[];
  /** The spaces the member sees: their Inbox, their personal spaces, then the shared ones, each
   *  kind in the order they were made. */
  spaces: Space[];
  /** The pages the member sees that have been created, by id. A page is created when something is
   *  first put on it, so a page that isn't here is empty. */
  pages: ReadonlyMap<string, Page>;
  /** The tasks, events and notes the member sees, by id. */
  items: ReadonlyMap<string, Item>;
  /** The stickers on the pages the member sees, by id, including those whose item they can't see,
   *  which are drawn with their contents hidden. */
  stickers: ReadonlyMap<string, Sticker>;
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

/** Keeps a device in step with the household, in memory: catches up when it connects, applies
 *  what others change, and shows the member's own changes at once until the household commits or
 *  refuses them. Connects again after a drop, waiting longer each time, until signed out. */
export class HouseholdSync {
  /** Which page the device is on and where it's pointing, and who else is there. */
  readonly live = new LiveLane((message) => this.#send(message));

  readonly #memberId: string;
  readonly #connect: Connect;
  readonly #listeners = new Set<() => void>();
  readonly #members = new Map<string, { seq: bigint; member: Member }>();
  readonly #spaces = new Map<string, { seq: bigint; space: Space }>();
  readonly #pages = new Map<string, { seq: bigint; page: Page }>();
  readonly #items = new Map<string, { seq: bigint; item: Item }>();
  readonly #stickers = new Map<string, { seq: bigint; sticker: Sticker }>();
  readonly #rowsOfKind = {
    member: this.#members,
    space: this.#spaces,
    page: this.#pages,
    item: this.#items,
    sticker: this.#stickers,
  };
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

  /** Creates a personal or shared space, and returns its id. Spaces at the start and end of the
   *  name are dropped. A name another space the member sees has is numbered, as in "Home 2". */
  createSpace(kind: SpaceKind.PERSONAL | SpaceKind.SHARED, name: string): string {
    const spaceId = newId();
    const trimmed = name.trim();
    this.#make(`creating “${trimmed}”`, {
      case: "spaceCreate",
      value: { spaceId, kind, name: trimmed },
    });
    return spaceId;
  }

  /** Renames a personal or shared space. Spaces at the start and end of the name are dropped. */
  renameSpace(spaceId: string, name: string): void {
    const trimmed = name.trim();
    this.#make(`renaming a space to “${trimmed}”`, {
      case: "spaceRename",
      value: { spaceId, name: trimmed },
    });
  }

  /** Why the household would refuse this name for a new space, or for the space `renaming` if
   *  given, as far as the device knows, or null if it wouldn't: a name that's blank or too long
   *  once trimmed, or a rename to the name of another space the member sees, ignoring case. */
  nameProblem(name: string, renaming?: string): string | null {
    const trimmed = name.trim();
    const problem = spaceNameProblem(trimmed);
    if (problem || renaming === undefined) return problem;
    const others = this.#state.spaces.filter(({ id }) => id !== renaming);
    const clash = clashingName(trimmed, namesOf(others));
    return clash === undefined ? null : `Another space you see is called “${clash}”.`;
  }

  /** Adds a task to a space, with its sticker in the next free spot on the space's newest page, or
   *  at the top of a new page when that one is full. Spaces at the start and end of the title are
   *  dropped. Returns the number of the page its sticker went on. */
  addTask(spaceId: string, title: string): { itemId: string; pageNumber: number } {
    const itemId = newId();
    const trimmed = title.trim();
    const { pages, stickers } = this.#state;
    const newPageSize = pageSizeFor("space");
    const spot = spotInSpace(spaceId, StickerKind.TASK, pages, stickers.values(), newPageSize);
    const changes: ChangeInit[] = [];
    if (spot.isNewPage) {
      changes.push({
        case: "pageCreate",
        value: {
          pageId: spot.pageId,
          kind: PageKind.SPACE,
          spaceId,
          number: spot.number,
          ...newPageSize,
        },
      });
    }
    changes.push(
      {
        case: "itemCreate",
        value: { itemId, kind: ItemKind.TASK, spaceId, title: trimmed },
      },
      {
        case: "stickerPlace",
        value: {
          stickerId: newId(),
          pageId: spot.pageId,
          ...spot.at,
          kind: StickerKind.TASK,
          itemId,
        },
      },
    );
    this.#make(`adding “${trimmed}”`, ...changes);
    return { itemId, pageNumber: spot.number };
  }

  /** Why the household would refuse this title for a task, or null if it wouldn't: one that's
   *  blank or too long once trimmed. */
  titleProblem(title: string): string | null {
    return itemTitleProblem(title.trim());
  }

  /** Moves a sticker within its page, which brings it to the top. */
  moveSticker(stickerId: string, x: number, y: number): void {
    this.#make("moving a sticker", { case: "stickerMove", value: { stickerId, x, y } });
  }

  /** Peels a sticker off its page. Its item stays. */
  removeSticker(stickerId: string): void {
    this.#make("removing a sticker", { case: "stickerRemove", value: { stickerId } });
  }

  /** Forgets the refused changes the state reports. */
  dismissProblems(): void {
    this.#problems = [];
    this.#changed();
  }

  /** Makes changes, which go to the household in one push when it's connected. */
  #make(describe: string, ...changes: ChangeInit[]): void {
    const at = timestampFromMs(Date.now());
    for (const change of changes) {
      const made = create(ChangeSchema, { changeId: newId(), at, change });
      this.#pending.push({ change: made, describe });
    }
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
    if (this.live.receive(message)) return;
    switch (message.case) {
      case "welcome":
        this.#attempts = 0;
        this.#status = "catching-up";
        this.#send({ case: "pull", value: { cursor: this.#cursor } });
        this.#pushUnsent();
        this.live.connected();
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
        case "page":
          if (this.#isNewer("page", row.value.id, seq, this.#pages)) {
            this.#pages.set(row.value.id, { seq, page: row.value });
          }
          break;
        case "item":
          if (this.#isNewer("item", row.value.id, seq, this.#items)) {
            this.#items.set(row.value.id, { seq, item: row.value });
          }
          break;
        case "sticker":
          if (this.#isNewer("sticker", row.value.id, seq, this.#stickers)) {
            this.#stickers.set(row.value.id, { seq, sticker: row.value });
          }
          break;
        case "deleted": {
          const kind = rowKindNames[row.value.kind];
          const rows = kind && this.#rowsOfKind[kind];
          if (kind && rows && this.#isNewer(kind, row.value.id, seq, rows)) {
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
    this.live.disconnected();
  }

  #changed(): void {
    this.#state = this.#currentState();
    for (const listener of this.#listeners) listener();
  }

  #currentState(): SyncState {
    const spaces = new Map([...this.#spaces].map(([id, { space }]) => [id, space]));
    const pages = new Map([...this.#pages].map(([id, { page }]) => [id, page]));
    const items = new Map([...this.#items].map(([id, { item }]) => [id, item]));
    const stickers = new Map([...this.#stickers].map(([id, { sticker }]) => [id, sticker]));
    for (const { change } of this.#pending) {
      const { at } = change;
      switch (change.change.case) {
        case "spaceCreate": {
          const { spaceId, kind, name } = change.change.value;
          const ownerId = kind === SpaceKind.PERSONAL ? this.#memberId : "";
          if (!spaces.has(spaceId)) {
            const numbered = freeSpaceName(name, namesOf(spaces.values()));
            spaces.set(
              spaceId,
              create(SpaceSchema, { id: spaceId, kind, ownerId, name: numbered }),
            );
          }
          break;
        }
        case "spaceRename": {
          const { spaceId, name } = change.change.value;
          const space = spaces.get(spaceId);
          if (space) spaces.set(spaceId, { ...space, name });
          break;
        }
        case "pageCreate": {
          const { pageId, kind, spaceId, number, itemId, width, height } = change.change.value;
          if (!pages.has(pageId)) {
            const page = { id: pageId, kind, spaceId, number, itemId, width, height };
            pages.set(pageId, create(PageSchema, page));
          }
          break;
        }
        case "itemCreate": {
          const { itemId, kind, spaceId, title, description, date } = change.change.value;
          if (!items.has(itemId)) {
            const item = { id: itemId, kind, spaceId, title, description, date };
            const created = { createdBy: this.#memberId, createdAt: at };
            items.set(itemId, create(ItemSchema, { ...item, ...created }));
          }
          break;
        }
        case "stickerPlace": {
          const { stickerId, pageId, x, y, kind, itemId } = change.change.value;
          if (!stickers.has(stickerId) && !this.#deleted.has(`sticker ${stickerId}`)) {
            const sticker = { id: stickerId, pageId, x, y, kind, itemId };
            const placed = { placedAt: at, placedBy: this.#memberId };
            stickers.set(stickerId, create(StickerSchema, { ...sticker, ...placed }));
          }
          break;
        }
        case "stickerMove": {
          const { stickerId, x, y } = change.change.value;
          const sticker = stickers.get(stickerId);
          if (sticker) {
            stickers.set(stickerId, { ...sticker, x, y, placedAt: at, placedBy: this.#memberId });
          }
          break;
        }
        case "stickerRemove":
          stickers.delete(change.change.value.stickerId);
          break;
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
      pages,
      items,
      stickers,
      unsaved: this.#pending.length,
      problems: [...this.#problems],
    };
  }
}

function namesOf(spaces: Iterable<Space>): string[] {
  return Array.from(spaces)
    .filter(({ kind }) => kind !== SpaceKind.INBOX)
    .map(({ name }) => name);
}

type ChangeInit = MessageInitShape<typeof ChangeSchema>["change"];

const rowKindNames: Partial<Record<RowKind, "member" | "space" | "page" | "item" | "sticker">> = {
  [RowKind.MEMBER]: "member",
  [RowKind.SPACE]: "space",
  [RowKind.PAGE]: "page",
  [RowKind.ITEM]: "item",
  [RowKind.STICKER]: "sticker",
};

const kindOrder: Record<SpaceKind, number> = {
  [SpaceKind.INBOX]: 0,
  [SpaceKind.PERSONAL]: 1,
  [SpaceKind.SHARED]: 2,
  [SpaceKind.UNSPECIFIED]: 3,
};

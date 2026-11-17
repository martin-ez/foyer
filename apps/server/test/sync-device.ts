import { exports } from "cloudflare:workers";
import { create, fromBinary, type MessageInitShape, toBinary } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import { newId, syncPath } from "@foyer/shared";
import { type ItemCreateSchema, ItemKind } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import type { PageCreateSchema } from "@foyer/shared/gen/foyer/page/v1/page_pb";
import { SpaceKind } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import {
  StickerKind,
  type StickerPlaceSchema,
} from "@foyer/shared/gen/foyer/sticker/v1/sticker_pb";
import {
  type ChangeSchema,
  DeviceMessageSchema,
  type HouseholdMessage,
  HouseholdMessageSchema,
  type Row,
} from "@foyer/shared/gen/foyer/sync/v1/sync_pb";
import { theHousehold } from "../src/household";
import { backendUrl } from "./backend";

/** A change as a test writes it. */
export type ChangeInit = MessageInitShape<typeof ChangeSchema>;

type Received = NonNullable<HouseholdMessage["message"]["case"]>;
type Message<Case extends Received> = Extract<HouseholdMessage["message"], { case: Case }>["value"];

const waitLimit = 2000;

/** Signs a member in without Google, and returns their id and a session token. The email must be
 *  on the test allowlist. */
export async function signIn(email: string): Promise<{ memberId: string; token: string }> {
  const member = await theHousehold().joinWithoutGoogle(email);
  if (!member) throw new Error(`${email} isn't on the test allowlist`);
  return { memberId: member.id, token: await theHousehold().startSession(member.id) };
}

/** Opens a sync connection to the backend, as a device would, with the request's headers. */
export async function openConnection(headers: HeadersInit): Promise<Response> {
  return exports.default.fetch(
    new Request(`${backendUrl}${syncPath}`, { headers: { Upgrade: "websocket", ...headers } }),
  );
}

/** A device connected to the household, which keeps what the household sends it. */
export class Device {
  readonly #socket: WebSocket;
  readonly #unread: HouseholdMessage["message"][] = [];
  #arrived: () => void = () => {};

  /** Resolves with the close code and reason once the connection closes. */
  readonly closed: Promise<{ code: number; reason: string }>;

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.accept();
    let reading = Promise.resolve();
    socket.addEventListener("message", ({ data }) => {
      reading = reading.then(async () => {
        if (typeof data === "string") this.#unread.push({ case: undefined, value: undefined });
        else this.#unread.push(fromBinary(HouseholdMessageSchema, await bytesOf(data)).message);
        this.#arrived();
      });
    });
    this.closed = new Promise((resolve) => {
      socket.addEventListener("close", ({ code, reason }) => {
        resolve({ code, reason });
        this.#arrived();
      });
    });
  }

  /** Connects with a session token, as the iPad app does. */
  static async connect(token: string): Promise<Device> {
    return Device.from(await openConnection({ Authorization: `Bearer ${token}` }));
  }

  /** Connects with the connection a response opened. */
  static from(response: Response): Device {
    if (!response.webSocket) throw new Error(`No connection opened: ${response.status}`);
    return new Device(response.webSocket);
  }

  /** The number the household sent when the connection opened. */
  async welcome(): Promise<number> {
    return Number((await this.next("welcome")).seq);
  }

  /** Sends changes in one push and returns what became of each. */
  async push(...changes: ChangeInit[]): Promise<Message<"committed">> {
    const pushId = newId();
    this.send({ case: "push", value: { pushId, changes } });
    const committed = await this.next("committed");
    if (committed.pushId !== pushId) throw new Error("The answer is for another push");
    return committed;
  }

  /** Pulls once from a cursor. */
  async pull(cursor: number): Promise<Message<"pullReply">> {
    this.send({ case: "pull", value: { cursor: BigInt(cursor) } });
    return this.next("pullReply");
  }

  /** Pulls from a cursor until it has caught up, and returns every reply. */
  async catchUp(cursor = 0): Promise<Message<"pullReply">[]> {
    const replies = [await this.pull(cursor)];
    for (let last = replies[0]; last && !last.done; last = replies.at(-1)) {
      replies.push(await this.pull(Number(last.cursor)));
    }
    return replies;
  }

  /** Sends a message, as bytes, or as text. */
  send(message: MessageInitShape<typeof DeviceMessageSchema>["message"] | string): void {
    if (typeof message === "string") this.#socket.send(message);
    else this.#socket.send(toBinary(DeviceMessageSchema, create(DeviceMessageSchema, { message })));
  }

  /** Sends bytes as they are. */
  sendBytes(bytes: Uint8Array): void {
    this.#socket.send(bytes);
  }

  /** Waits for the next message of a kind that hasn't been read, and reads it. */
  async next<Case extends Received>(kind: Case): Promise<Message<Case>> {
    for (;;) {
      const index = this.#unread.findIndex((message) => message.case === kind);
      const [message] = index >= 0 ? this.#unread.splice(index, 1) : [];
      if (message) return message.value as Message<Case>;
      if (!(await this.#nextArrival())) throw new Error(`No ${kind} arrived`);
    }
  }

  /** The rows in every Updates message that arrived and hasn't been read, after giving the
   *  household time to send any more. Reads them. */
  async updates(): Promise<Row[]> {
    await this.ping();
    return this.#read("updates").flatMap(({ rows }) => rows);
  }

  /** Every message of a kind that arrived and hasn't been read, once the household has handled
   *  everything the device sent before. Reads them. */
  async all<Case extends Received>(kind: Case): Promise<Message<Case>[]> {
    await this.settle();
    return this.#read(kind);
  }

  /** Waits until the household has handled everything the device sent, and sent what that made it
   *  send to this device and others, by pulling and waiting for the reply, which comes in order.
   *  The runtime answers "ping" without waiting for the household. */
  async settle(): Promise<void> {
    await this.pull(Number.MAX_SAFE_INTEGER);
  }

  #read<Case extends Received>(kind: Case): Message<Case>[] {
    const found: Message<Case>[] = [];
    for (let index = this.#unread.findIndex(({ case: each }) => each === kind); index >= 0; ) {
      const [message] = this.#unread.splice(index, 1);
      if (message) found.push(message.value as Message<Case>);
      index = this.#unread.findIndex(({ case: each }) => each === kind);
    }
    return found;
  }

  /** Says the device is now on a page. */
  enter(pageId: string): void {
    this.send({ case: "enter", value: { pageId } });
  }

  /** Says the device left its page. */
  leave(): void {
    this.send({ case: "leave", value: {} });
  }

  /** Says where the device is pointing on its page. */
  point(x: number, y: number): void {
    this.send({ case: "point", value: { x, y } });
  }

  /** Sends "ping" and waits for "pong", so that whatever the household sent before has arrived. */
  async ping(): Promise<void> {
    this.send("ping");
    await this.#nextText();
  }

  close(): void {
    this.#socket.close(1000, "Done");
  }

  async #nextText(): Promise<void> {
    for (;;) {
      const index = this.#unread.findIndex((message) => message.case === undefined);
      if (index >= 0) {
        this.#unread.splice(index, 1);
        return;
      }
      if (!(await this.#nextArrival())) throw new Error("No pong arrived");
    }
  }

  #nextArrival(): Promise<boolean> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(false), waitLimit);
      this.#arrived = () => {
        clearTimeout(timeout);
        resolve(true);
      };
    });
  }
}

async function bytesOf(data: ArrayBuffer | Blob): Promise<Uint8Array> {
  return new Uint8Array(data instanceof Blob ? await data.arrayBuffer() : data);
}

type Made = { changeId?: string; at?: ChangeInit["at"] };

/** Creates a space, made by the device now unless `made` says otherwise. */
export function spaceCreate(
  space: { spaceId?: string; kind?: SpaceKind; name: string },
  made: Made = {},
): ChangeInit {
  const value = { spaceId: newId(), kind: SpaceKind.SHARED, ...space };
  return { ...madeNow(made), change: { case: "spaceCreate", value } };
}

/** Renames a space, made by the device now unless `made` says otherwise. */
export function spaceRename(spaceId: string, name: string, made: Made = {}): ChangeInit {
  return { ...madeNow(made), change: { case: "spaceRename", value: { spaceId, name } } };
}

/** Creates a page, made by the device now unless `made` says otherwise. */
export function pageCreate(
  page: MessageInitShape<typeof PageCreateSchema>,
  made: Made = {},
): ChangeInit {
  return { ...madeNow(made), change: { case: "pageCreate", value: page } };
}

/** Creates a task, made by the device now unless `made` says otherwise. */
export function itemCreate(
  item: Omit<MessageInitShape<typeof ItemCreateSchema>, "$typeName"> & { spaceId: string },
  made: Made = {},
): ChangeInit {
  const value = { itemId: newId(), kind: ItemKind.TASK, title: "Buy milk", ...item };
  return { ...madeNow(made), change: { case: "itemCreate", value } };
}

/** Places a task's sticker, made by the device now unless `made` says otherwise. */
export function stickerPlace(
  sticker: Omit<MessageInitShape<typeof StickerPlaceSchema>, "$typeName"> & {
    pageId: string;
    itemId: string;
  },
  made: Made = {},
): ChangeInit {
  const value = { stickerId: newId(), kind: StickerKind.TASK, x: 36, y: 36, ...sticker };
  return { ...madeNow(made), change: { case: "stickerPlace", value } };
}

/** Changes a task's title, made by the device now unless `made` says otherwise. */
export function itemSetTitle(itemId: string, title: string, made: Made = {}): ChangeInit {
  return { ...madeNow(made), change: { case: "itemSetTitle", value: { itemId, title } } };
}

/** Changes a task's description, made by the device now unless `made` says otherwise. */
export function itemSetDescription(
  itemId: string,
  description: string,
  made: Made = {},
): ChangeInit {
  return {
    ...madeNow(made),
    change: { case: "itemSetDescription", value: { itemId, description } },
  };
}

/** Changes or clears a task's date, made by the device now unless `made` says otherwise. */
export function itemSetDate(itemId: string, date: string, made: Made = {}): ChangeInit {
  return { ...madeNow(made), change: { case: "itemSetDate", value: { itemId, date } } };
}

/** Moves a task to another space, made by the device now unless `made` says otherwise. */
export function itemMove(itemId: string, spaceId: string, made: Made = {}): ChangeInit {
  return { ...madeNow(made), change: { case: "itemMove", value: { itemId, spaceId } } };
}

/** Deletes a task, made by the device now unless `made` says otherwise. */
export function itemDelete(itemId: string, made: Made = {}): ChangeInit {
  return { ...madeNow(made), change: { case: "itemDelete", value: { itemId } } };
}

/** Moves a sticker, made by the device now unless `made` says otherwise. */
export function stickerMove(stickerId: string, x: number, y: number, made: Made = {}): ChangeInit {
  return { ...madeNow(made), change: { case: "stickerMove", value: { stickerId, x, y } } };
}

/** Removes a sticker, made by the device now unless `made` says otherwise. */
export function stickerRemove(stickerId: string, made: Made = {}): ChangeInit {
  return { ...madeNow(made), change: { case: "stickerRemove", value: { stickerId } } };
}

/** The id of what a change creates or acts on: a space, a page, an item or a sticker. */
export function idOf({ change }: ChangeInit): string {
  switch (change?.case) {
    case "spaceCreate":
    case "spaceRename":
      return change.value.spaceId ?? "";
    case "pageCreate":
      return change.value.pageId ?? "";
    case "itemCreate":
    case "itemSetTitle":
    case "itemSetDescription":
    case "itemSetDate":
    case "itemMove":
    case "itemDelete":
      return change.value.itemId ?? "";
    case "stickerPlace":
    case "stickerMove":
    case "stickerRemove":
      return change.value.stickerId ?? "";
    default:
      throw new Error("The change names no id");
  }
}

function madeNow(made: Made): Made {
  return { changeId: newId(), at: timestampFromMs(Date.now()), ...made };
}

/** When a change was made, `ms` milliseconds since 1970. */
export const madeAt = timestampFromMs;

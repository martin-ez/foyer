import { create, fromBinary, type MessageInitShape, toBinary } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import {
  a2Landscape,
  a4Portrait,
  itemPageId,
  newId,
  pageMargin,
  signedOutCloseCode,
  spacePageId,
  stickerGap,
  taskStickerSize,
} from "@foyer/shared";
import { GoogleConnectionState } from "@foyer/shared/gen/foyer/calendar/v1/calendar_pb";
import { ItemKind, RepeatFrom } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import { PageKind } from "@foyer/shared/gen/foyer/page/v1/page_pb";
import { CalendarState, SpaceKind } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import { StickerKind } from "@foyer/shared/gen/foyer/sticker/v1/sticker_pb";
import {
  type Change,
  type DeviceMessage,
  DeviceMessageSchema,
  HouseholdMessageSchema,
  type Push,
  RowKind,
  type RowSchema,
} from "@foyer/shared/gen/foyer/sync/v1/sync_pb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stickersOn } from "../src/page/sticker-layout";
import {
  type Connect,
  type ConnectionEvents,
  HouseholdSync,
  keepAliveInterval,
  longestReconnectDelay,
  pushChangeLimit,
  silenceLimit,
} from "../src/sync/household-sync";
import { reportEvents, syncAddress } from "../src/sync/socket";

type RowInit = MessageInitShape<typeof RowSchema>;

const me = "019a8f4e-5c00-7000-8000-000000000001";
const housemate = "019a8f4e-5c00-7000-8000-000000000002";

class HouseholdEnd {
  readonly received: DeviceMessage[] = [];
  readonly texts: string[] = [];
  closedByDevice = false;

  constructor(readonly events: ConnectionEvents) {}

  send(data: Uint8Array | string) {
    if (typeof data === "string") this.texts.push(data);
    else this.received.push(fromBinary(DeviceMessageSchema, data));
  }

  close() {
    this.closedByDevice = true;
  }

  welcome(seq: number) {
    this.#say({ case: "welcome", value: { seq: BigInt(seq) } });
  }

  reply(rows: RowInit[], cursor: number, done = true) {
    this.#say({ case: "pullReply", value: { rows, cursor: BigInt(cursor), done } });
  }

  update(...rows: RowInit[]) {
    this.#say({ case: "updates", value: { rows } });
  }

  commit(push: Push, refused: Record<string, string> = {}, firstSeq = 100) {
    const results = push.changes.map(({ changeId }, index) => ({
      changeId,
      result: refused[changeId]
        ? { case: "refused" as const, value: { reason: refused[changeId] } }
        : { case: "seq" as const, value: BigInt(firstSeq + index) },
    }));
    this.#say({ case: "committed", value: { pushId: push.pushId, results } });
  }

  closeWith(code: number) {
    this.events.closed(code);
  }

  here(pageId: string, ...memberIds: string[]) {
    this.#say({
      case: "here",
      value: { pageId, members: memberIds.map((memberId) => ({ memberId })) },
    });
  }

  entered(): string[] {
    return this.received.flatMap(({ message }) =>
      message.case === "enter" ? [message.value.pageId] : [],
    );
  }

  pulls(): number[] {
    return this.received.flatMap(({ message }) =>
      message.case === "pull" ? [Number(message.value.cursor)] : [],
    );
  }

  pushes(): Push[] {
    return this.received.flatMap(({ message }) => (message.case === "push" ? [message.value] : []));
  }

  lastPush(): Push {
    const push = this.pushes().at(-1);
    if (!push) throw new Error("Nothing was pushed");
    return push;
  }

  #say(message: MessageInitShape<typeof HouseholdMessageSchema>["message"]) {
    this.events.received(
      toBinary(HouseholdMessageSchema, create(HouseholdMessageSchema, { message })),
    );
  }
}

function spaceRow(
  seq: number,
  space: {
    id?: string;
    kind?: SpaceKind;
    ownerId?: string;
    name: string;
    calendarMemberId?: string;
    calendarState?: CalendarState;
  },
): RowInit {
  const value = { id: newId(), kind: SpaceKind.SHARED, ...space };
  return { seq: BigInt(seq), row: { case: "space", value } };
}

function pageRow(
  seq: number,
  page: {
    id: string;
    kind?: PageKind;
    spaceId?: string;
    number?: number;
    itemId?: string;
    width?: number;
    height?: number;
  },
): RowInit {
  const value = { kind: PageKind.DAY, ...a4Portrait, ...page };
  return { seq: BigInt(seq), row: { case: "page", value } };
}

function itemRow(
  seq: number,
  item: {
    id: string;
    spaceId: string;
    title: string;
    date?: string;
    repeat?: string;
    repeatFrom?: RepeatFrom;
    parentId?: string;
  },
): RowInit {
  return { seq: BigInt(seq), row: { case: "item", value: { kind: ItemKind.TASK, ...item } } };
}

function stickerRow(
  seq: number,
  sticker: {
    id: string;
    pageId: string;
    itemId: string;
    x?: number;
    y?: number;
    placedAt?: number;
  },
): RowInit {
  const { placedAt = 0, ...rest } = sticker;
  const value = {
    kind: StickerKind.TASK,
    x: 36,
    y: 48,
    placedAt: timestampFromMs(placedAt),
    ...rest,
  };
  return { seq: BigInt(seq), row: { case: "sticker", value } };
}

function completionRow(
  seq: number,
  completion: { id: string; itemId: string; doneBy: string; occurrence?: string },
): RowInit {
  return { seq: BigInt(seq), row: { case: "completion", value: completion } };
}

function memberRow(seq: number, member: { id: string; name: string }): RowInit {
  return { seq: BigInt(seq), row: { case: "member", value: member } };
}

const inbox = {
  id: "019a8f4e-5c00-7000-8000-0000000000a1",
  kind: SpaceKind.INBOX,
  ownerId: me,
  name: "",
};
const home = { id: "019a8f4e-5c00-7000-8000-0000000000a2", name: "Home" };

let connections: HouseholdEnd[];
let sync: HouseholdSync;

const connect: Connect = (events) => {
  const end = new HouseholdEnd(events);
  connections.push(end);
  return end;
};

function household(): HouseholdEnd {
  const end = connections.at(-1);
  if (!end) throw new Error("The device hasn't connected");
  return end;
}

function startUpToDate(rows: RowInit[] = [spaceRow(1, inbox), spaceRow(2, home)], seq = 2) {
  sync.start();
  household().welcome(seq);
  household().reply(rows, seq);
}

function nameIn({ change }: Change) {
  return change.case === "spaceCreate" || change.case === "spaceRename" ? change.value.name : null;
}

function names() {
  return sync
    .getState()
    .spaces.map(({ name, kind }) => (kind === SpaceKind.INBOX ? "Inbox" : name));
}

beforeEach(() => {
  vi.useFakeTimers();
  connections = [];
  sync = new HouseholdSync({ memberId: me, connect });
});

afterEach(() => {
  sync.stop();
  vi.useRealTimers();
});

describe("catching up", () => {
  it("connects when started, and pulls everything the first time", () => {
    sync.start();
    expect(sync.getState().status).toBe("connecting");

    household().welcome(2);

    expect(sync.getState().status).toBe("catching-up");
    expect(household().pulls()).toEqual([0]);
  });

  it("pulls again from each reply's cursor until the household says it's done", () => {
    sync.start();
    household().welcome(4);

    household().reply([spaceRow(1, inbox), spaceRow(2, home)], 2, false);
    household().reply([memberRow(4, { id: housemate, name: "Sam" })], 4, true);

    expect(household().pulls()).toEqual([0, 2]);
    expect(sync.getState()).toMatchObject({
      status: "up-to-date",
      members: [{ id: housemate, name: "Sam" }],
    });
    expect(names()).toEqual(["Inbox", "Home"]);
  });

  it("lists the Inbox, then personal spaces, then shared ones, each in the order they were made", () => {
    startUpToDate([
      spaceRow(1, { id: "019a8f4e-5c00-7000-8000-0000000000b3", name: "Later shared" }),
      spaceRow(2, { id: "019a8f4e-5c00-7000-8000-0000000000b2", name: "Shared" }),
      spaceRow(3, {
        id: "019a8f4e-5c00-7000-8000-0000000000b1",
        kind: SpaceKind.PERSONAL,
        ownerId: me,
        name: "Personal",
      }),
      spaceRow(4, inbox),
    ]);

    expect(names()).toEqual(["Inbox", "Personal", "Shared", "Later shared"]);
  });

  it("keeps the newer of two versions of a row, whichever arrives first", () => {
    sync.start();
    household().welcome(9);
    household().update(spaceRow(9, { ...home, name: "Newer" }));

    household().reply([spaceRow(5, { ...home, name: "Older" })], 9);

    expect(names()).toEqual(["Newer"]);
  });

  it("drops a deleted row, and keeps it dropped when an older version arrives", () => {
    startUpToDate();

    household().update({
      seq: 5n,
      row: { case: "deleted", value: { kind: RowKind.SPACE, id: home.id } },
    });
    household().update(spaceRow(3, home));

    expect(names()).toEqual(["Inbox"]);
  });

  it("applies what others change as the household sends it", () => {
    startUpToDate();

    household().update(spaceRow(3, { ...home, name: "Our home" }));

    expect(names()).toEqual(["Inbox", "Our home"]);
  });
});

describe("pages", () => {
  it("keeps the pages the household sends, by id, with the size each was made with", () => {
    startUpToDate([spaceRow(1, inbox), pageRow(2, { id: "day:2026-11-17" })]);

    household().update(pageRow(3, { id: "day:2026-11-18", ...a2Landscape }));

    const { pages } = sync.getState();
    expect([...pages.keys()]).toEqual(["day:2026-11-17", "day:2026-11-18"]);
    expect(pages.get("day:2026-11-17")).toMatchObject(a4Portrait);
    expect(pages.get("day:2026-11-18")).toMatchObject(a2Landscape);
  });

  it("drops a deleted page", () => {
    startUpToDate([pageRow(1, { id: "day:2026-11-17" })], 1);

    household().update({
      seq: 2n,
      row: { case: "deleted", value: { kind: RowKind.PAGE, id: "day:2026-11-17" } },
    });

    expect(sync.getState().pages.size).toBe(0);
  });
});

describe("Google Calendar", () => {
  const connected = (seq: number, state = GoogleConnectionState.CONNECTED): RowInit => ({
    seq: BigInt(seq),
    row: { case: "googleConnection", value: { memberId: me, state } },
  });

  it("knows whether the member is connected, and when their access needs reconnecting", () => {
    startUpToDate();
    const before = sync.getState().googleConnection;

    household().update(connected(3));
    const after = sync.getState().googleConnection;
    household().update(connected(4, GoogleConnectionState.NEEDS_RECONNECTING));

    expect(before).toBeNull();
    expect(after?.state).toBe(GoogleConnectionState.CONNECTED);
    expect(sync.getState().googleConnection?.state).toBe(GoogleConnectionState.NEEDS_RECONNECTING);
  });

  it("forgets the connection once the member disconnects", () => {
    startUpToDate([spaceRow(1, inbox), connected(2)]);

    household().update({
      seq: 3n,
      row: { case: "deleted", value: { kind: RowKind.GOOGLE_CONNECTION, id: me } },
    });

    expect(sync.getState().googleConnection).toBeNull();
  });

  it("keeps where each space's calendar stands", () => {
    startUpToDate();

    household().update(
      spaceRow(3, { ...home, calendarMemberId: me, calendarState: CalendarState.PAUSED }),
    );

    expect(sync.getState().spaces.find(({ id }) => id === home.id)).toMatchObject({
      calendarMemberId: me,
      calendarState: CalendarState.PAUSED,
    });
  });
});

describe("changing things", () => {
  it("shows a new space at once, and keeps it once the household commits it", () => {
    startUpToDate();

    const spaceId = sync.createSpace(SpaceKind.SHARED, "Garden");

    expect(names()).toEqual(["Inbox", "Home", "Garden"]);
    expect(sync.getState().unsaved).toBe(1);
    const push = household().lastPush();
    expect(push.changes.map(({ change }) => change.case === "spaceCreate" && change.value)).toEqual(
      [expect.objectContaining({ spaceId, kind: SpaceKind.SHARED, name: "Garden" })],
    );

    household().update(spaceRow(3, { id: spaceId, name: "Garden" }));
    household().commit(push);

    expect(names()).toEqual(["Inbox", "Home", "Garden"]);
    expect(sync.getState().unsaved).toBe(0);
  });

  it("makes a new personal space the member's own", () => {
    startUpToDate();

    const spaceId = sync.createSpace(SpaceKind.PERSONAL, "Work");

    expect(sync.getState().spaces).toContainEqual(
      expect.objectContaining({ id: spaceId, kind: SpaceKind.PERSONAL, ownerId: me, name: "Work" }),
    );
  });

  it("says when each change was made, with an id of its own", () => {
    vi.setSystemTime(Date.UTC(2026, 10, 16, 9));
    startUpToDate();

    sync.renameSpace(home.id, "Our home");
    sync.renameSpace(home.id, "Home sweet home");

    const changes = household()
      .pushes()
      .flatMap(({ changes }) => changes);
    expect(changes.map(({ at }) => Number(at?.seconds) * 1000)).toEqual([
      Date.UTC(2026, 10, 16, 9),
      Date.UTC(2026, 10, 16, 9),
    ]);
    expect(new Set(changes.map(({ changeId }) => changeId)).size).toBe(2);
  });

  it("undoes a change the household refuses, and says it couldn't be saved", () => {
    startUpToDate();
    sync.renameSpace(home.id, "Our home");
    const push = household().lastPush();
    const changeId = push.changes[0]?.changeId ?? "";

    household().commit(push, { [changeId]: "There's no such space." });

    expect(names()).toEqual(["Inbox", "Home"]);
    expect(sync.getState()).toMatchObject({
      unsaved: 0,
      problems: ["Couldn't save renaming a space to “Our home”: There's no such space."],
    });
  });

  it("forgets the refused changes it reported once they're dismissed", () => {
    startUpToDate();
    sync.renameSpace(home.id, "Our home");
    const push = household().lastPush();
    household().commit(push, { [push.changes[0]?.changeId ?? ""]: "No." });

    sync.dismissProblems();

    expect(sync.getState().problems).toEqual([]);
  });

  it("shows the household's version when a change loses to one made later", () => {
    startUpToDate();
    sync.renameSpace(home.id, "Made earlier");
    const push = household().lastPush();

    household().update(spaceRow(2, home));
    household().commit(push);

    expect(names()).toEqual(["Inbox", "Home"]);
  });

  it("keeps changes made while offline, and sends them once connected", () => {
    sync.createSpace(SpaceKind.SHARED, "Garden");
    expect(names()).toEqual(["Garden"]);

    sync.start();
    expect(household().pushes()).toEqual([]);
    household().welcome(2);

    expect(household().lastPush().changes).toHaveLength(1);
  });

  it(`sends at most ${pushChangeLimit} changes in a push`, () => {
    for (let index = 0; index <= pushChangeLimit; index++) {
      sync.createSpace(SpaceKind.SHARED, `Space ${index}`);
    }

    startUpToDate();

    expect(
      household()
        .pushes()
        .map(({ changes }) => changes.length),
    ).toEqual([pushChangeLimit, 1]);
  });
});

describe("naming spaces", () => {
  it("drops spaces at the start and end of the names it sends", () => {
    startUpToDate();

    sync.createSpace(SpaceKind.SHARED, "  Garden ");
    sync.renameSpace(home.id, "\tOur home  ");

    const sent = household()
      .pushes()
      .flatMap(({ changes }) => changes)
      .map(nameIn);
    expect(sent).toEqual(["Garden", "Our home"]);
    expect(names()).toEqual(["Inbox", "Our home", "Garden"]);
  });

  it("shows a new space numbered at once when another the member sees has its name", () => {
    startUpToDate();

    sync.createSpace(SpaceKind.PERSONAL, "home");

    expect(names()).toEqual(["Inbox", "home 2", "Home"]);
    const push = household().lastPush();
    expect(push.changes.map(nameIn)).toEqual(["home"]);
  });

  it.each([
    ["a blank name", "   ", undefined, "A space's name can't be blank."],
    [
      "a name over 120 characters",
      "a".repeat(121),
      undefined,
      "A space's name can't be longer than 120 characters.",
    ],
    [
      "renaming to another space's name, ignoring case",
      " HOME ",
      "garden",
      "Another space you see is called “Home”.",
    ],
    ["renaming to the space's own name in another case", "HOME", "home", null],
    ["creating a space with a name another has, which is numbered", "Home", undefined, null],
  ])("says what's wrong with %s", (_, name, renaming, problem) => {
    startUpToDate();
    const garden = sync.createSpace(SpaceKind.SHARED, "Garden");
    const spaceId = { garden, home: home.id }[renaming ?? ""];

    expect(sync.nameProblem(name, spaceId)).toBe(problem);
  });
});

describe("losing the connection", () => {
  it("connects again, and catches up from where it left off", () => {
    startUpToDate();
    household().update(spaceRow(7, { ...home, name: "Our home" }));

    household().closeWith(1006);
    expect(sync.getState().status).toBe("offline");
    vi.advanceTimersByTime(1000);
    household().welcome(9);

    expect(connections).toHaveLength(2);
    expect(household().pulls()).toEqual([7]);
  });

  it("sends unsaved changes again, as the same changes, once connected again", () => {
    startUpToDate();
    sync.renameSpace(home.id, "Our home");
    const sent = household().lastPush();

    household().closeWith(1006);
    vi.advanceTimersByTime(1000);
    household().welcome(2);

    const again = household().lastPush();
    expect(again.changes.map(({ changeId }) => changeId)).toEqual(
      sent.changes.map(({ changeId }) => changeId),
    );
    expect(names()).toEqual(["Inbox", "Our home"]);
  });

  it("waits longer after each failed attempt, up to a limit", () => {
    sync.start();
    const waits: number[] = [];

    for (let attempt = 0; attempt < 7; attempt++) {
      const before = connections.length;
      household().closeWith(1006);
      let waited = 0;
      while (connections.length === before) {
        vi.advanceTimersByTime(500);
        waited += 500;
      }
      waits.push(waited);
    }

    expect(waits).toEqual([
      1000,
      2000,
      4000,
      8000,
      16000,
      longestReconnectDelay,
      longestReconnectDelay,
    ]);
  });

  it("waits only a moment again once a connection has worked", () => {
    sync.start();
    household().closeWith(1006);
    vi.advanceTimersByTime(1000);
    household().closeWith(1006);
    vi.advanceTimersByTime(2000);

    household().welcome(0);
    household().closeWith(1006);
    vi.advanceTimersByTime(1000);

    expect(connections).toHaveLength(4);
  });

  it("says it's still there, and connects again when the household goes quiet", () => {
    startUpToDate();

    vi.advanceTimersByTime(keepAliveInterval);
    expect(household().texts).toEqual(["ping"]);

    const quiet = household();
    vi.advanceTimersByTime(silenceLimit);
    expect(quiet.closedByDevice).toBe(true);
    vi.advanceTimersByTime(longestReconnectDelay);
    expect(household()).not.toBe(quiet);
  });

  it("stays connected while the household answers", () => {
    startUpToDate();

    for (let elapsed = 0; elapsed < 3 * silenceLimit; elapsed += keepAliveInterval) {
      vi.advanceTimersByTime(keepAliveInterval);
      household().events.received("pong");
    }

    expect(connections).toHaveLength(1);
  });

  it("stops connecting once the household says the session has ended", () => {
    startUpToDate();

    household().closeWith(signedOutCloseCode);
    vi.advanceTimersByTime(10 * longestReconnectDelay);

    expect(sync.getState().status).toBe("signed-out");
    expect(connections).toHaveLength(1);
  });

  it("closes the connection and stops connecting when stopped", () => {
    startUpToDate();

    sync.stop();
    vi.advanceTimersByTime(10 * longestReconnectDelay);

    expect(household().closedByDevice).toBe(true);
    expect(sync.getState().status).toBe("offline");
    expect(connections).toHaveLength(1);
  });
});

describe("watching the state", () => {
  it("tells subscribers about each change until they unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = sync.subscribe(listener);
    startUpToDate();
    const calls = listener.mock.calls.length;

    unsubscribe();
    sync.createSpace(SpaceKind.SHARED, "Garden");

    expect(calls).toBeGreaterThan(0);
    expect(listener).toHaveBeenCalledTimes(calls);
  });

  it("returns the same state until something changes", () => {
    startUpToDate();
    const before = sync.getState();

    expect(sync.getState()).toBe(before);
    sync.createSpace(SpaceKind.SHARED, "Garden");
    expect(sync.getState()).not.toBe(before);
  });
});

describe("the sync address", () => {
  it.each([
    ["http://localhost:8787", "ws://localhost:8787/sync"],
    ["https://foyer.example.com", "wss://foyer.example.com/sync"],
  ])("of %s is %s", (backendUrl, address) => {
    expect(syncAddress(backendUrl)).toBe(address);
  });
});

describe("a WebSocket's events", () => {
  type FakeSocket = {
    binaryType: string;
    onopen: () => void;
    onmessage: (event: { data: unknown }) => void;
    onclose: (event: { code?: number }) => void;
  };

  function reported() {
    const socket = { binaryType: "blob" } as FakeSocket;
    const events = { opened: vi.fn(), received: vi.fn(), closed: vi.fn() };
    reportEvents(socket as unknown as WebSocket, events);
    return { socket, events };
  }

  it("asks for binary messages as bytes, and reports them as bytes", () => {
    const { socket, events } = reported();

    socket.onmessage({ data: new Uint8Array([1, 2, 3]).buffer });

    expect(socket.binaryType).toBe("arraybuffer");
    expect(events.received).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
  });

  it("reports text messages as text", () => {
    const { socket, events } = reported();

    socket.onmessage({ data: "pong" });

    expect(events.received).toHaveBeenCalledWith("pong");
  });

  it("reports that it opened", () => {
    const { socket, events } = reported();

    socket.onopen();

    expect(events.opened).toHaveBeenCalled();
  });

  it.each([
    ["with its code", signedOutCloseCode, signedOutCloseCode],
    ["as 0 when it has no code", undefined, 0],
  ])("reports that it closed, %s", (_, code, reportedCode) => {
    const { socket, events } = reported();

    socket.onclose({ code });

    expect(events.closed).toHaveBeenCalledWith(reportedCode);
  });
});

describe("the live lane", () => {
  it("enters the device's page each time it connects, on the same connection", () => {
    sync.live.enter("day:2026-11-17");
    startUpToDate();
    expect(household().entered()).toEqual(["day:2026-11-17"]);

    household().closeWith(1006);
    vi.advanceTimersByTime(1000);
    household().welcome(2);

    expect(household().entered()).toEqual(["day:2026-11-17"]);
  });

  it("keeps who else is on the page, and forgets them once the connection closes", () => {
    sync.live.enter("day:2026-11-17");
    startUpToDate();

    household().here("day:2026-11-17", housemate);
    expect(sync.live.getState().here).toEqual([{ memberId: housemate, position: null }]);

    household().closeWith(1006);
    expect(sync.live.getState().here).toEqual([]);
  });
});

describe("tasks and stickers", () => {
  const inboxPage = spacePageId(inbox.id, 1);
  const task = { id: "019a8f4e-5c00-7000-8000-0000000000c1", spaceId: inbox.id, title: "Buy milk" };
  const sticker = {
    id: "019a8f4e-5c00-7000-8000-0000000000d1",
    pageId: inboxPage,
    itemId: task.id,
  };
  const inboxPageRow = pageRow(2, {
    id: inboxPage,
    kind: PageKind.SPACE,
    spaceId: inbox.id,
    number: 1,
  });

  function changesIn(push: Push) {
    return push.changes.map(({ change }) => ({ case: change.case, value: change.value }));
  }

  it("keeps the tasks and stickers the household sends, and drops a removed sticker", () => {
    startUpToDate([spaceRow(1, inbox), inboxPageRow, itemRow(3, task), stickerRow(4, sticker)], 4);

    expect(sync.getState().items.get(task.id)).toMatchObject({ title: "Buy milk" });
    expect(sync.getState().stickers.get(sticker.id)).toMatchObject({ pageId: inboxPage, x: 36 });

    household().update({
      seq: 5n,
      row: { case: "deleted", value: { kind: RowKind.STICKER, id: sticker.id } },
    });

    expect(sync.getState().stickers.size).toBe(0);
    expect(sync.getState().items.has(task.id)).toBe(true);
  });

  it("adds a task on a space's first page, creating the task, the page and its sticker in one push", () => {
    startUpToDate([spaceRow(1, inbox)], 1);

    const { itemId, pageNumber } = sync.addTask(inbox.id, "  Buy milk ");

    expect(pageNumber).toBe(1);
    const push = household().lastPush();
    expect(changesIn(push)).toEqual([
      {
        case: "itemCreate",
        value: expect.objectContaining({
          itemId,
          kind: ItemKind.TASK,
          spaceId: inbox.id,
          title: "Buy milk",
        }),
      },
      {
        case: "pageCreate",
        value: expect.objectContaining({
          pageId: inboxPage,
          kind: PageKind.SPACE,
          number: 1,
          ...a4Portrait,
        }),
      },
      {
        case: "stickerPlace",
        value: expect.objectContaining({
          pageId: inboxPage,
          x: pageMargin,
          y: pageMargin,
          kind: StickerKind.TASK,
          itemId,
        }),
      },
    ]);
    const state = sync.getState();
    expect(state.pages.has(inboxPage)).toBe(true);
    expect(state.items.get(itemId)).toMatchObject({ title: "Buy milk", createdBy: me });
    expect(stickersOn(inboxPage, state.stickers.values())).toEqual([
      expect.objectContaining({ itemId, placedBy: me }),
    ]);
    expect(state.unsaved).toBe(3);
  });

  it("places each new task's sticker below the last one, on a page that already exists", () => {
    startUpToDate([spaceRow(1, inbox), inboxPageRow, itemRow(3, task), stickerRow(4, sticker)], 4);

    sync.addTask(inbox.id, "Water the plants");

    const placed = changesIn(household().lastPush());
    expect(placed.map((change) => change.case)).toEqual(["itemCreate", "stickerPlace"]);
    expect(placed[1]?.value).toMatchObject({
      x: pageMargin,
      y: 48 + taskStickerSize.height + stickerGap,
    });
  });

  it("puts a task on the space's next page when its newest page is full", () => {
    const low = a4Portrait.height - pageMargin - taskStickerSize.height;
    startUpToDate(
      [spaceRow(1, inbox), inboxPageRow, itemRow(3, task), stickerRow(4, { ...sticker, y: low })],
      4,
    );

    const { pageNumber } = sync.addTask(inbox.id, "Water the plants");

    expect(pageNumber).toBe(2);
    const placed = changesIn(household().lastPush());
    expect(placed[1]).toEqual({
      case: "pageCreate",
      value: expect.objectContaining({ pageId: spacePageId(inbox.id, 2), number: 2 }),
    });
    expect(placed[2]?.value).toMatchObject({ pageId: spacePageId(inbox.id, 2), y: pageMargin });
  });

  it("moves a sticker at once, bringing it to the top, until the household says otherwise", () => {
    vi.setSystemTime(Date.UTC(2026, 10, 17, 9));
    const other = { ...sticker, id: "019a8f4e-5c00-7000-8000-0000000000d2", placedAt: 1000 };
    startUpToDate(
      [
        spaceRow(1, inbox),
        inboxPageRow,
        itemRow(3, task),
        stickerRow(4, sticker),
        stickerRow(5, other),
      ],
      5,
    );

    sync.moveSticker(sticker.id, 120, 200);

    const push = household().lastPush();
    expect(changesIn(push)).toEqual([
      {
        case: "stickerMove",
        value: expect.objectContaining({ stickerId: sticker.id, x: 120, y: 200 }),
      },
    ]);
    const stacked = stickersOn(inboxPage, sync.getState().stickers.values());
    expect(stacked.map(({ id, x, y }) => ({ id, x, y }))).toEqual([
      { id: other.id, x: 36, y: 48 },
      { id: sticker.id, x: 120, y: 200 },
    ]);

    household().commit(push, { [push.changes[0]?.changeId ?? ""]: "There's no such sticker." });

    expect(sync.getState().stickers.get(sticker.id)).toMatchObject({ x: 36, y: 48 });
    expect(sync.getState().problems).toEqual([
      "Couldn't save moving a sticker: There's no such sticker.",
    ]);
  });

  it("changes a task's title, description and date at once, and undoes a refused change", () => {
    startUpToDate([spaceRow(1, inbox), itemRow(2, task)], 2);

    sync.setTitle(task.id, " Buy oat milk ");
    sync.setDescription(task.id, "From the corner shop");
    sync.setDate(task.id, "2026-11-20");

    expect(household().pushes().flatMap(changesIn)).toEqual([
      {
        case: "itemSetTitle",
        value: expect.objectContaining({ itemId: task.id, title: "Buy oat milk" }),
      },
      {
        case: "itemSetDescription",
        value: expect.objectContaining({ itemId: task.id, description: "From the corner shop" }),
      },
      {
        case: "itemSetDate",
        value: expect.objectContaining({ itemId: task.id, date: "2026-11-20" }),
      },
    ]);
    expect(sync.getState().items.get(task.id)).toMatchObject({
      title: "Buy oat milk",
      description: "From the corner shop",
      date: "2026-11-20",
    });

    const push = household().lastPush();
    household().commit(push, { [push.changes[0]?.changeId ?? ""]: "There's no such item." });

    expect(sync.getState().items.get(task.id)).toMatchObject({ date: "" });
    expect(sync.getState().problems).toEqual([
      "Couldn't save changing a task's date: There's no such item.",
    ]);
  });

  it("moves a task to another space, with its sticker going to that space's newest page", () => {
    startUpToDate(
      [
        spaceRow(1, inbox),
        spaceRow(2, home),
        inboxPageRow,
        itemRow(3, task),
        stickerRow(4, sticker),
      ],
      4,
    );

    const moved = sync.moveTask(task.id, home.id);

    expect(moved).toEqual({ pageNumber: 1 });
    const homePage = spacePageId(home.id, 1);
    expect(changesIn(household().lastPush())).toEqual([
      { case: "itemMove", value: expect.objectContaining({ itemId: task.id, spaceId: home.id }) },
      { case: "stickerRemove", value: expect.objectContaining({ stickerId: sticker.id }) },
      {
        case: "pageCreate",
        value: expect.objectContaining({ pageId: homePage, spaceId: home.id }),
      },
      {
        case: "stickerPlace",
        value: expect.objectContaining({
          pageId: homePage,
          itemId: task.id,
          x: pageMargin,
          y: pageMargin,
        }),
      },
    ]);
    const state = sync.getState();
    expect(state.items.get(task.id)).toMatchObject({ spaceId: home.id });
    expect(stickersOn(inboxPage, state.stickers.values())).toEqual([]);
    expect(stickersOn(homePage, state.stickers.values())).toEqual([
      expect.objectContaining({ itemId: task.id }),
    ]);
  });

  it("moves nothing when a task is already in the space", () => {
    startUpToDate([spaceRow(1, inbox), itemRow(2, task)], 2);

    expect(sync.moveTask(task.id, inbox.id)).toBe(null);
    expect(household().pushes()).toEqual([]);
  });

  it("deletes a task and its stickers at once", () => {
    startUpToDate([spaceRow(1, inbox), inboxPageRow, itemRow(3, task), stickerRow(4, sticker)], 4);

    sync.deleteTask(task.id);

    expect(changesIn(household().lastPush())).toEqual([
      { case: "itemDelete", value: expect.objectContaining({ itemId: task.id }) },
    ]);
    expect(sync.getState().items.size).toBe(0);
    expect(sync.getState().stickers.size).toBe(0);
  });

  it("drops a task the household says the member no longer sees, keeping its stickers hidden", () => {
    startUpToDate([spaceRow(1, inbox), inboxPageRow, itemRow(3, task), stickerRow(4, sticker)], 4);

    household().update({
      seq: 5n,
      row: { case: "deleted", value: { kind: RowKind.ITEM, id: task.id } },
    });

    expect(sync.getState().items.has(task.id)).toBe(false);
    expect(sync.getState().stickers.has(sticker.id)).toBe(true);
  });

  it("says why a task's title would be refused", () => {
    expect(sync.titleProblem("   ")).toBe("A task's title can't be blank.");
    expect(sync.titleProblem(" Buy milk ")).toBe(null);
  });
});

describe("ticking tasks", () => {
  const task = { id: "019a8f4e-5c00-7000-8000-0000000000c1", spaceId: inbox.id, title: "Buy milk" };
  const completion = { id: "019a8f4e-5c00-7000-8000-0000000000e1", itemId: task.id };

  function completions() {
    return [...sync.getState().completions.values()].map(({ itemId, doneBy, occurrence }) => ({
      itemId,
      doneBy,
      occurrence,
    }));
  }

  it("ticks a task at once with a completion of its own, kept once the household commits it", () => {
    startUpToDate([spaceRow(1, inbox), itemRow(2, task)], 2);
    vi.setSystemTime(Date.UTC(2026, 10, 17, 9, 30));

    sync.tickTask(task.id);

    const [tick] = household().lastPush().changes;
    expect(tick?.change).toEqual({
      case: "taskTick",
      value: expect.objectContaining({ itemId: task.id, occurrence: "" }),
    });
    const ticked = { itemId: task.id, doneBy: me, occurrence: "" };
    expect(completions()).toEqual([ticked]);
    const [shown] = sync.getState().completions.values();
    expect(shown?.doneAt).toEqual(tick?.at);
    const completionId = tick?.change.case === "taskTick" ? tick.change.value.completionId : "";
    expect(shown?.id).toBe(completionId);

    household().update(completionRow(3, { id: completionId, itemId: task.id, doneBy: me }));
    household().commit(household().lastPush(), {}, 3);

    expect(completions()).toEqual([ticked]);
    expect(sync.getState().unsaved).toBe(0);
  });

  it("shows a task ticked twice with one completion", () => {
    startUpToDate(
      [
        spaceRow(1, inbox),
        itemRow(2, task),
        completionRow(3, { ...completion, doneBy: housemate }),
      ],
      3,
    );

    sync.tickTask(task.id);

    expect(completions()).toEqual([{ itemId: task.id, doneBy: housemate, occurrence: "" }]);
  });

  it("unticks a task at once, whoever ticked it", () => {
    startUpToDate(
      [
        spaceRow(1, inbox),
        itemRow(2, task),
        completionRow(3, { ...completion, doneBy: housemate }),
      ],
      3,
    );

    sync.untickTask(task.id);

    expect(
      household()
        .lastPush()
        .changes.map(({ change }) => change),
    ).toEqual([
      { case: "taskUntick", value: expect.objectContaining({ itemId: task.id, occurrence: "" }) },
    ]);
    expect(completions()).toEqual([]);
  });

  it("keeps the completions the household sends, and drops an unticked one", () => {
    startUpToDate([spaceRow(1, inbox), itemRow(2, task)], 2);

    household().update(completionRow(3, { ...completion, doneBy: housemate }));

    expect(completions()).toEqual([{ itemId: task.id, doneBy: housemate, occurrence: "" }]);

    household().update({
      seq: 4n,
      row: { case: "deleted", value: { kind: RowKind.COMPLETION, id: completion.id } },
    });

    expect(completions()).toEqual([]);
  });

  it("deletes a task with its completions and its body page at once", () => {
    const body = pageRow(4, { id: itemPageId(task.id), kind: PageKind.ITEM, itemId: task.id });
    const done = completionRow(3, { ...completion, doneBy: me });
    startUpToDate([spaceRow(1, inbox), itemRow(2, task), done, body], 4);

    sync.deleteTask(task.id);

    expect(completions()).toEqual([]);
    expect(sync.getState().pages.size).toBe(0);
  });
});

describe("repeating tasks", () => {
  const today = "2026-11-17";
  const task = {
    id: "019a8f4e-5c00-7000-8000-0000000000c1",
    spaceId: inbox.id,
    title: "Put the bins out",
    date: today,
  };
  const bins = { ...task, repeat: "FREQ=WEEKLY;BYDAY=TU", repeatFrom: RepeatFrom.SCHEDULE };

  beforeEach(() => {
    sync = new HouseholdSync({ memberId: me, connect, today: () => today });
  });

  function pushed() {
    return household()
      .lastPush()
      .changes.map(({ change }) => change);
  }

  function shownTask() {
    const item = sync.getState().items.get(task.id);
    return { date: item?.date, repeat: item?.repeat, repeatFrom: item?.repeatFrom };
  }

  function occurrencesDone() {
    return [...sync.getState().completions.values()].map(({ occurrence }) => occurrence);
  }

  it("sets a task's rule at once, with where its next date comes from", () => {
    startUpToDate([spaceRow(1, inbox), itemRow(2, task)], 2);

    sync.setRepeat(task.id, { frequency: "daily", interval: 3 }, "completion");

    expect(pushed()).toEqual([
      {
        case: "itemSetRepeat",
        value: expect.objectContaining({
          itemId: task.id,
          repeat: "FREQ=DAILY;INTERVAL=3",
          repeatFrom: RepeatFrom.COMPLETION,
        }),
      },
    ]);
    expect(shownTask()).toEqual({
      date: today,
      repeat: "FREQ=DAILY;INTERVAL=3",
      repeatFrom: RepeatFrom.COMPLETION,
    });
  });

  it("gives a task without a date the rule's first date from today, in the same push", () => {
    startUpToDate([spaceRow(1, inbox), itemRow(2, { ...task, date: "" })], 2);

    sync.setRepeat(task.id, { frequency: "weekly", interval: 1, days: ["FR"] }, "schedule");

    expect(pushed()).toEqual([
      { case: "itemSetDate", value: expect.objectContaining({ date: "2026-11-20" }) },
      { case: "itemSetRepeat", value: expect.objectContaining({ repeat: "FREQ=WEEKLY;BYDAY=FR" }) },
    ]);
    expect(shownTask().date).toBe("2026-11-20");
  });

  it("stops a task repeating, keeping its date", () => {
    startUpToDate([spaceRow(1, inbox), itemRow(2, bins)], 2);

    sync.setRepeat(task.id, null, "schedule");

    expect(pushed()).toEqual([
      {
        case: "itemSetRepeat",
        value: expect.objectContaining({ repeat: "", repeatFrom: RepeatFrom.UNSPECIFIED }),
      },
    ]);
    expect(shownTask()).toEqual({ date: today, repeat: "", repeatFrom: RepeatFrom.UNSPECIFIED });
  });

  it("ticks a repeating task's occurrence, and moves it to its next date at once", () => {
    startUpToDate([spaceRow(1, inbox), itemRow(2, bins)], 2);

    sync.tickTask(task.id);

    expect(pushed()).toEqual([
      {
        case: "taskTick",
        value: expect.objectContaining({ occurrence: today, nextDate: "2026-11-24" }),
      },
    ]);
    expect(occurrencesDone()).toEqual([today]);
    expect(shownTask().date).toBe("2026-11-24");
  });

  it("skips what was missed when ticking an overdue task on its schedule", () => {
    startUpToDate([spaceRow(1, inbox), itemRow(2, { ...bins, date: "2026-11-03" })], 2);

    sync.tickTask(task.id);

    expect(pushed()).toEqual([
      {
        case: "taskTick",
        value: expect.objectContaining({ occurrence: "2026-11-03", nextDate: "2026-11-24" }),
      },
    ]);
  });

  it("counts the next date from today when a task repeats from completion", () => {
    const plants = { ...task, date: "2026-11-10", repeat: "FREQ=DAILY;INTERVAL=3" };
    startUpToDate(
      [spaceRow(1, inbox), itemRow(2, { ...plants, repeatFrom: RepeatFrom.COMPLETION })],
      2,
    );

    sync.tickTask(task.id);

    expect(shownTask().date).toBe("2026-11-20");
  });

  it("unticks an occurrence done before, and puts the task back on it at once", () => {
    const done = completionRow(3, {
      id: "019a8f4e-5c00-7000-8000-0000000000e1",
      itemId: task.id,
      doneBy: housemate,
      occurrence: today,
    });
    startUpToDate([spaceRow(1, inbox), itemRow(2, { ...bins, date: "2026-11-24" }), done], 3);

    sync.untickTask(task.id, today);

    expect(pushed()).toEqual([
      { case: "taskUntick", value: expect.objectContaining({ occurrence: today }) },
    ]);
    expect(occurrencesDone()).toEqual([]);
    expect(shownTask().date).toBe(today);
  });

  it("shows the household's date once it commits a tick that didn't move the task", () => {
    startUpToDate([spaceRow(1, inbox), itemRow(2, bins)], 2);
    sync.tickTask(task.id);

    household().commit(household().lastPush(), {}, 3);

    expect(shownTask().date).toBe(today);
  });
});

describe("nesting tasks", () => {
  const inboxPage = spacePageId(inbox.id, 1);
  const inboxPageRow = pageRow(3, {
    id: inboxPage,
    kind: PageKind.SPACE,
    spaceId: inbox.id,
    number: 1,
  });
  const party = { id: "019a8f4e-5c00-7000-8000-0000000000c1", spaceId: inbox.id, title: "Party" };
  const food = { id: "019a8f4e-5c00-7000-8000-0000000000c2", spaceId: inbox.id, title: "Food" };
  const cake = { id: "019a8f4e-5c00-7000-8000-0000000000c3", spaceId: inbox.id, title: "Cake" };
  const partyBody = itemPageId(party.id);
  const foodBody = itemPageId(food.id);

  function bodyPageRow(seq: number, itemId: string) {
    return pageRow(seq, { id: itemPageId(itemId), kind: PageKind.ITEM, itemId });
  }

  function stickerId(seq: number) {
    return `019a8f4e-5c00-7000-8000-0000000000${seq}`;
  }

  function stuck(seq: number, itemId: string, pageId: string) {
    return stickerRow(seq, { id: stickerId(seq), pageId, itemId });
  }

  function changesIn(push: Push) {
    return push.changes.map(({ change }) => ({ case: change.case, value: change.value }));
  }

  function shown(itemId: string) {
    const item = sync.getState().items.get(itemId);
    return { spaceId: item?.spaceId, parentId: item?.parentId };
  }

  function itemsStuckOn(pageId: string) {
    return stickersOn(pageId, sync.getState().stickers.values()).map(({ itemId }) => itemId);
  }

  const nested = () => [
    spaceRow(1, inbox),
    spaceRow(2, home),
    inboxPageRow,
    itemRow(4, party),
    itemRow(5, { ...food, parentId: party.id }),
    itemRow(6, { ...cake, parentId: food.id }),
    bodyPageRow(7, party.id),
    bodyPageRow(8, food.id),
    stuck(10, party.id, inboxPage),
    stuck(11, food.id, partyBody),
    stuck(12, cake.id, foodBody),
  ];

  it("puts a task under another, moving its sticker to that task's new body page at once", () => {
    startUpToDate(
      [
        spaceRow(1, inbox),
        inboxPageRow,
        itemRow(4, party),
        itemRow(6, cake),
        stuck(10, cake.id, inboxPage),
      ],
      10,
    );

    sync.putUnder(cake.id, party.id);

    expect(changesIn(household().lastPush())).toEqual([
      {
        case: "itemSetParent",
        value: expect.objectContaining({ itemId: cake.id, parentId: party.id }),
      },
      { case: "stickerRemove", value: expect.objectContaining({ stickerId: stickerId(10) }) },
      {
        case: "pageCreate",
        value: expect.objectContaining({
          pageId: partyBody,
          kind: PageKind.ITEM,
          itemId: party.id,
        }),
      },
      {
        case: "stickerPlace",
        value: expect.objectContaining({
          pageId: partyBody,
          itemId: cake.id,
          x: pageMargin,
          y: pageMargin,
        }),
      },
    ]);
    expect(shown(cake.id)).toEqual({ spaceId: inbox.id, parentId: party.id });
    expect(itemsStuckOn(inboxPage)).toEqual([]);
    expect(itemsStuckOn(partyBody)).toEqual([cake.id]);
  });

  it("takes a task out, back on its space's newest page at once", () => {
    startUpToDate(nested(), 12);

    sync.putUnder(food.id, null);

    expect(changesIn(household().lastPush()).map((change) => change.case)).toEqual([
      "itemSetParent",
      "stickerRemove",
      "stickerPlace",
    ]);
    expect(shown(food.id)).toEqual({ spaceId: inbox.id, parentId: "" });
    expect(itemsStuckOn(inboxPage)).toEqual([party.id, food.id]);
    expect(itemsStuckOn(partyBody)).toEqual([]);
  });

  it("moves a task put under one in another space there at once, with everything under it", () => {
    const shopping = {
      id: "019a8f4e-5c00-7000-8000-0000000000c4",
      spaceId: home.id,
      title: "Shop",
    };
    startUpToDate([...nested(), itemRow(13, shopping)], 13);

    sync.putUnder(food.id, shopping.id);

    expect(shown(food.id)).toEqual({ spaceId: home.id, parentId: shopping.id });
    expect(shown(cake.id)).toEqual({ spaceId: home.id, parentId: food.id });
    expect(itemsStuckOn(itemPageId(shopping.id))).toEqual([food.id]);
  });

  it("does nothing when a task is already under that parent", () => {
    startUpToDate(nested(), 12);

    sync.putUnder(food.id, party.id);

    expect(household().pushes()).toEqual([]);
  });

  it("adds a task under another, in its space, below the last one on its body page", () => {
    startUpToDate(nested(), 12);

    const added = sync.addTaskUnder(party.id, "  Drinks ");

    expect(changesIn(household().lastPush())).toEqual([
      {
        case: "itemCreate",
        value: expect.objectContaining({ itemId: added, spaceId: inbox.id, title: "Drinks" }),
      },
      {
        case: "itemSetParent",
        value: expect.objectContaining({ itemId: added, parentId: party.id }),
      },
      {
        case: "stickerPlace",
        value: expect.objectContaining({
          pageId: partyBody,
          itemId: added,
          y: 48 + taskStickerSize.height + stickerGap,
        }),
      },
    ]);
    expect(itemsStuckOn(partyBody)).toEqual([food.id, added]);
  });

  it("takes a task out of its parent before moving it to another space", () => {
    startUpToDate(nested(), 12);

    sync.moveTask(food.id, home.id);

    expect(changesIn(household().lastPush()).slice(0, 3)).toEqual([
      { case: "itemSetParent", value: expect.objectContaining({ itemId: food.id, parentId: "" }) },
      { case: "itemMove", value: expect.objectContaining({ itemId: food.id, spaceId: home.id }) },
      { case: "stickerRemove", value: expect.anything() },
    ]);
    expect(shown(food.id)).toEqual({ spaceId: home.id, parentId: "" });
    expect(shown(cake.id)).toEqual({ spaceId: home.id, parentId: food.id });
    expect(itemsStuckOn(partyBody)).toEqual([]);
  });

  it("moves a task with everything under it at once", () => {
    startUpToDate(nested(), 12);

    sync.moveTask(party.id, home.id);

    for (const { id } of [party, food, cake]) expect(shown(id).spaceId).toBe(home.id);
  });

  it("deletes a task with everything under it, the deepest first", () => {
    startUpToDate(nested(), 12);

    sync.deleteTask(party.id, "delete");

    const deleted = household()
      .pushes()
      .flatMap(({ changes }) => changes)
      .map(({ change }) => (change.case === "itemDelete" ? change.value.itemId : null));
    expect(deleted).toEqual([cake.id, food.id, party.id]);
    expect(sync.getState().items.size).toBe(0);
  });

  it("moves the items under a deleted task up to its own parent, onto that one's body page", () => {
    startUpToDate(nested(), 12);

    sync.deleteTask(food.id, "move-up");

    expect(shown(cake.id)).toEqual({ spaceId: inbox.id, parentId: party.id });
    expect(sync.getState().items.has(food.id)).toBe(false);
    expect(itemsStuckOn(partyBody)).toEqual([cake.id]);
  });

  it("moves the items under a deleted task to the top of its space, onto its newest page", () => {
    startUpToDate(nested(), 12);

    sync.deleteTask(food.id, "to-top");

    expect(shown(cake.id)).toEqual({ spaceId: inbox.id, parentId: "" });
    expect(itemsStuckOn(inboxPage)).toEqual([party.id, cake.id]);
  });

  it("ticks a task and the tasks under it in one push", () => {
    startUpToDate(nested(), 12);

    sync.tickTasks([party.id, food.id, cake.id]);

    expect(household().pushes()).toHaveLength(1);
    expect(
      changesIn(household().lastPush()).map(({ value }) =>
        value && "completionId" in value ? value.itemId : null,
      ),
    ).toEqual([party.id, food.id, cake.id]);
  });
});

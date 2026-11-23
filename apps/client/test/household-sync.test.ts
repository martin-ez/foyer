import { create, fromBinary, type MessageInitShape, toBinary } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import {
  a2Landscape,
  a4Portrait,
  calendarPageId,
  calendarPageKinds,
  calendarStickerGap,
  dayPageId,
  heightOfTime,
  inStrip,
  itemPageId,
  newId,
  pageMargin,
  signedOutCloseCode,
  spacePageId,
  stickerGap,
  taskStickerSize,
  timelineOf,
} from "@foyer/shared";
import { GoogleConnectionState } from "@foyer/shared/gen/foyer/calendar/v1/calendar_pb";
import { ItemKind, RepeatFrom } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import { PageKind } from "@foyer/shared/gen/foyer/page/v1/page_pb";
import { CalendarState, SpaceKind } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import { StickerKind } from "@foyer/shared/gen/foyer/sticker/v1/sticker_pb";
import {
  type Change,
  ChangeSchema,
  type DeviceMessage,
  DeviceMessageSchema,
  HouseholdMessageSchema,
  type Push,
  RowKind,
  type RowSchema,
} from "@foyer/shared/gen/foyer/sync/v1/sync_pb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localToday } from "../src/page/calendar-date";
import { stickersOn } from "../src/page/sticker-layout";
import {
  type Connect,
  type ConnectionEvents,
  HouseholdSync,
  type KeptChange,
  keepAliveInterval,
  longestReconnectDelay,
  pushChangeLimit,
  silenceLimit,
  type UnsentChanges,
} from "../src/sync/household-sync";
import { reportEvents, syncAddress } from "../src/sync/socket";
import { blocksIn } from "../src/text/text-groups";

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
    time?: string;
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
    kind?: StickerKind;
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

function onPages({ change }: Pick<Change, "change">): boolean {
  return (
    change.case === "pageCreate" ||
    change.case === "stickerPlace" ||
    change.case === "stickerMove" ||
    change.case === "stickerRemove"
  );
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

  it("gives the changes of one action an action id of their own, and a change alone none", () => {
    startUpToDate();

    sync.renameSpace(home.id, "Our home");
    sync.addTask(home.id, "Water the plants");
    sync.addTask(home.id, "Feed the cat");

    const [renamed, watered, fed] = household()
      .pushes()
      .map(({ changes }) => new Set(changes.map(({ actionId }) => actionId)));
    expect(renamed).toEqual(new Set([""]));
    expect(watered?.size).toBe(1);
    expect(fed?.size).toBe(1);
    expect([...(watered ?? [])][0]).not.toBe("");
    expect([...(watered ?? [])][0]).not.toBe([...(fed ?? [])][0]);
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

  it("says once for each refused action, and for each refused change made alone", () => {
    startUpToDate();
    household().closeWith(1006);
    sync.renameSpace(home.id, "Our home");
    sync.renameSpace(home.id, "Our house");
    sync.addTask(home.id, "Water the plants");
    sync.addTask(home.id, "Feed the cat");
    vi.advanceTimersByTime(1000);
    household().welcome(2);
    const push = household().lastPush();

    const refused = Object.fromEntries(push.changes.map(({ changeId }) => [changeId, "No."]));
    household().commit(push, refused);

    expect(sync.getState().problems).toEqual([
      "Couldn't save renaming a space to “Our home”: No.",
      "Couldn't save renaming a space to “Our house”: No.",
      "Couldn't save adding “Water the plants”: No.",
      "Couldn't save adding “Feed the cat”: No.",
    ]);
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

  it("keeps an action's changes in one push, sending it in the next when it doesn't fit", () => {
    startUpToDate();
    household().closeWith(1006);
    for (let index = 1; index < pushChangeLimit; index++) {
      sync.renameSpace(home.id, `Home ${index}`);
    }
    sync.addTask(home.id, "Water the plants");

    vi.advanceTimersByTime(1000);
    household().welcome(2);

    const [lone, action] = household().pushes();
    expect(lone?.changes).toHaveLength(pushChangeLimit - 1);
    expect(action?.changes.length).toBeGreaterThan(1);
    expect(new Set(action?.changes.map(({ actionId }) => actionId)).size).toBe(1);
  });

  it(`sends an action of more than ${pushChangeLimit} changes whole, in a push of its own`, () => {
    const tasks = Array.from({ length: pushChangeLimit + 1 }, (_, index) => ({
      id: newId(),
      spaceId: home.id,
      title: `Task ${index}`,
    }));
    startUpToDate(
      [
        spaceRow(1, inbox),
        spaceRow(2, home),
        ...tasks.map((task, index) => itemRow(3 + index, task)),
      ],
      200,
    );
    household().closeWith(1006);
    sync.renameSpace(home.id, "Our home");
    sync.tickTasks(tasks.map(({ id }) => id));

    vi.advanceTimersByTime(1000);
    household().welcome(200);

    expect(
      household()
        .pushes()
        .map(({ changes }) => changes.length),
    ).toEqual([1, pushChangeLimit + 1]);
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

describe("keeping unsent changes between launches", () => {
  class KeptChanges implements UnsentChanges {
    kept: KeptChange[] = [];
    load = async () => [...this.kept];
    keep = (changes: KeptChange[]) => {
      this.kept.push(...changes);
    };
    forget = (changeIds: string[]) => {
      this.kept = this.kept.filter(({ changeId }) => !changeIds.includes(changeId));
    };
    forgetAll = () => {
      this.kept = [];
    };
  }

  let unsent: KeptChanges;

  function launch() {
    sync.stop();
    sync = new HouseholdSync({ memberId: me, connect, unsent });
  }

  async function startedUpToDate(rows?: RowInit[], seq?: number) {
    startUpToDate(rows, seq);
    await vi.advanceTimersByTimeAsync(0);
  }

  function keptIds() {
    return unsent.kept.map(({ changeId }) => changeId);
  }

  beforeEach(() => {
    unsent = new KeptChanges();
    launch();
  });

  it("keeps each change as it's made, encoded as it's sent", async () => {
    await startedUpToDate();
    household().closeWith(1006);

    sync.renameSpace(home.id, "Our home");

    const [kept] = unsent.kept;
    expect(unsent.kept).toHaveLength(1);
    expect(kept?.describe).toBe("renaming a space to “Our home”");
    const change = fromBinary(ChangeSchema, kept?.encoded ?? new Uint8Array());
    expect(change.changeId).toBe(kept?.changeId);
    expect(nameIn(change)).toBe("Our home");
  });

  it("forgets the changes the household commits", async () => {
    await startedUpToDate();
    sync.addTask(home.id, "Water the plants");
    expect(unsent.kept.length).toBeGreaterThan(1);

    household().commit(household().lastPush());

    expect(unsent.kept).toEqual([]);
  });

  it("forgets the changes the household refuses", async () => {
    await startedUpToDate();
    sync.renameSpace(home.id, "Our home");
    const push = household().lastPush();

    household().commit(push, { [push.changes[0]?.changeId ?? ""]: "Not your space." });

    expect(unsent.kept).toEqual([]);
    expect(sync.getState().problems).toHaveLength(1);
  });

  it("sends the changes kept from before first, as the same changes, and shows them at once", async () => {
    await startedUpToDate();
    household().closeWith(1006);
    sync.addTask(home.id, "Water the plants");
    const before = keptIds();

    launch();
    sync.start();
    sync.renameSpace(home.id, "Our home");
    await vi.advanceTimersByTimeAsync(0);
    expect(sync.getState().unsaved).toBe(before.length + 1);
    expect([...sync.getState().items.values()].map(({ title }) => title)).toEqual([
      "Water the plants",
    ]);
    household().welcome(2);

    const sent = household()
      .pushes()
      .flatMap(({ changes }) => changes);
    expect(sent.map(({ changeId }) => changeId)).toEqual([...before, ...keptIds().slice(-1)]);
    const actions = new Set(sent.slice(0, -1).map(({ actionId }) => actionId));
    expect(actions.size).toBe(1);
    expect(actions.has("")).toBe(false);
  });

  it("pushes nothing until the changes kept from before are back", async () => {
    await startedUpToDate();
    household().closeWith(1006);
    sync.renameSpace(home.id, "Our home");

    launch();
    sync.start();
    household().welcome(2);
    expect(household().pushes()).toEqual([]);
    await vi.advanceTimersByTimeAsync(0);

    expect(household().pushes()).toHaveLength(1);
  });

  it("says a change kept from before couldn't be saved, in the words it was made with", async () => {
    await startedUpToDate();
    household().closeWith(1006);
    sync.renameSpace(home.id, "Our home");

    launch();
    await startedUpToDate();
    const push = household().lastPush();
    household().commit(push, { [push.changes[0]?.changeId ?? ""]: "Not your space." });

    expect(sync.getState().problems).toEqual([
      "Couldn't save renaming a space to “Our home”: Not your space.",
    ]);
    expect(names()).toEqual(["Inbox", "Home"]);
  });

  it("forgets every kept change once the household says the session has ended", async () => {
    await startedUpToDate();
    household().closeWith(1006);
    sync.renameSpace(home.id, "Our home");
    vi.advanceTimersByTime(1000);

    household().closeWith(signedOutCloseCode);

    expect(unsent.kept).toEqual([]);
  });

  it("sends a change made before it started once, though it's kept too", async () => {
    sync.renameSpace(home.id, "Our home");

    await startedUpToDate();

    expect(
      household()
        .lastPush()
        .changes.map(({ changeId }) => changeId),
    ).toEqual(keptIds());
  });

  it("forgets a kept change it can't read, and sends the others", async () => {
    await startedUpToDate();
    household().closeWith(1006);
    sync.renameSpace(home.id, "Our home");
    const readable = keptIds();
    unsent.kept.unshift({ changeId: newId(), encoded: new Uint8Array([255]), describe: "" });

    launch();
    await startedUpToDate();

    expect(
      household()
        .lastPush()
        .changes.map(({ changeId }) => changeId),
    ).toEqual(readable);
    expect(keptIds()).toEqual(readable);
  });

  it("starts with nothing kept when what was kept can't be read", async () => {
    unsent.load = () => Promise.reject(new Error("The browser keeps nothing"));

    await startedUpToDate();
    sync.renameSpace(home.id, "Our home");

    expect(household().lastPush().changes).toHaveLength(1);
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

    const pushed = household()
      .pushes()
      .flatMap(({ changes }) => changes.filter((change) => !onPages(change)));
    expect(pushed.map(({ change }) => ({ case: change.case, value: change.value }))).toEqual([
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
    expect(sync.titleProblem("   ")).toBe("A title can't be blank.");
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
      .changes.filter((change) => !onPages(change))
      .map(({ change }) => change);
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

  it("undoes all of an action the household refuses, saying once that it couldn't be saved", () => {
    startUpToDate(nested(), 12);
    sync.putUnder(food.id, null);
    const push = household().lastPush();

    const reason = "There's no such sticker.";
    household().commit(
      push,
      Object.fromEntries(push.changes.map(({ changeId }) => [changeId, reason])),
    );

    expect(shown(food.id)).toEqual({ spaceId: inbox.id, parentId: party.id });
    expect(itemsStuckOn(partyBody)).toEqual([food.id]);
    expect(itemsStuckOn(inboxPage)).toEqual([party.id]);
    expect(sync.getState()).toMatchObject({
      unsaved: 0,
      problems: [`Couldn't save taking out “Food”: ${reason}`],
    });
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
    expect(household().pushes()).toHaveLength(1);
    expect(
      new Set(
        household()
          .lastPush()
          .changes.map(({ actionId }) => actionId),
      ).size,
    ).toBe(1);
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

describe("events", () => {
  const personal = {
    id: "019a8f4e-5c00-7000-8000-0000000000a3",
    kind: SpaceKind.PERSONAL,
    ownerId: me,
    name: "Personal",
    calendarMemberId: me,
    calendarState: CalendarState.SYNCING,
  };
  const work = { ...personal, id: "019a8f4e-5c00-7000-8000-0000000000a4", name: "Work" };
  const startsAt = Date.parse("2026-11-20T19:00:00Z");
  const endsAt = Date.parse("2026-11-20T21:00:00Z");
  const dinner = {
    seq: 4n,
    row: {
      case: "item" as const,
      value: {
        id: "019a8f4e-5c00-7000-8000-0000000000e1",
        kind: ItemKind.EVENT,
        spaceId: personal.id,
        title: "Dinner",
        date: "2026-11-20",
        startsAt: timestampFromMs(startsAt),
        endsAt: timestampFromMs(endsAt),
      },
    },
  };
  const dinnerId = dinner.row.value.id;

  function changesIn(push: Push) {
    return push.changes.map(({ change }) => ({ case: change.case, value: change.value }));
  }

  it("adds an event at once, with when it happens, and its stickers on the day it starts here", () => {
    startUpToDate([spaceRow(1, inbox), spaceRow(2, personal)], 2);

    const itemId = sync.addEvent(personal.id, {
      title: " Dinner ",
      description: "At home",
      time: { allDay: false, startsAt, endsAt },
    });

    const push = household().lastPush();
    expect(changesIn({ ...push, changes: push.changes.filter((each) => !onPages(each)) })).toEqual([
      {
        case: "itemCreate",
        value: expect.objectContaining({
          itemId,
          kind: ItemKind.EVENT,
          spaceId: personal.id,
          title: "Dinner",
          description: "At home",
          startsOn: "",
          endsOn: "",
          startsAt: timestampFromMs(startsAt),
          endsAt: timestampFromMs(endsAt),
        }),
      },
    ]);
    expect(sync.getState().items.get(itemId)).toMatchObject({
      kind: ItemKind.EVENT,
      title: "Dinner",
      createdBy: me,
      startsAt: timestampFromMs(startsAt),
    });
    const day = localToday(new Date(startsAt));
    const stickers = [...sync.getState().stickers.values()];
    expect(stickers.map(({ pageId, occurrence, kind }) => [pageId, occurrence, kind])).toEqual(
      calendarPageKinds.map((pageKind) => [calendarPageId(pageKind, day), day, StickerKind.EVENT]),
    );
  });

  it("changes when an event happens at once, from times to all day", () => {
    startUpToDate([spaceRow(1, inbox), spaceRow(2, personal), dinner], 4);

    sync.setEventTime(dinnerId, { allDay: true, startsOn: "2026-11-21", endsOn: "2026-11-22" });

    const [change] = household().lastPush().changes;
    expect(change?.change.case).toBe("eventSetTime");
    expect(change?.change.value).toMatchObject({
      itemId: dinnerId,
      startsOn: "2026-11-21",
      endsOn: "2026-11-22",
    });
    expect(change?.change.value).not.toHaveProperty("startsAt");
    expect(change?.change.value).not.toHaveProperty("endsAt");
    expect(sync.getState().items.get(dinnerId)).toMatchObject({
      startsOn: "2026-11-21",
      endsOn: "2026-11-22",
      startsAt: undefined,
    });
  });

  it("moves and deletes an event at once", () => {
    startUpToDate([spaceRow(1, inbox), spaceRow(2, personal), spaceRow(3, work), dinner], 4);

    sync.moveEvent(dinnerId, work.id);
    const moved = sync.getState().items.get(dinnerId)?.spaceId;
    sync.deleteEvent(dinnerId);

    expect(household().pushes().flatMap(changesIn)).toEqual([
      { case: "itemMove", value: expect.objectContaining({ itemId: dinnerId, spaceId: work.id }) },
      { case: "itemDelete", value: expect.objectContaining({ itemId: dinnerId }) },
    ]);
    expect(moved).toBe(work.id);
    expect(sync.getState().items.has(dinnerId)).toBe(false);
  });

  describe("under a task", () => {
    const party = {
      id: "019a8f4e-5c00-7000-8000-0000000000c1",
      spaceId: personal.id,
      title: "Party",
    };
    const personalPage = spacePageId(personal.id, 1);
    const partyBody = itemPageId(party.id);
    const dinnersDay = dayPageId("2026-11-20");
    const underParty = {
      ...dinner,
      row: { ...dinner.row, value: { ...dinner.row.value, parentId: party.id } },
    };
    const onItsDay = stickerRow(8, {
      id: "019a8f4e-5c00-7000-8000-0000000000f1",
      pageId: dinnersDay,
      itemId: dinnerId,
      kind: StickerKind.EVENT,
    });
    const nested = () => [
      spaceRow(1, inbox),
      spaceRow(2, personal),
      spaceRow(3, work),
      underParty,
      itemRow(5, party),
      pageRow(6, { id: personalPage, kind: PageKind.SPACE, spaceId: personal.id, number: 1 }),
      pageRow(7, { id: partyBody, kind: PageKind.ITEM, itemId: party.id }),
      onItsDay,
      stickerRow(9, {
        id: "019a8f4e-5c00-7000-8000-0000000000f2",
        pageId: personalPage,
        itemId: party.id,
      }),
      stickerRow(10, {
        id: "019a8f4e-5c00-7000-8000-0000000000f3",
        pageId: partyBody,
        itemId: dinnerId,
        kind: StickerKind.EVENT,
      }),
    ];

    function stuckOn(pageId: string) {
      return stickersOn(pageId, sync.getState().stickers.values()).map(({ itemId, kind }) => ({
        itemId,
        kind,
      }));
    }

    it("puts an event under a task at once, with an event's sticker on the task's body page", () => {
      startUpToDate(
        [spaceRow(1, inbox), spaceRow(2, personal), dinner, itemRow(5, party), onItsDay],
        8,
      );

      sync.putUnder(dinnerId, party.id);

      expect(changesIn(household().lastPush())).toEqual([
        {
          case: "itemSetParent",
          value: expect.objectContaining({ itemId: dinnerId, parentId: party.id }),
        },
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
            itemId: dinnerId,
            kind: StickerKind.EVENT,
            x: pageMargin,
            y: pageMargin,
          }),
        },
      ]);
      expect(sync.getState().items.get(dinnerId)?.parentId).toBe(party.id);
      expect(stuckOn(partyBody)).toEqual([{ itemId: dinnerId, kind: StickerKind.EVENT }]);
      expect(stuckOn(dinnersDay)).toEqual([{ itemId: dinnerId, kind: StickerKind.EVENT }]);
    });

    it("takes an event out at once, with an event's sticker on its space's newest page", () => {
      startUpToDate(nested(), 10);

      sync.putUnder(dinnerId, null);

      expect(changesIn(household().lastPush()).map((change) => change.case)).toEqual([
        "itemSetParent",
        "stickerRemove",
        "stickerPlace",
      ]);
      expect(sync.getState().items.get(dinnerId)?.parentId).toBe("");
      expect(stuckOn(partyBody)).toEqual([]);
      expect(stuckOn(personalPage)).toEqual([
        { itemId: party.id, kind: StickerKind.TASK },
        { itemId: dinnerId, kind: StickerKind.EVENT },
      ]);
      expect(stuckOn(dinnersDay)).toEqual([{ itemId: dinnerId, kind: StickerKind.EVENT }]);
    });

    it("takes an event out of its task before moving it, its sticker going to the new space", () => {
      startUpToDate(nested(), 10);

      sync.moveEvent(dinnerId, work.id);

      const workPage = spacePageId(work.id, 1);
      expect(changesIn(household().lastPush())).toEqual([
        {
          case: "itemSetParent",
          value: expect.objectContaining({ itemId: dinnerId, parentId: "" }),
        },
        {
          case: "itemMove",
          value: expect.objectContaining({ itemId: dinnerId, spaceId: work.id }),
        },
        { case: "stickerRemove", value: expect.anything() },
        { case: "pageCreate", value: expect.objectContaining({ pageId: workPage }) },
        {
          case: "stickerPlace",
          value: expect.objectContaining({
            pageId: workPage,
            itemId: dinnerId,
            kind: StickerKind.EVENT,
          }),
        },
      ]);
      expect(sync.getState().items.get(dinnerId)).toMatchObject({ spaceId: work.id, parentId: "" });
      expect(stuckOn(partyBody)).toEqual([]);
      expect(stuckOn(dinnersDay)).toEqual([{ itemId: dinnerId, kind: StickerKind.EVENT }]);
    });
  });

  it("undoes an event the household refuses, and says why", () => {
    startUpToDate([spaceRow(1, inbox), spaceRow(2, personal)], 2);

    const itemId = sync.addEvent(inbox.id, {
      title: "Dinner",
      description: "",
      time: { allDay: true, startsOn: "2026-11-20", endsOn: "2026-11-20" },
    });
    const push = household().lastPush();
    household().commit(push, {
      [push.changes[0]?.changeId ?? ""]: "An event can only go in a space with a Google calendar.",
    });

    expect(sync.getState().items.has(itemId)).toBe(false);
    expect(sync.getState().problems).toEqual([
      "Couldn't save adding “Dinner”: An event can only go in a space with a Google calendar.",
    ]);
  });
});

describe("calendar stickers", () => {
  const today = "2026-11-17";
  const task = { id: "019a8f4e-5c00-7000-8000-0000000000c1", spaceId: inbox.id, title: "Buy milk" };
  const personal = {
    id: "019a8f4e-5c00-7000-8000-0000000000a3",
    kind: SpaceKind.PERSONAL,
    ownerId: me,
    name: "Personal",
    calendarMemberId: me,
    calendarState: CalendarState.SYNCING,
  };

  beforeEach(() => {
    sync = new HouseholdSync({ memberId: me, connect, today: () => today });
  });

  function onCalendar(itemId: string) {
    return [...sync.getState().stickers.values()]
      .filter((sticker) => sticker.itemId === itemId && sticker.occurrence !== "")
      .map(({ id, pageId, occurrence, x, y }) => ({ id, pageId, occurrence, x, y }))
      .sort((a, b) => a.pageId.localeCompare(b.pageId) || a.occurrence.localeCompare(b.occurrence));
  }

  function days(itemId: string) {
    return onCalendar(itemId).map(({ pageId, occurrence }) => `${pageId} ${occurrence}`);
  }

  function onDay(date: string) {
    return calendarPageKinds.map((kind) => `${calendarPageId(kind, date)} ${date}`).sort();
  }

  function pushedOnPages() {
    const { changes } = household().lastPush();
    const at = (index: number) => changes[index]?.change;
    const created = new Set<string>();
    const pages: string[] = [];
    const placed: string[] = [];
    const moved: string[] = [];
    const removed: string[] = [];
    let placedBeforeItsPage = false;
    changes.forEach((_, index) => {
      const change = at(index);
      if (change?.case === "pageCreate") {
        created.add(change.value.pageId);
        pages.push(change.value.pageId);
      }
      if (change?.case === "stickerPlace") {
        const { pageId, occurrence } = change.value;
        if (!created.has(pageId)) placedBeforeItsPage = true;
        placed.push(`${pageId} ${occurrence}`);
      }
      if (change?.case === "stickerMove") moved.push(change.value.stickerId);
      if (change?.case === "stickerRemove") removed.push(change.value.stickerId);
    });
    return {
      first: at(0)?.case,
      pages: pages.sort(),
      placed: placed.sort(),
      moved: moved.sort(),
      removed,
      placedBeforeItsPage,
    };
  }

  it("puts a task given a date on its day's month, week and day pages at once, in the same push", () => {
    startUpToDate([spaceRow(1, inbox), itemRow(2, task)], 2);

    sync.setDate(task.id, "2026-11-20");

    expect(days(task.id)).toEqual(onDay("2026-11-20"));
    expect(pushedOnPages()).toEqual({
      first: "itemSetDate",
      pages: ["day:2026-11-20", "month:2026-11", "week:2026-11-16"],
      placed: onDay("2026-11-20"),
      moved: [],
      removed: [],
      placedBeforeItsPage: false,
    });
  });

  it("moves a task's stickers to its new date, and takes them off when the date is cleared", () => {
    startUpToDate([spaceRow(1, inbox), itemRow(2, task)], 2);
    sync.setDate(task.id, "2026-11-20");
    const before = onCalendar(task.id);

    sync.setDate(task.id, "2026-11-18");

    expect(days(task.id)).toEqual(onDay("2026-11-18"));
    const month = (stickers: typeof before) =>
      stickers.find(({ pageId }) => pageId === "month:2026-11")?.id;
    expect(month(onCalendar(task.id))).toBe(month(before));
    const kept = before.filter(({ pageId }) => pageId !== "day:2026-11-20");
    expect(pushedOnPages()).toEqual({
      first: "itemSetDate",
      pages: ["day:2026-11-18"],
      placed: ["day:2026-11-18 2026-11-18"],
      moved: kept.map(({ id }) => id).sort(),
      removed: before.filter(({ pageId }) => pageId === "day:2026-11-20").map(({ id }) => id),
      placedBeforeItsPage: false,
    });

    sync.setDate(task.id, "");

    expect(onCalendar(task.id)).toEqual([]);
  });

  it("puts a task on the calendar when making it repeat gives it its first date", () => {
    startUpToDate([spaceRow(1, inbox), itemRow(2, task)], 2);

    sync.setRepeat(task.id, { frequency: "weekly", interval: 1, days: ["FR"] }, "schedule");

    expect(days(task.id)).toEqual(onDay("2026-11-20"));
    expect(pushedOnPages().placed).toEqual(onDay("2026-11-20"));
  });

  it("moves an event's stickers to the day it now starts on this device", () => {
    startUpToDate([spaceRow(1, inbox), spaceRow(2, personal)], 2);
    const startsAt = new Date(2026, 10, 20, 19, 0).getTime();
    const itemId = sync.addEvent(personal.id, {
      title: "Dinner",
      description: "",
      time: { allDay: false, startsAt, endsAt: startsAt + 3_600_000 },
    });

    sync.setEventTime(itemId, { allDay: true, startsOn: "2026-12-01", endsOn: "2026-12-02" });

    expect(days(itemId)).toEqual(onDay("2026-12-01"));
    expect(household().lastPush().changes[0]?.change.case).toBe("eventSetTime");
  });

  it("adds an event to a day with its sticker where it was tapped", () => {
    startUpToDate([spaceRow(1, inbox), spaceRow(2, personal)], 2);

    const itemId = sync.addEvent(
      personal.id,
      {
        title: "Dinner",
        description: "",
        time: { allDay: true, startsOn: "2026-11-19", endsOn: "2026-11-19" },
      },
      { pageId: "month:2026-11", at: { x: 820, y: 640 } },
    );

    expect(days(itemId)).toEqual(onDay("2026-11-19"));
    expect(onCalendar(itemId).find(({ pageId }) => pageId === "month:2026-11")).toMatchObject({
      x: 820,
      y: 640,
    });
  });

  it("adds a task to a day with its sticker where it was tapped, and the rest on their days", () => {
    startUpToDate([spaceRow(1, inbox)], 1);

    const { itemId } = sync.addTask(inbox.id, "Buy milk", {
      date: "2026-11-19",
      spot: { pageId: "week:2026-11-16", at: { x: 700, y: 400 } },
    });

    expect(days(itemId)).toEqual(onDay("2026-11-19"));
    expect(onCalendar(itemId).find(({ pageId }) => pageId === "week:2026-11-16")).toMatchObject({
      x: 700,
      y: 400,
    });
    expect(sync.getState().items.get(itemId)?.date).toBe("2026-11-19");
  });

  it("moves a task dropped on another day there, keeping the sticker where it was dropped", () => {
    startUpToDate([spaceRow(1, inbox), itemRow(2, task)], 2);
    sync.setDate(task.id, "2026-11-17");
    const week = onCalendar(task.id).find(({ pageId }) => pageId === "week:2026-11-16");

    sync.moveToDay(week?.id ?? "", { x: 900, y: 500 }, "2026-11-21");

    expect(sync.getState().items.get(task.id)?.date).toBe("2026-11-21");
    expect(days(task.id)).toEqual(onDay("2026-11-21"));
    expect(onCalendar(task.id).find(({ id }) => id === week?.id)).toMatchObject({
      x: 900,
      y: 500,
      occurrence: "2026-11-21",
    });
  });

  it("moves an event dropped on another day by as many days, keeping its times and length", () => {
    startUpToDate([spaceRow(1, inbox), spaceRow(2, personal)], 2);
    const startsAt = new Date(2026, 10, 20, 19, 0).getTime();
    const itemId = sync.addEvent(personal.id, {
      title: "Dinner",
      description: "",
      time: { allDay: false, startsAt, endsAt: startsAt + 2 * 3_600_000 },
    });
    const month = onCalendar(itemId).find(({ pageId }) => pageId === "month:2026-11");

    sync.moveToDay(month?.id ?? "", { x: 400, y: 600 }, "2026-11-23");

    const [change] = household().lastPush().changes;
    expect(change?.change.case).toBe("eventSetTime");
    expect(change?.change.value).toMatchObject({
      startsAt: timestampFromMs(new Date(2026, 10, 23, 19, 0).getTime()),
      endsAt: timestampFromMs(new Date(2026, 10, 23, 21, 0).getTime()),
    });
    expect(days(itemId)).toEqual(onDay("2026-11-23"));
  });

  it("leaves a repeating task's stickers on the day ticked, and puts it on its next date", () => {
    const bins = { ...task, date: today, repeat: "FREQ=WEEKLY;BYDAY=TU" };
    startUpToDate(
      [spaceRow(1, inbox), itemRow(2, { ...bins, repeatFrom: RepeatFrom.SCHEDULE })],
      2,
    );
    sync.setDate(task.id, today);

    sync.tickTask(task.id);

    expect(days(task.id)).toEqual([...onDay(today), ...onDay("2026-11-24")].sort());

    sync.untickTask(task.id, today);

    expect(days(task.id)).toEqual(onDay(today));
  });

  it("places a dated item below what's already on its day", () => {
    startUpToDate([spaceRow(1, inbox), itemRow(2, task)], 2);
    const { itemId } = sync.addTask(inbox.id, "Water the plants", { date: "2026-11-20" });

    sync.setDate(task.id, "2026-11-20");

    const onDayPage = (id: string) =>
      onCalendar(id).find(({ pageId }) => pageId === "day:2026-11-20");
    expect(onDayPage(task.id)?.y).toBeGreaterThan((onDayPage(itemId)?.y ?? 0) + calendarStickerGap);
  });

  it("keeps a sticker's day when it moves within it", () => {
    startUpToDate([spaceRow(1, inbox), itemRow(2, task)], 2);
    sync.setDate(task.id, "2026-11-20");
    const [first] = onCalendar(task.id);

    sync.moveSticker(first?.id ?? "", 300, 300);

    expect(onCalendar(task.id).find(({ id }) => id === first?.id)).toMatchObject({
      x: 300,
      y: 300,
      occurrence: "2026-11-20",
    });
  });
});

describe("times on a day page's timeline", () => {
  const task = {
    id: "019a8f4e-5c00-7000-8000-0000000000c1",
    spaceId: inbox.id,
    title: "Buy milk",
    date: "2026-11-20",
  };
  const personal = {
    id: "019a8f4e-5c00-7000-8000-0000000000a3",
    kind: SpaceKind.PERSONAL,
    ownerId: me,
    name: "Personal",
    calendarMemberId: me,
    calendarState: CalendarState.SYNCING,
  };
  const dayPage = "day:2026-11-20";
  const timeline = timelineOf(dayPage, a4Portrait);
  if (!timeline) throw new Error("A day page has a timeline.");
  const heightAt = (minutes: number) => heightOfTime(timeline, minutes);

  beforeEach(() => {
    sync = new HouseholdSync({ memberId: me, connect, today: () => "2026-11-17" });
  });

  function onDayPage(itemId: string) {
    return [...sync.getState().stickers.values()].find(
      (sticker) => sticker.itemId === itemId && sticker.pageId === dayPage,
    );
  }

  function pushed() {
    return household()
      .lastPush()
      .changes.map(({ change }) => change.case);
  }

  it("sets a task's time at once, moving its day page sticker to that time", () => {
    startUpToDate([spaceRow(1, inbox), itemRow(2, task)], 2);
    sync.setDate(task.id, task.date);

    sync.setTime(task.id, "19:30");

    expect(sync.getState().items.get(task.id)?.time).toBe("19:30");
    expect(onDayPage(task.id)).toMatchObject({ x: timeline.left, y: heightAt(19 * 60 + 30) });
    expect(pushed()).toEqual(["itemSetTime", "stickerMove"]);

    sync.setTime(task.id, "");

    expect(sync.getState().items.get(task.id)?.time).toBe("");
    expect(inStrip(timeline, onDayPage(task.id)?.y ?? 0)).toBe(true);
  });

  it("takes a task's time off with its date", () => {
    startUpToDate([spaceRow(1, inbox), itemRow(2, { ...task, time: "19:30" })], 2);

    sync.setDate(task.id, "");

    expect(sync.getState().items.get(task.id)).toMatchObject({ date: "", time: "" });
  });

  it("keeps a task's time when its date changes, on the new day's timeline", () => {
    startUpToDate([spaceRow(1, inbox), itemRow(2, { ...task, time: "07:15" })], 2);

    sync.setDate(task.id, "2026-11-21");

    const onNewDay = [...sync.getState().stickers.values()].find(
      ({ pageId }) => pageId === "day:2026-11-21",
    );
    expect(sync.getState().items.get(task.id)?.time).toBe("07:15");
    expect(onNewDay?.y).toBe(heightAt(7 * 60 + 15));
  });

  it("changes a task's time when its sticker is dropped on the timeline, and clears it in the strip", () => {
    startUpToDate([spaceRow(1, inbox), itemRow(2, task)], 2);
    sync.setDate(task.id, task.date);
    const sticker = onDayPage(task.id);

    sync.moveOnDayPage(sticker?.id ?? "", { x: 320, y: heightAt(9 * 60) }, 9 * 60);

    expect(sync.getState().items.get(task.id)?.time).toBe("09:00");
    expect(onDayPage(task.id)).toMatchObject({ id: sticker?.id, x: 320, y: heightAt(9 * 60) });
    expect(pushed()).toEqual(["itemSetTime", "stickerMove"]);

    sync.moveOnDayPage(sticker?.id ?? "", { x: 320, y: heightAt(9 * 60) }, 9 * 60);

    expect(pushed()).toEqual(["stickerMove"]);

    sync.moveOnDayPage(sticker?.id ?? "", { x: 60, y: 60 }, null);

    expect(sync.getState().items.get(task.id)?.time).toBe("");
    expect(onDayPage(task.id)).toMatchObject({ x: 60, y: 60 });
  });

  it("adds a task at the time tapped on the timeline, in the same push", () => {
    startUpToDate([spaceRow(1, inbox)], 1);

    const { itemId } = sync.addTask(inbox.id, "Call the plumber", {
      date: "2026-11-20",
      spot: { pageId: dayPage, at: { x: 200, y: heightAt(14 * 60) }, time: 14 * 60 },
    });

    expect(sync.getState().items.get(itemId)).toMatchObject({ date: "2026-11-20", time: "14:00" });
    expect(onDayPage(itemId)).toMatchObject({ x: 200, y: heightAt(14 * 60) });
    expect(pushed().slice(0, 2)).toEqual(["itemCreate", "itemSetTime"]);
  });

  it("gives an undated task the day and time tapped", () => {
    startUpToDate([spaceRow(1, inbox), itemRow(2, { ...task, date: "" })], 2);

    sync.setDate(task.id, "2026-11-20", {
      pageId: dayPage,
      at: { x: 200, y: heightAt(8 * 60) },
      time: 8 * 60,
    });

    expect(sync.getState().items.get(task.id)).toMatchObject({ date: "2026-11-20", time: "08:00" });
    expect(pushed().slice(0, 2)).toEqual(["itemSetDate", "itemSetTime"]);
  });

  it("puts an event's day page sticker at the time it starts here", () => {
    startUpToDate([spaceRow(1, inbox), spaceRow(2, personal)], 2);
    const startsAt = new Date(2026, 10, 20, 19, 0).getTime();

    const itemId = sync.addEvent(personal.id, {
      title: "Dinner",
      description: "",
      time: { allDay: false, startsAt, endsAt: startsAt + 2 * 3_600_000 },
    });

    expect(onDayPage(itemId)?.y).toBe(heightAt(19 * 60));
  });

  it("moves an event dropped on the timeline to start then, keeping its length", () => {
    startUpToDate([spaceRow(1, inbox), spaceRow(2, personal)], 2);
    const startsAt = new Date(2026, 10, 20, 19, 0).getTime();
    const itemId = sync.addEvent(personal.id, {
      title: "Dinner",
      description: "",
      time: { allDay: false, startsAt, endsAt: startsAt + 2 * 3_600_000 },
    });

    sync.moveOnDayPage(onDayPage(itemId)?.id ?? "", { x: 300, y: heightAt(18 * 60) }, 18 * 60);

    const [change] = household().lastPush().changes;
    expect(change?.change.case).toBe("eventSetTime");
    expect(change?.change.value).toMatchObject({
      startsAt: timestampFromMs(new Date(2026, 10, 20, 18, 0).getTime()),
      endsAt: timestampFromMs(new Date(2026, 10, 20, 20, 0).getTime()),
    });
    expect(onDayPage(itemId)).toMatchObject({ x: 300, y: heightAt(18 * 60) });
  });

  it("makes an event dropped in the strip all day, and one put on the timeline last an hour", () => {
    startUpToDate([spaceRow(1, inbox), spaceRow(2, personal)], 2);
    const startsAt = new Date(2026, 10, 20, 19, 0).getTime();
    const itemId = sync.addEvent(personal.id, {
      title: "Dinner",
      description: "",
      time: { allDay: false, startsAt, endsAt: startsAt + 2 * 3_600_000 },
    });
    const stickerId = onDayPage(itemId)?.id ?? "";

    sync.moveOnDayPage(stickerId, { x: 60, y: 60 }, null);

    expect(sync.getState().items.get(itemId)).toMatchObject({
      startsOn: "2026-11-20",
      endsOn: "2026-11-20",
    });

    sync.moveOnDayPage(stickerId, { x: 300, y: heightAt(10 * 60) }, 10 * 60);

    expect(household().lastPush().changes[0]?.change.value).toMatchObject({
      startsAt: timestampFromMs(new Date(2026, 10, 20, 10, 0).getTime()),
      endsAt: timestampFromMs(new Date(2026, 10, 20, 11, 0).getTime()),
    });
  });
});

describe("text on pages", () => {
  const day = dayPageId("2026-11-21");
  const group = {
    id: "019a8f4e-5c00-7000-8000-0000000000e1",
    pageId: day,
    x: 48,
    y: 60,
    width: 300,
  };
  const first = { id: "019a8f4e-5c00-7000-8000-0000000000f1", groupId: group.id, order: "V" };
  const second = { id: "019a8f4e-5c00-7000-8000-0000000000f2", groupId: group.id, order: "k" };

  function groupRow(seq: number, value: typeof group): RowInit {
    return { seq: BigInt(seq), row: { case: "textGroup", value } };
  }

  function blockRow(seq: number, value: typeof first, markdown = "Buy milk"): RowInit {
    return { seq: BigInt(seq), row: { case: "textBlock", value: { ...value, markdown } } };
  }

  function startWithText() {
    startUpToDate(
      [
        spaceRow(1, inbox),
        pageRow(2, { id: day }),
        groupRow(3, group),
        blockRow(4, first, "# Shopping"),
        blockRow(5, second, "- Oat milk"),
      ],
      5,
    );
  }

  function changesIn(push: Push) {
    return push.changes.map(({ change }) => ({ case: change.case, value: change.value }));
  }

  function textOf(groupId: string) {
    const { textBlocks } = sync.getState();
    return blocksIn(groupId, textBlocks).map(({ markdown }) => markdown);
  }

  it("keeps the text the household sends, and drops a deleted group", () => {
    startWithText();

    expect(sync.getState().textGroups.get(group.id)).toMatchObject({ x: 48, width: 300 });
    expect(textOf(group.id)).toEqual(["# Shopping", "- Oat milk"]);

    household().update(
      { seq: 6n, row: { case: "deleted", value: { kind: RowKind.TEXT_GROUP, id: group.id } } },
      { seq: 6n, row: { case: "deleted", value: { kind: RowKind.TEXT_BLOCK, id: first.id } } },
      { seq: 6n, row: { case: "deleted", value: { kind: RowKind.TEXT_BLOCK, id: second.id } } },
    );

    expect(sync.getState().textGroups.size).toBe(0);
    expect(sync.getState().textBlocks.size).toBe(0);
  });

  it("adds text on a page nobody has written on, with the page, the group and its block in one push", () => {
    startUpToDate([spaceRow(1, inbox)], 1);

    const { groupId, blockId } = sync.addText(day, { x: 40, y: 80 }, 280, "# Monday");

    expect(changesIn(household().lastPush())).toEqual([
      {
        case: "pageCreate",
        value: expect.objectContaining({ pageId: day, kind: PageKind.DAY, ...a4Portrait }),
      },
      {
        case: "textGroupCreate",
        value: expect.objectContaining({ groupId, pageId: day, x: 40, y: 80, width: 280 }),
      },
      {
        case: "textBlockCreate",
        value: expect.objectContaining({ blockId, groupId, markdown: "# Monday" }),
      },
    ]);
    expect(sync.getState().textGroups.get(groupId)).toMatchObject({ placedBy: me, createdBy: me });
    expect(textOf(groupId)).toEqual(["# Monday"]);
  });

  it("adds text on a task's body page, creating the page", () => {
    const task = { id: "019a8f4e-5c00-7000-8000-0000000000c1", spaceId: inbox.id, title: "Trip" };
    startUpToDate([spaceRow(1, inbox), itemRow(2, task)], 2);

    sync.addText(itemPageId(task.id), { x: 40, y: 40 }, 300, "Pack");

    expect(changesIn(household().lastPush())[0]).toEqual({
      case: "pageCreate",
      value: expect.objectContaining({
        pageId: itemPageId(task.id),
        kind: PageKind.ITEM,
        itemId: task.id,
      }),
    });
  });

  it("adds blocks between others, at the start and at the end of a group", () => {
    startWithText();

    sync.addBlock(group.id, first.id, "Between");
    sync.addBlock(group.id, null, "Start");
    sync.addBlock(group.id, second.id, "End");

    expect(textOf(group.id)).toEqual(["Start", "# Shopping", "Between", "- Oat milk", "End"]);
  });

  it("edits, moves, resizes and deletes text at once, and undoes a refused change", () => {
    startWithText();

    sync.editBlock(first.id, "# Groceries");
    sync.moveTextGroup(group.id, 100, 200);
    sync.resizeTextGroup(group.id, 240);

    expect(textOf(group.id)).toEqual(["# Groceries", "- Oat milk"]);
    expect(sync.getState().textGroups.get(group.id)).toMatchObject({ x: 100, y: 200, width: 240 });
    const edit = household().pushes()[0];
    if (!edit) throw new Error("Nothing was pushed");
    household().commit(edit, { [edit.changes[0]?.changeId ?? ""]: "Too long." });

    expect(textOf(group.id)).toEqual(["# Shopping", "- Oat milk"]);
    expect(sync.getState().problems).toEqual(["Couldn't save changing text: Too long."]);

    sync.deleteBlock(second.id);

    expect(textOf(group.id)).toEqual(["# Shopping"]);
  });

  it("deletes the group when its last block is deleted", () => {
    startWithText();

    sync.deleteBlock(second.id);
    sync.deleteBlock(first.id);

    expect(changesIn(household().lastPush())).toEqual([
      { case: "textGroupDelete", value: expect.objectContaining({ groupId: group.id }) },
    ]);
    expect(sync.getState().textGroups.size).toBe(0);
    expect(sync.getState().textBlocks.size).toBe(0);
  });

  it("splits a group before a block into a new group, as wide, and joins it back", () => {
    startWithText();

    const split = sync.splitTextGroup(second.id, { x: 48, y: 400 });

    if (!split) throw new Error("Nothing was split");
    expect(sync.getState().textGroups.get(split)).toMatchObject({
      pageId: day,
      y: 400,
      width: 300,
    });
    expect(textOf(group.id)).toEqual(["# Shopping"]);
    expect(textOf(split)).toEqual(["- Oat milk"]);

    sync.joinTextGroups(group.id, split);

    expect(textOf(group.id)).toEqual(["# Shopping", "- Oat milk"]);
    expect(sync.getState().textGroups.has(split)).toBe(false);
    expect(changesIn(household().lastPush()).map(({ case: kind }) => kind)).toEqual([
      "textBlockMove",
      "textGroupDelete",
    ]);
  });

  it("splits nothing before a group's first block", () => {
    startWithText();

    expect(sync.splitTextGroup(first.id, { x: 0, y: 0 })).toBe(null);
    expect(household().pushes()).toEqual([]);
  });

  it("deletes the text on a task's body page with the task", () => {
    const task = { id: "019a8f4e-5c00-7000-8000-0000000000c1", spaceId: inbox.id, title: "Trip" };
    const body = itemPageId(task.id);
    startUpToDate(
      [
        spaceRow(1, inbox),
        itemRow(2, task),
        pageRow(3, { id: body, kind: PageKind.ITEM, itemId: task.id }),
        groupRow(4, { ...group, pageId: body }),
        blockRow(5, first),
      ],
      5,
    );

    sync.deleteTask(task.id);

    expect(sync.getState().textGroups.size).toBe(0);
    expect(sync.getState().textBlocks.size).toBe(0);
  });
});

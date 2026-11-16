import { create, fromBinary, type MessageInitShape, toBinary } from "@bufbuild/protobuf";
import { newId, signedOutCloseCode } from "@foyer/shared";
import { SpaceKind } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import {
  type DeviceMessage,
  DeviceMessageSchema,
  HouseholdMessageSchema,
  type Push,
  RowKind,
  type RowSchema,
} from "@foyer/shared/gen/foyer/sync/v1/sync_pb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type Connect,
  type ConnectionEvents,
  HouseholdSync,
  keepAliveInterval,
  longestReconnectDelay,
  pushChangeLimit,
  silenceLimit,
} from "../src/sync/household-sync";
import { syncAddress } from "../src/sync/socket";

type RowInit = MessageInitShape<typeof RowSchema>;

const me = "019a8f4e-5c00-7000-8000-000000000001";
const housemate = "019a8f4e-5c00-7000-8000-000000000002";

/** One connection the device opened, seen from the household's side. */
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
  space: { id?: string; kind?: SpaceKind; ownerId?: string; name: string },
): RowInit {
  const value = { id: newId(), kind: SpaceKind.SHARED, ...space };
  return { seq: BigInt(seq), row: { case: "space", value } };
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

/** Starts the device, and brings it up to date with the rows. */
function startUpToDate(rows: RowInit[] = [spaceRow(1, inbox), spaceRow(2, home)], seq = 2) {
  sync.start();
  household().welcome(seq);
  household().reply(rows, seq);
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

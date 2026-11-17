import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { HouseholdMessageSchema } from "@foyer/shared/gen/foyer/sync/v1/sync_pb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveLane, pointInterval } from "../src/sync/live-lane";

const today = "day:2026-11-17";
const tomorrow = "day:2026-11-18";
const sam = "019a8f4e-5c00-7000-8000-000000000002";
const kim = "019a8f4e-5c00-7000-8000-000000000003";

type Sent = { case: string | undefined; value?: unknown };

let sent: Sent[];
let lane: LiveLane;

function say(message: MessageInitShape<typeof HouseholdMessageSchema>["message"]) {
  return lane.receive(create(HouseholdMessageSchema, { message }).message);
}

function here(pageId: string, ...members: { memberId: string; x?: number; y?: number }[]) {
  say({
    case: "here",
    value: {
      pageId,
      members: members.map(({ memberId, x, y }) =>
        x === undefined || y === undefined ? { memberId } : { memberId, position: { x, y } },
      ),
    },
  });
}

function pointed(memberId: string, x: number, y: number) {
  say({ case: "pointed", value: { memberId, x, y } });
}

function sentSince() {
  return sent.splice(0).map((message) => [message.case, message.value]);
}

function sharingPage(pageId = today) {
  lane.connected();
  lane.enter(pageId);
  here(pageId, { memberId: sam });
  sentSince();
}

beforeEach(() => {
  vi.useFakeTimers({ now: Date.UTC(2026, 10, 17, 20) });
  sent = [];
  lane = new LiveLane((message) => sent.push(message as Sent));
});

afterEach(() => {
  lane.disconnected();
  vi.useRealTimers();
});

describe("which page the device is on", () => {
  it("enters its page once connected", () => {
    lane.enter(today);
    expect(sentSince()).toEqual([]);

    lane.connected();

    expect(sentSince()).toEqual([["enter", { pageId: today }]]);
    expect(lane.getState().pageId).toBe(today);
  });

  it("enters each new page once", () => {
    lane.connected();

    lane.enter(today);
    lane.enter(today);
    lane.enter(tomorrow);

    expect(sentSince()).toEqual([
      ["enter", { pageId: today }],
      ["enter", { pageId: tomorrow }],
    ]);
  });

  it("leaves its page once", () => {
    lane.connected();
    lane.enter(today);
    sentSince();

    lane.leave();
    lane.leave();

    expect(sentSince()).toEqual([["leave", {}]]);
    expect(lane.getState().pageId).toBeNull();
  });

  it("leaves its page in the background, and enters it again in the foreground", () => {
    lane.connected();
    lane.enter(today);
    sentSince();

    lane.setActive(false);
    lane.enter(tomorrow);
    lane.setActive(true);

    expect(sentSince()).toEqual([
      ["leave", {}],
      ["enter", { pageId: tomorrow }],
    ]);
  });

  it("enters its page again after connecting again", () => {
    lane.connected();
    lane.enter(today);
    sentSince();

    lane.disconnected();
    lane.connected();

    expect(sentSince()).toEqual([["enter", { pageId: today }]]);
  });

  it("sends nothing when it isn't on a page", () => {
    lane.connected();

    lane.leave();
    lane.setActive(false);
    lane.setActive(true);

    expect(sentSince()).toEqual([]);
  });
});

describe("who else is on the page", () => {
  it("keeps who the household says is there, and where each last pointed", () => {
    lane.connected();
    lane.enter(today);

    here(today, { memberId: sam, x: 10, y: 20 }, { memberId: kim });

    expect(lane.getState().here).toEqual([
      { memberId: sam, position: { x: 10, y: 20 } },
      { memberId: kim, position: null },
    ]);
  });

  it("moves someone's position as they point", () => {
    sharingPage();

    pointed(sam, 30, 40);

    expect(lane.getState().here).toEqual([{ memberId: sam, position: { x: 30, y: 40 } }]);
  });

  it("ignores who is on a page it isn't on", () => {
    lane.connected();
    lane.enter(tomorrow);

    here(today, { memberId: sam });

    expect(lane.getState().here).toEqual([]);
  });

  it("forgets who is there when it leaves, goes to the background or loses its connection", () => {
    for (const away of [
      () => lane.leave(),
      () => lane.setActive(false),
      () => lane.disconnected(),
    ]) {
      lane = new LiveLane(() => {});
      sharingPage();

      away();

      expect(lane.getState().here).toEqual([]);
    }
  });

  it("tells its listeners when something changes", () => {
    lane.connected();
    lane.enter(today);
    const listener = vi.fn();
    lane.subscribe(listener);

    here(today, { memberId: sam });
    pointed(sam, 1, 2);

    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("where the device points", () => {
  it("sends positions only while someone else is on the page", () => {
    lane.connected();
    lane.enter(today);
    sentSince();

    lane.point(1, 2);
    here(today, { memberId: sam });
    lane.point(3, 4);
    here(today);
    vi.advanceTimersByTime(pointInterval);
    lane.point(5, 6);

    expect(sentSince()).toEqual([["point", { x: 3, y: 4 }]]);
  });

  it("sends at most 4 positions a second, the latest one last", () => {
    sharingPage();

    lane.point(1, 1);
    lane.point(2, 2);
    lane.point(3, 3);
    expect(sentSince()).toEqual([["point", { x: 1, y: 1 }]]);

    vi.advanceTimersByTime(pointInterval);
    expect(sentSince()).toEqual([["point", { x: 3, y: 3 }]]);

    vi.advanceTimersByTime(pointInterval);
    expect(sentSince()).toEqual([]);
  });

  it("drops a position waiting to be sent once it leaves the page", () => {
    sharingPage();
    lane.point(1, 1);
    lane.point(2, 2);
    sentSince();

    lane.enter(tomorrow);
    vi.advanceTimersByTime(pointInterval);

    expect(sentSince()).toEqual([["enter", { pageId: tomorrow }]]);
  });
});

describe("the daily limit for positions", () => {
  it("stops sending positions until midnight UTC, and hides where others pointed", () => {
    sharingPage();
    pointed(sam, 1, 2);

    say({ case: "liveLimit", value: {} });
    lane.point(1, 1);

    expect(sentSince()).toEqual([]);
    expect(lane.getState()).toMatchObject({
      limited: true,
      here: [{ memberId: sam, position: null }],
    });
  });

  it("sends positions again from midnight UTC, and says so", () => {
    sharingPage();
    say({ case: "liveLimit", value: {} });
    const listener = vi.fn();
    lane.subscribe(listener);

    vi.advanceTimersByTime(Date.UTC(2026, 10, 18) - Date.now() - 1);
    expect(lane.getState().limited).toBe(true);
    vi.advanceTimersByTime(1);
    lane.point(1, 1);

    expect(listener).toHaveBeenCalled();
    expect(lane.getState().limited).toBe(false);
    expect(sentSince()).toEqual([["point", { x: 1, y: 1 }]]);
  });

  it("leaves out where others pointed when the household says so on entering", () => {
    lane.connected();
    lane.enter(today);
    say({ case: "liveLimit", value: {} });

    here(today, { memberId: sam, x: 1, y: 2 });

    expect(lane.getState().here).toEqual([{ memberId: sam, position: null }]);
  });

  it("takes the household passing positions on again as the limit lifting", () => {
    sharingPage();
    say({ case: "liveLimit", value: {} });

    pointed(sam, 1, 2);
    lane.point(3, 4);

    expect(lane.getState().limited).toBe(false);
    expect(sentSince()).toEqual([["point", { x: 3, y: 4 }]]);
  });
});

describe("messages", () => {
  it("keeps only the live lane's messages", () => {
    expect(say({ case: "welcome", value: { seq: 1n } })).toBe(false);
    expect(say({ case: "liveLimit", value: {} })).toBe(true);
  });
});

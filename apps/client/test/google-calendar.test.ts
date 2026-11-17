import { GoogleConnectionState } from "@foyer/shared/gen/foyer/calendar/v1/calendar_pb";
import { CalendarState, SpaceKind } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { problemFromConnecting } from "../src/calendar/connect-google.web";
import {
  describeConnection,
  describeSpaceCalendar,
  problemReturnedTo,
  shareReminder,
} from "../src/calendar/google-calendar";

const me = "019a8f4e-5c00-7000-8000-000000000001";
const housemate = "019a8f4e-5c00-7000-8000-000000000002";
const members = [
  { id: me, name: "Alex" },
  { id: housemate, name: "Sam" },
] as never;

function space(
  kind: SpaceKind,
  calendar: { calendarState?: CalendarState; calendarMemberId?: string } = {},
) {
  return {
    id: "019a8f4e-5c00-7000-8000-0000000000a2",
    kind,
    ownerId: "",
    name: "Groceries",
    calendarMemberId: "",
    calendarState: CalendarState.NONE,
    ...calendar,
  } as never;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("describeConnection", () => {
  it.each([
    [null, "Not connected"],
    [GoogleConnectionState.CONNECTED, "Connected"],
    [
      GoogleConnectionState.NEEDS_RECONNECTING,
      "Needs reconnecting. Google stopped accepting Foyer's access.",
    ],
  ])("says where a connection in state %s stands", (state, line) => {
    const connection = state === null ? null : ({ memberId: me, state } as never);
    expect(describeConnection(connection)).toBe(line);
  });
});

describe("describeSpaceCalendar", () => {
  it("says nothing of the Inbox, which never has a calendar", () => {
    expect(describeSpaceCalendar(space(SpaceKind.INBOX), me, members)).toBeNull();
  });

  it("says whose Google account holds a calendar", () => {
    const mine = space(SpaceKind.SHARED, {
      calendarState: CalendarState.SYNCING,
      calendarMemberId: me,
    });
    const sams = space(SpaceKind.SHARED, {
      calendarState: CalendarState.SYNCING,
      calendarMemberId: housemate,
    });

    expect(describeSpaceCalendar(mine, me, members)).toBe("Calendar in your Google account");
    expect(describeSpaceCalendar(sams, me, members)).toBe("Calendar in Sam's Google account");
  });

  it("says whose access needs reconnecting when a calendar is paused", () => {
    const mine = space(SpaceKind.PERSONAL, {
      calendarState: CalendarState.PAUSED,
      calendarMemberId: me,
    });
    const sams = space(SpaceKind.SHARED, {
      calendarState: CalendarState.PAUSED,
      calendarMemberId: housemate,
    });

    expect(describeSpaceCalendar(mine, me, members)).toBe(
      "Calendar paused until you reconnect Google Calendar",
    );
    expect(describeSpaceCalendar(sams, me, members)).toBe(
      "Calendar paused until Sam reconnects Google Calendar",
    );
  });

  it("says when a space has no calendar yet", () => {
    expect(describeSpaceCalendar(space(SpaceKind.PERSONAL), me, members)).toBe(
      "No Google calendar yet",
    );
  });
});

describe("shareReminder", () => {
  it("reminds the member who holds a shared space's calendar to share it with the household", () => {
    const held = space(SpaceKind.SHARED, {
      calendarState: CalendarState.SYNCING,
      calendarMemberId: me,
    });

    expect(shareReminder(held, me)).toBe(
      "Share “Foyer · Groceries” with the household in Google Calendar's settings.",
    );
    expect(shareReminder(held, housemate)).toBeNull();
  });

  it("doesn't remind anyone of a personal space, or a space without a calendar", () => {
    const personal = space(SpaceKind.PERSONAL, {
      calendarState: CalendarState.SYNCING,
      calendarMemberId: me,
    });

    expect(shareReminder(personal, me)).toBeNull();
    expect(shareReminder(space(SpaceKind.SHARED), me)).toBeNull();
  });
});

describe("problemReturnedTo", () => {
  it.each([
    [
      "other-account",
      "That isn't the Google account you sign in with. Connect Google Calendar with that one.",
    ],
    ["no-access", "Foyer needs access to the calendars it creates. Connect again and allow it."],
    ["failed", "Connecting Google Calendar didn't work. Try again."],
  ])("says why connecting returned to the iPad app with the error %s", (error, problem) => {
    expect(problemReturnedTo(`foyer://google-calendar?error=${error}`)).toBe(problem);
  });

  it("has nothing to say once it connected", () => {
    expect(problemReturnedTo("foyer://google-calendar")).toBeUndefined();
  });
});

describe("problemFromConnecting on the web", () => {
  function openWebAppAt(address: string) {
    const browser = {
      location: { href: address },
      history: {
        state: { route: "home" },
        replaceState: vi.fn((_: unknown, __: string, url: URL) => {
          browser.location.href = url.toString();
        }),
      },
    };
    vi.stubGlobal("window", browser);
    return browser;
  }

  it("says why connecting returned without connecting, once", () => {
    const browser = openWebAppAt(
      "http://localhost:8787/?google-calendar-error=other-account&view=day",
    );

    const first = problemFromConnecting();

    expect(first).toBe(
      "That isn't the Google account you sign in with. Connect Google Calendar with that one.",
    );
    expect(browser.location.href).toBe("http://localhost:8787/?view=day");
    expect(problemFromConnecting()).toBeUndefined();
  });

  it("has nothing to say when connecting returned without a problem", () => {
    openWebAppAt("http://localhost:8787/");

    expect(problemFromConnecting()).toBeUndefined();
  });
});

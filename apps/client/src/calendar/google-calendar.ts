import type { Client } from "@connectrpc/connect";
import { calendarName } from "@foyer/shared";
import {
  type CalendarService,
  type GoogleConnection,
  GoogleConnectionState,
} from "@foyer/shared/gen/foyer/calendar/v1/calendar_pb";
import type { Member } from "@foyer/shared/gen/foyer/member/v1/member_pb";
import { CalendarState, type Space, SpaceKind } from "@foyer/shared/gen/foyer/space/v1/space_pb";

/** Calls the backend's calendar service. */
export type Calendars = Client<typeof CalendarService>;

/** Tells the person why connecting Google Calendar returned without connecting. */
export function describeConnectingError(error: string): string {
  switch (error) {
    case "other-account":
      return "That isn't the Google account you sign in with. Connect Google Calendar with that one.";
    case "no-access":
      return "Foyer needs access to the calendars it creates. Connect again and allow it.";
    default:
      return "Connecting Google Calendar didn't work. Try again.";
  }
}

/** Why connecting returned to the iPad app at an address without connecting, if it did. */
export function problemReturnedTo(address: string): string | undefined {
  const error = new URL(address).searchParams.get("error");
  return error ? describeConnectingError(error) : undefined;
}

/** Where the member's connection to Google stands, in a few words. */
export function describeConnection(connection: GoogleConnection | null): string {
  if (!connection) return "Not connected";
  return connection.state === GoogleConnectionState.NEEDS_RECONNECTING
    ? "Needs reconnecting. Google stopped accepting Foyer's access."
    : "Connected";
}

/** Where a space's Google calendar stands, for the member `memberId`, or null for the Inbox, which
 *  never has one. */
export function describeSpaceCalendar(
  space: Space,
  memberId: string,
  members: readonly Member[],
): string | null {
  if (space.kind === SpaceKind.INBOX) return null;
  const mine = space.calendarMemberId === memberId;
  const holder = members.find(({ id }) => id === space.calendarMemberId)?.name ?? "Someone";
  switch (space.calendarState) {
    case CalendarState.SYNCING:
      return mine ? "Calendar in your Google account" : `Calendar in ${holder}'s Google account`;
    case CalendarState.PAUSED:
      return mine
        ? "Calendar paused until you reconnect Google Calendar"
        : `Calendar paused until ${holder} reconnects Google Calendar`;
    default:
      return "No Google calendar yet";
  }
}

/** Reminds the member whose Google account holds a shared space's calendar to share it with the
 *  household, which only Google Calendar can do. Null for any other space or member. */
export function shareReminder(space: Space, memberId: string): string | null {
  const holds =
    space.kind === SpaceKind.SHARED &&
    space.calendarState !== CalendarState.NONE &&
    space.calendarState !== CalendarState.UNSPECIFIED &&
    space.calendarMemberId === memberId;
  return holds
    ? `Share “${calendarName(space.name)}” with the household in Google Calendar's settings.`
    : null;
}

/** The device's time zone, which the member's new Google calendars take. */
export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

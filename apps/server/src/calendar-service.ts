import { Code, ConnectError, type ServiceImpl } from "@connectrpc/connect";
import { App, type CalendarService } from "@foyer/shared/gen/foyer/calendar/v1/calendar_pb";
import { type ConnectingApp, startConnecting } from "./connecting";
import { theHousehold } from "./household";
import { signedInMember } from "./signed-in";

const apps: Partial<Record<App, ConnectingApp>> = { [App.WEB]: "web", [App.IPAD]: "ipad" };

/** Connects members' Google accounts, so the household can make their spaces' calendars. */
export const calendarService: ServiceImpl<typeof CalendarService> = {
  async startConnecting({ app, timeZone }, context) {
    const member = await signedInMember(context);
    const returnTo = apps[app];
    if (!returnTo) {
      throw new ConnectError("Say which app is connecting.", Code.InvalidArgument);
    }
    if (!isTimeZone(timeZone)) {
      throw new ConnectError(`“${timeZone}” isn't a time zone Foyer knows.`, Code.InvalidArgument);
    }
    const address = await startConnecting(new URL(context.url), member.id, returnTo, timeZone);
    if (!address) {
      throw new ConnectError(
        "Google isn't set up on this backend, so Google Calendar can't be connected.",
        Code.FailedPrecondition,
      );
    }
    return { address };
  },

  async disconnect(_, context) {
    const member = await signedInMember(context);
    await theHousehold().disconnectGoogle(member.id);
    return {};
  },
};

function isTimeZone(name: string): boolean {
  if (name.trim() === "") return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

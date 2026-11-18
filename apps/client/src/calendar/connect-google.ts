import { App } from "@foyer/shared/gen/foyer/calendar/v1/calendar_pb";
import { openAuthSessionAsync } from "expo-web-browser";
import { type Calendars, deviceTimeZone, problemReturnedTo } from "./google-calendar";

/** Connects Google Calendar in the system's sign-in sheet, which returns to
 *  `foyer://google-calendar`, and says why it didn't connect, if it didn't. */
export async function connectGoogleCalendar(calendars: Calendars): Promise<string | undefined> {
  const { address } = await calendars.startConnecting({
    app: App.IPAD,
    timeZone: deviceTimeZone(),
  });
  const result = await openAuthSessionAsync(address, "foyer://google-calendar");
  return result.type === "success" ? problemReturnedTo(result.url) : undefined;
}

/** The iPad app is never opened by connecting returning to it, so there's no problem to report. */
export function problemFromConnecting(): string | undefined {
  return undefined;
}

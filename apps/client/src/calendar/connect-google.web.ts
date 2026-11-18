import { App } from "@foyer/shared/gen/foyer/calendar/v1/calendar_pb";
import { type Calendars, describeConnectingError, deviceTimeZone } from "./google-calendar";

const errorParameter = "google-calendar-error";

/** Leaves the web app for Google, which returns to the app's first page once the backend has kept
 *  the access. The page is replaced, so this never resolves. */
export async function connectGoogleCalendar(calendars: Calendars): Promise<string | undefined> {
  const { address } = await calendars.startConnecting({
    app: App.WEB,
    timeZone: deviceTimeZone(),
  });
  window.location.assign(address);
  return new Promise(() => {});
}

/** Why connecting just returned to the web app without connecting, if it did. Reading it removes
 *  it from the address, so it's reported once. */
export function problemFromConnecting(): string | undefined {
  const address = new URL(window.location.href);
  const error = address.searchParams.get(errorParameter);
  if (!error) return undefined;
  address.searchParams.delete(errorParameter);
  window.history.replaceState(window.history.state, "", address);
  return describeConnectingError(error);
}

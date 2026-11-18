import { runInDurableObject } from "cloudflare:test";
import { env, withEnv } from "cloudflare:workers";
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { App, CalendarService } from "@foyer/shared/gen/foyer/calendar/v1/calendar_pb";
import { fakeGoogle } from "../src/fake-google";
import { theHousehold } from "../src/household";
import worker from "../src/index";
import { backendUrl, locationOf, requestBackend } from "./backend";

/** Calls the backend's calendar service, with a session token, at the backend's address unless
 *  `at` gives another, and with some of the Worker's settings changed. */
export function calendars(
  token?: string,
  at: { baseUrl?: string; settings?: Partial<Cloudflare.Env> } = {},
) {
  const { baseUrl = backendUrl, settings } = at;
  const transport = createConnectTransport({
    baseUrl,
    fetch: (input, init) =>
      settings
        ? (withEnv({ ...env, ...settings }, () =>
            worker.fetch(
              new Request(input, { ...init, redirect: "manual" }) as Parameters<
                typeof worker.fetch
              >[0],
            ),
          ) as Promise<Response>)
        : requestBackend(input.toString(), init),
  });
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  const client = createClient(CalendarService, transport);
  return {
    startConnecting: (app = App.WEB, timeZone = "Europe/Madrid") =>
      client.startConnecting({ app, timeZone }, { headers }),
    disconnect: () => client.disconnect({}, { headers }),
  };
}

/** Connects a member's Google account through the fake Google, as the account they sign in with
 *  and with access to Foyer's calendars unless `options` say otherwise, and returns where the
 *  backend then sends the app. */
export async function connectGoogle(
  token: string,
  options: {
    app?: App;
    account?: string;
    scope?: string;
    timeZone?: string;
    returned?: (callback: URL) => void;
  } = {},
): Promise<URL> {
  const { address } = await calendars(token).startConnecting(options.app, options.timeZone);
  const google = new URL(address);
  const callback = new URL(google.searchParams.get("redirect_uri") ?? "");
  const account = options.account ?? google.searchParams.get("login_hint") ?? "";
  const scope = options.scope ?? google.searchParams.get("scope") ?? "";
  callback.searchParams.set("code", fakeGoogle.codeFor(account, scope));
  callback.searchParams.set("state", google.searchParams.get("state") ?? "");
  options.returned?.(callback);
  return locationOf(await requestBackend(callback.toString()));
}

/** Runs the household's alarm, which does the work waiting for Google. */
export async function work(): Promise<void> {
  await runInDurableObject(theHousehold(), (household) => household.alarm());
}

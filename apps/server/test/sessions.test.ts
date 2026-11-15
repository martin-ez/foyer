import { reset, runInDurableObject } from "cloudflare:test";
import { env, withEnv } from "cloudflare:workers";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { theHousehold } from "../src/household";
import {
  backendUrl,
  cookiesSetBy,
  localBackendUrl,
  locationOf,
  requestBackend,
  sessionClient,
  sessionCookieSetBy,
} from "./backend";

const day = 24 * 60 * 60 * 1000;

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await reset();
});

function startClockAt(time: number) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(time);
}

async function signInOnTheWeb(): Promise<string> {
  const returned = await requestBackend(`${localBackendUrl}/auth/dev?email=member@example.com`);
  return sessionCookieSetBy(returned) ?? "";
}

async function signInOnTheIpad(): Promise<string> {
  return (await sessionClient().finishSignIn({ code: await signInCode() })).token;
}

async function signInCode(): Promise<string> {
  const returned = await requestBackend(
    `${localBackendUrl}/auth/dev?email=member@example.com&app=ipad`,
  );
  return locationOf(returned).searchParams.get("code") ?? "";
}

function bearer(token: string) {
  return { headers: { Authorization: `Bearer ${token}` } };
}

function callSessionService(method: "GetSession" | "SignOut", cookie: string) {
  return requestBackend(`${backendUrl}/foyer.session.v1.SessionService/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: "{}",
  });
}

async function codeOf(call: Promise<unknown>): Promise<Code | undefined> {
  try {
    await call;
    return undefined;
  } catch (error) {
    return ConnectError.from(error).code;
  }
}

describe("asking who is signed in", () => {
  it("answers with the member, for a session in a cookie or a bearer token", async () => {
    const cookie = await signInOnTheWeb();
    const token = await signInOnTheIpad();

    const onTheWeb = await sessionClient().getSession({}, { headers: { Cookie: cookie } });
    const onTheIpad = await sessionClient().getSession({}, bearer(token));

    expect(onTheWeb.member).toMatchObject({ name: "member" });
    expect(onTheIpad.member).toEqual(onTheWeb.member);
  });

  it.each([
    ["no session", {}],
    ["a token that was never given", bearer("not-a-token")],
    ["a cookie that was never set", { headers: { Cookie: "foyer_session=not-a-token" } }],
  ])("fails as unauthenticated for a call with %s", async (_, options) => {
    expect(await codeOf(sessionClient().getSession({}, options))).toBe(Code.Unauthenticated);
  });
});

describe("the iPad's one-time code", () => {
  it("can be exchanged once", async () => {
    const code = await signInCode();

    await sessionClient().finishSignIn({ code });

    expect(await codeOf(sessionClient().finishSignIn({ code }))).toBe(Code.Unauthenticated);
  });

  it("lasts a minute", async () => {
    startClockAt(Date.UTC(2026, 10, 15));
    const lasting = await signInCode();
    const expiring = await signInCode();

    vi.setSystemTime(Date.UTC(2026, 10, 15) + 59_000);
    const exchanged = await codeOf(sessionClient().finishSignIn({ code: lasting }));
    vi.setSystemTime(Date.UTC(2026, 10, 15) + 60_000);
    const expired = await codeOf(sessionClient().finishSignIn({ code: expiring }));

    expect(exchanged).toBeUndefined();
    expect(expired).toBe(Code.Unauthenticated);
  });

  it("is refused when it was never given", async () => {
    expect(await codeOf(sessionClient().finishSignIn({ code: "made-up" }))).toBe(
      Code.Unauthenticated,
    );
  });
});

describe("signing out", () => {
  it("ends the iPad's session, and only that one", async () => {
    const signingOut = await signInOnTheIpad();
    const staying = await signInOnTheIpad();

    await sessionClient().signOut({}, bearer(signingOut));

    expect(await codeOf(sessionClient().getSession({}, bearer(signingOut)))).toBe(
      Code.Unauthenticated,
    );
    expect(await codeOf(sessionClient().getSession({}, bearer(staying)))).toBeUndefined();
  });

  it("ends the web session and removes its cookie", async () => {
    const cookie = await signInOnTheWeb();

    const signedOut = await callSessionService("SignOut", cookie);

    expect(signedOut.ok).toBe(true);
    expect(cookiesSetBy(signedOut)).toEqual([
      "foyer_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure",
    ]);
    expect(await codeOf(sessionClient().getSession({}, { headers: { Cookie: cookie } }))).toBe(
      Code.Unauthenticated,
    );
  });

  it("succeeds when nobody is signed in", async () => {
    expect(await codeOf(sessionClient().signOut({}))).toBeUndefined();
  });
});

describe("a session", () => {
  it("ends after 90 days without use", async () => {
    startClockAt(Date.UTC(2026, 0, 1));
    const token = await signInOnTheIpad();

    vi.setSystemTime(Date.UTC(2026, 0, 1) + 90 * day);

    expect(await codeOf(sessionClient().getSession({}, bearer(token)))).toBe(Code.Unauthenticated);
  });

  it("keeps going for as long as it's used", async () => {
    startClockAt(Date.UTC(2026, 0, 1));
    const token = await signInOnTheIpad();

    for (const month of [2, 4, 6]) {
      vi.setSystemTime(Date.UTC(2026, month, 1));
      await sessionClient().getSession({}, bearer(token));
    }

    expect(await codeOf(sessionClient().getSession({}, bearer(token)))).toBeUndefined();
  });

  it("renews its web cookie when it's first used each day", async () => {
    startClockAt(Date.UTC(2026, 0, 1));
    const cookie = await signInOnTheWeb();

    vi.setSystemTime(Date.UTC(2026, 0, 1, 23));
    const sameDay = await callSessionService("GetSession", cookie);
    vi.setSystemTime(Date.UTC(2026, 0, 2, 1));
    const nextDay = await callSessionService("GetSession", cookie);
    const againThatDay = await callSessionService("GetSession", cookie);

    expect(cookiesSetBy(sameDay)).toEqual([]);
    expect(cookiesSetBy(nextDay)).toEqual([
      `${cookie}; Path=/; Max-Age=7776000; HttpOnly; SameSite=Lax; Secure`,
    ]);
    expect(cookiesSetBy(againThatDay)).toEqual([]);
  });

  it("ends once its member's email leaves the allowlist, even if it's added back", async () => {
    const token = await signInOnTheIpad();

    const whileRemoved = await runInDurableObject(theHousehold(), (household) =>
      withEnv({ ...env, HOUSEHOLD_MEMBERS: "[]" }, () => household.sessionFor(token)),
    );

    expect(whileRemoved).toBeNull();
    expect(await codeOf(sessionClient().getSession({}, bearer(token)))).toBe(Code.Unauthenticated);
  });

  it("is stored only as a hash of its token", async () => {
    const token = await signInOnTheIpad();

    const stored = await runInDurableObject(theHousehold(), (_, state) =>
      state.storage.sql.exec("SELECT * FROM sessions").toArray(),
    );

    expect(JSON.stringify(stored)).not.toContain(token);
    expect(stored).toHaveLength(1);
  });
});

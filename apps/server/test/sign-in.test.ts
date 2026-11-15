import { reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  backendUrl,
  cookiesSetBy,
  localBackendUrl,
  locationOf,
  member,
  requestBackend,
  requestBackendWith,
  sessionClient,
  sessionCookieSetBy,
  signInWithGoogle,
} from "./backend";

afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
});

async function sha256Base64Url(text: string) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );
  return btoa(String.fromCharCode(...digest))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

describe("signing in with Google", () => {
  it("asks Google for the person's name and email only, and to come back to the backend", async () => {
    const { start, google } = await signInWithGoogle(member);

    expect(start.status).toBe(302);
    expect(`${google.origin}${google.pathname}`).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(google.searchParams.get("client_id")).toBe(env.GOOGLE_CLIENT_ID);
    expect(google.searchParams.get("scope")).toBe("openid email profile");
    expect(google.searchParams.get("response_type")).toBe("code");
    expect(google.searchParams.get("redirect_uri")).toBe(`${backendUrl}/auth/google/callback`);
    expect(google.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("proves to Google that the code comes from the sign-in the backend started", async () => {
    const { google, tokenRequests } = await signInWithGoogle(member);

    const [tokenRequest] = tokenRequests;
    expect(tokenRequest?.get("code")).toBe("google-code");
    expect(tokenRequest?.get("client_id")).toBe(env.GOOGLE_CLIENT_ID);
    expect(tokenRequest?.get("client_secret")).toBe(env.GOOGLE_CLIENT_SECRET);
    expect(tokenRequest?.get("redirect_uri")).toBe(`${backendUrl}/auth/google/callback`);
    expect(await sha256Base64Url(tokenRequest?.get("code_verifier") ?? "")).toBe(
      google.searchParams.get("code_challenge"),
    );
  });

  it("returns to the web app with a session cookie, for a member on the allowlist", async () => {
    const { returned } = await signInWithGoogle(member);
    const cookie = sessionCookieSetBy(returned);

    expect(locationOf(returned).toString()).toBe(`${backendUrl}/`);
    expect(cookiesSetBy(returned).find((set) => set.startsWith("foyer_session="))).toMatch(
      /; Path=\/; Max-Age=7776000; HttpOnly; SameSite=Lax; Secure$/,
    );
    const session = await sessionClient().getSession({}, { headers: { Cookie: cookie ?? "" } });
    expect(session.member).toMatchObject({ name: "Alex" });
  });

  it("returns to the iPad app with a one-time code it exchanges for a session token", async () => {
    const { returned } = await signInWithGoogle(member, { app: "ipad" });
    const redirect = locationOf(returned);

    expect(`${redirect.protocol}//${redirect.host}`).toBe("foyer://signed-in");
    expect(sessionCookieSetBy(returned)).toBeUndefined();
    const signedIn = await sessionClient().finishSignIn({
      code: redirect.searchParams.get("code") ?? "",
    });
    expect(signedIn.member).toMatchObject({ name: "Alex" });
    const session = await sessionClient().getSession(
      {},
      { headers: { Authorization: `Bearer ${signedIn.token}` } },
    );
    expect(session.member).toEqual(signedIn.member);
  });

  it("finds the same member each time the same Google account signs in", async () => {
    const first = await signInWithGoogle(member);
    const second = await signInWithGoogle({ ...member, given_name: "Renamed" });

    const sessions = await Promise.all(
      [first, second].map(({ returned }) =>
        sessionClient().getSession({}, { headers: { Cookie: sessionCookieSetBy(returned) ?? "" } }),
      ),
    );
    expect(sessions[1]?.member).toEqual(sessions[0]?.member);
    expect(sessions[1]?.member?.name).toBe("Alex");
  });

  it("names a member after their full name, or their email, when Google has no first name", async () => {
    const named = await signInWithGoogle({ ...member, given_name: undefined, sub: "2" });
    const unnamed = await signInWithGoogle({
      ...member,
      given_name: undefined,
      name: undefined,
      sub: "3",
    });

    const names = await Promise.all(
      [named, unnamed].map(async ({ returned }) => {
        const cookie = sessionCookieSetBy(returned) ?? "";
        return (await sessionClient().getSession({}, { headers: { Cookie: cookie } })).member?.name;
      }),
    );
    expect(names).toEqual(["Alex Doe", "member"]);
  });

  describe("refuses, returning to the app to say the account isn't part of this household,", () => {
    it.each([
      ["an email that isn't on the allowlist", { ...member, email: "someone.else@example.com" }],
      ["an email Google hasn't verified", { ...member, email_verified: false }],
    ])("%s", async (_, claims) => {
      const web = await signInWithGoogle(claims);
      const ipad = await signInWithGoogle(claims, { app: "ipad" });

      expect(locationOf(web.returned).toString()).toBe(
        `${backendUrl}/?sign-in-error=not-in-household`,
      );
      expect(sessionCookieSetBy(web.returned)).toBeUndefined();
      expect(locationOf(ipad.returned).toString()).toBe("foyer://signed-in?error=not-in-household");
    });
  });

  describe("fails, returning to the app to say so,", () => {
    it.each([
      [
        "when Google comes back to another sign-in",
        (url: URL) => url.searchParams.set("state", "x"),
      ],
      ["when Google sends no code", (url: URL) => url.searchParams.delete("code")],
    ])("%s", async (_, tamper) => {
      const { returned } = await signInWithGoogle(member, { tamper });

      expect(locationOf(returned).toString()).toBe(`${backendUrl}/?sign-in-error=failed`);
      expect(sessionCookieSetBy(returned)).toBeUndefined();
    });

    it("when the browser didn't start the sign-in", async () => {
      const { returned } = await signInWithGoogle(member, { keepCookie: false });

      expect(locationOf(returned).toString()).toBe(`${backendUrl}/?sign-in-error=failed`);
    });

    it.each([
      ["for another client", { ...member, aud: "another-client" }],
      ["from another issuer", { ...member, iss: "https://example.com" }],
      ["that has expired", { ...member, exp: Math.floor(Date.now() / 1000) - 60 }],
    ])("when Google's ID token is %s", async (_, claims) => {
      vi.spyOn(console, "error").mockImplementation(() => {});

      const { returned } = await signInWithGoogle(claims, { app: "ipad" });

      expect(locationOf(returned).toString()).toBe("foyer://signed-in?error=failed");
    });

    it("when Google refuses the code", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});

      const { returned } = await signInWithGoogle(member, { googleStatus: 400 });

      expect(locationOf(returned).toString()).toBe(`${backendUrl}/?sign-in-error=failed`);
      expect(log).toHaveBeenCalledWith(expect.stringContaining("Google refused the code"));
    });

    it("when the backend has no Google client to sign in with", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});

      const started = await requestBackendWith(
        { GOOGLE_CLIENT_SECRET: undefined },
        `${backendUrl}/auth/google?app=ipad`,
      );

      expect(locationOf(started).toString()).toBe("foyer://signed-in?error=failed");
      expect(log).toHaveBeenCalledWith(expect.stringContaining("GOOGLE_CLIENT_SECRET"));
    });
  });

  it("returns to the app without an error when the person chooses not to sign in", async () => {
    const { returned } = await signInWithGoogle(member, {
      app: "ipad",
      tamper: (url) => {
        url.search = "";
        url.searchParams.set("error", "access_denied");
      },
    });

    expect(locationOf(returned).toString()).toBe("foyer://signed-in");
  });
});

describe("signing in without Google, on the local backend", () => {
  it("signs in as an email on the allowlist, returning to the web app with a session", async () => {
    const returned = await requestBackend(`${localBackendUrl}/auth/dev?email=member@example.com`);
    const cookie = sessionCookieSetBy(returned) ?? "";

    expect(locationOf(returned).toString()).toBe(`${localBackendUrl}/`);
    expect(cookiesSetBy(returned)[0]).not.toContain("Secure");
    const session = await sessionClient().getSession({}, { headers: { Cookie: cookie } });
    expect(session.member).toMatchObject({ name: "member" });
  });

  it("returns to the iPad app with a one-time code", async () => {
    const returned = await requestBackend(
      `${localBackendUrl}/auth/dev?email=member@example.com&app=ipad`,
    );
    const code = locationOf(returned).searchParams.get("code") ?? "";

    expect((await sessionClient().finishSignIn({ code })).member).toMatchObject({ name: "member" });
  });

  it("signs in as the member who signed in with Google with that email", async () => {
    const google = await signInWithGoogle(member);
    const dev = await requestBackend(`${localBackendUrl}/auth/dev?email=Member@Example.com`);

    const [withGoogle, withoutGoogle] = await Promise.all(
      [google.returned, dev].map((returned) =>
        sessionClient().getSession({}, { headers: { Cookie: sessionCookieSetBy(returned) ?? "" } }),
      ),
    );
    expect(withoutGoogle?.member).toEqual(withGoogle?.member);
  });

  it("refuses an email that isn't on the allowlist", async () => {
    const returned = await requestBackend(`${localBackendUrl}/auth/dev?email=someone@example.com`);

    expect(locationOf(returned).toString()).toBe(
      `${localBackendUrl}/?sign-in-error=not-in-household`,
    );
    expect(sessionCookieSetBy(returned)).toBeUndefined();
  });

  it("doesn't exist on a backend reached from another computer", async () => {
    const returned = await requestBackend(`${backendUrl}/auth/dev?email=member@example.com`);

    expect(returned.status).toBe(404);
  });

  it("doesn't exist unless DEV_SIGN_IN is 1", async () => {
    const returned = await requestBackendWith(
      { DEV_SIGN_IN: undefined },
      `${localBackendUrl}/auth/dev?email=member@example.com`,
    );

    expect(returned.status).toBe(404);
  });
});

it("answers addresses under /auth/ that don't exist as not found", async () => {
  expect((await requestBackend(`${backendUrl}/auth/missing`)).status).toBe(404);
});

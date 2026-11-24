import { create, type MessageInitShape } from "@bufbuild/protobuf";
import {
  Code,
  ConnectError,
  createClient,
  createRouterTransport,
  type ServiceImpl,
} from "@connectrpc/connect";
import { MemberSchema } from "@foyer/shared/gen/foyer/member/v1/member_pb";
import {
  type GetSessionResponseSchema,
  SessionService,
} from "@foyer/shared/gen/foyer/session/v1/session_pb";
import { StatusService } from "@foyer/shared/gen/foyer/status/v1/status_pb";
import { describe, expect, it, vi } from "vitest";
import {
  checkSession,
  finishSignIn,
  openSession,
  sendingSessionToken,
  signOut,
} from "../src/session/session";

const alex = { id: "019a8f4e-5c00-7000-8000-000000000001", name: "Alex" };

function backend(answers: Partial<ServiceImpl<typeof SessionService>>) {
  const transport = createRouterTransport(({ service }) => {
    service(SessionService, {
      finishSignIn: () => ({ token: "session-token", member: alex }),
      getSession: (): MessageInitShape<typeof GetSessionResponseSchema> => ({ member: alex }),
      signOut: () => ({}),
      ...answers,
    });
  });
  return createClient(SessionService, transport);
}

function failingWith(code: Code) {
  return () => {
    throw new ConnectError("No", code);
  };
}

describe("checkSession", () => {
  it("finds the signed-in member", async () => {
    expect(await checkSession(backend({}))).toMatchObject({
      status: "signed-in",
      member: alex,
    });
  });

  it("finds nobody signed in when the backend says the call is unauthenticated", async () => {
    const answer = await checkSession(backend({ getSession: failingWith(Code.Unauthenticated) }));

    expect(answer).toEqual({ status: "signed-out" });
  });

  it("says why when the backend can't be reached", async () => {
    const answer = await checkSession(backend({ getSession: failingWith(Code.Unavailable) }));

    expect(answer).toEqual({
      status: "unreachable",
      problem: "Couldn't reach the backend: [unavailable] No",
    });
  });
});

describe("openSession", () => {
  const sam = { id: "019a8f4e-5c00-7000-8000-000000000002", name: "Sam" };

  function keeping(member: typeof alex | null) {
    return {
      member: vi.fn(async () => (member ? create(MemberSchema, member) : null)),
      signedIn: vi.fn(async () => {}),
      ended: vi.fn(async () => {}),
    };
  }

  async function opened(
    kept: ReturnType<typeof keeping>,
    answers: Partial<ServiceImpl<typeof SessionService>>,
  ) {
    const shown: unknown[] = [];
    await openSession(backend(answers), kept, (session) => shown.push(session));
    return shown;
  }

  it("shows the kept member at once, before the backend answers", async () => {
    const kept = keeping(alex);
    let answer = (_: { member: typeof alex }) => {};
    const shown: unknown[] = [];

    const opening = openSession(
      backend({ getSession: () => new Promise((resolve) => (answer = resolve)) }),
      kept,
      (session) => shown.push(session),
    );
    await vi.waitFor(() => expect(shown).toHaveLength(1));

    expect(shown).toMatchObject([{ status: "signed-in", member: alex }]);
    answer({ member: alex });
    await opening;
  });

  it("keeps the kept member signed in while the backend can't be reached", async () => {
    const kept = keeping(alex);

    const shown = await opened(kept, { getSession: failingWith(Code.Unavailable) });

    expect(shown).toMatchObject([{ status: "signed-in", member: alex }]);
    expect(kept.ended).not.toHaveBeenCalled();
  });

  it("shows the member the backend says is signed in, and keeps them", async () => {
    const kept = keeping(alex);
    const renamed = { ...alex, name: "Alexandra" };

    const shown = await opened(kept, { getSession: () => ({ member: renamed }) });

    expect(shown).toMatchObject([
      { status: "signed-in", member: alex },
      { status: "signed-in", member: renamed },
    ]);
    expect(kept.signedIn).toHaveBeenCalledWith(expect.objectContaining(renamed));
  });

  it("forgets the kept member's session once the backend says it has ended", async () => {
    const kept = keeping(alex);

    const shown = await opened(kept, { getSession: failingWith(Code.Unauthenticated) });

    expect(shown).toMatchObject([{ status: "signed-in", member: alex }, { status: "signed-out" }]);
    expect(kept.ended).toHaveBeenCalledWith(alex.id);
    expect(kept.signedIn).not.toHaveBeenCalled();
  });

  it("keeps a member signed in on a device that kept none, and forgets the rest", async () => {
    const kept = keeping(null);

    const shown = await opened(kept, { getSession: () => ({ member: sam }) });

    expect(shown).toMatchObject([{ status: "checking" }, { status: "signed-in", member: sam }]);
    expect(kept.signedIn).toHaveBeenCalledWith(expect.objectContaining(sam));
  });

  it("asks to sign in, or says why it can't, on a device that kept no member", async () => {
    expect(await opened(keeping(null), { getSession: failingWith(Code.Unauthenticated) })).toEqual([
      { status: "checking" },
      { status: "signed-out" },
    ]);
    expect(await opened(keeping(null), { getSession: failingWith(Code.Unavailable) })).toEqual([
      { status: "checking" },
      { status: "unreachable", problem: "Couldn't reach the backend: [unavailable] No" },
    ]);
  });
});

describe("finishSignIn", () => {
  it("exchanges the one-time code for a session, and keeps its token", async () => {
    const finishing = vi.fn(() => ({ token: "session-token", member: alex }));
    const keepToken = vi.fn(async () => {});

    const session = await finishSignIn(
      "foyer://signed-in?code=one-time",
      backend({ finishSignIn: finishing }),
      keepToken,
    );

    expect(session).toMatchObject({ status: "signed-in", member: alex });
    expect(finishing).toHaveBeenCalledWith(
      expect.objectContaining({ code: "one-time" }),
      expect.anything(),
    );
    expect(keepToken).toHaveBeenCalledWith("session-token");
  });

  it.each([
    ["not-in-household", "That Google account isn't part of this household."],
    ["failed", "Signing in didn't work. Try again."],
  ])("says why sign-in returned with the error %s", async (error, problem) => {
    const keepToken = vi.fn(async () => {});

    const session = await finishSignIn(`foyer://signed-in?error=${error}`, backend({}), keepToken);

    expect(session).toEqual({ status: "signed-out", problem });
    expect(keepToken).not.toHaveBeenCalled();
  });

  it("stays signed out, without a problem, when the person chose not to sign in", async () => {
    expect(await finishSignIn("foyer://signed-in", backend({}), async () => {})).toEqual({
      status: "signed-out",
    });
  });

  it("says sign-in didn't work when the backend answers without a member", async () => {
    const keepToken = vi.fn(async () => {});

    const session = await finishSignIn(
      "foyer://signed-in?code=one-time",
      backend({ finishSignIn: () => ({ token: "session-token" }) }),
      keepToken,
    );

    expect(session).toEqual({
      status: "signed-out",
      problem: "Signing in didn't work. Try again.",
    });
    expect(keepToken).not.toHaveBeenCalled();
  });

  it("says sign-in didn't work when the backend refuses the code", async () => {
    const keepToken = vi.fn(async () => {});

    const session = await finishSignIn(
      "foyer://signed-in?code=expired",
      backend({ finishSignIn: failingWith(Code.Unauthenticated) }),
      keepToken,
    );

    expect(session).toEqual({
      status: "signed-out",
      problem: "Signing in didn't work. Try again.",
    });
    expect(keepToken).not.toHaveBeenCalled();
  });
});

describe("signOut", () => {
  it("ends the session on the backend, then forgets its token", async () => {
    const ending = vi.fn(() => ({}));
    const forgetToken = vi.fn(async () => {});

    const session = await signOut(backend({ signOut: ending }), forgetToken);

    expect(session).toEqual({ status: "signed-out" });
    expect(ending).toHaveBeenCalled();
    expect(forgetToken).toHaveBeenCalled();
  });

  it("keeps the token, and says why, when the backend can't be reached", async () => {
    const forgetToken = vi.fn(async () => {});

    const session = await signOut(backend({ signOut: failingWith(Code.Unavailable) }), forgetToken);

    expect(session).toEqual({
      status: "unreachable",
      problem: "Couldn't reach the backend: [unavailable] No",
    });
    expect(forgetToken).not.toHaveBeenCalled();
  });
});

describe("sendingSessionToken", () => {
  function statusBackendSeeing(readToken: () => Promise<string | null>) {
    const seen: (string | null)[] = [];
    const transport = createRouterTransport(
      ({ service }) => {
        service(StatusService, {
          getStatus: (_, context) => {
            seen.push(context.requestHeader.get("Authorization"));
            return { app: "Foyer", storage: "ok" };
          },
        });
      },
      { transport: { interceptors: [sendingSessionToken(readToken)] } },
    );
    return { client: createClient(StatusService, transport), seen };
  }

  it("sends the kept token as a bearer token on every call", async () => {
    const { client, seen } = statusBackendSeeing(async () => "session-token");

    await client.getStatus({});
    await client.getStatus({});

    expect(seen).toEqual(["Bearer session-token", "Bearer session-token"]);
  });

  it("sends no token when none is kept", async () => {
    const { client, seen } = statusBackendSeeing(async () => null);

    await client.getStatus({});

    expect(seen).toEqual([null]);
  });
});

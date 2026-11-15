import type { MessageInitShape } from "@bufbuild/protobuf";
import {
  Code,
  ConnectError,
  createClient,
  createRouterTransport,
  type ServiceImpl,
} from "@connectrpc/connect";
import {
  type GetSessionResponseSchema,
  SessionService,
} from "@foyer/shared/gen/foyer/session/v1/session_pb";
import { StatusService } from "@foyer/shared/gen/foyer/status/v1/status_pb";
import { describe, expect, it, vi } from "vitest";
import { checkSession, finishSignIn, sendingSessionToken, signOut } from "../src/session/session";

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

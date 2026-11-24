import { create } from "@bufbuild/protobuf";
import { MemberSchema } from "@foyer/shared/gen/foyer/member/v1/member_pb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as SessionToken from "../src/session/session-token";

const keychain = vi.hoisted(() => new Map<string, string>());

vi.mock("expo-secure-store", () => ({
  getItemAsync: async (key: string) => keychain.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    keychain.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    keychain.delete(key);
  },
}));

const alex = create(MemberSchema, { id: "019a8f4e-5c00-7000-8000-000000000001", name: "Alex" });

async function launchApp(): Promise<typeof SessionToken> {
  vi.resetModules();
  return import("../src/session/session-token");
}

beforeEach(() => {
  keychain.clear();
});

describe("the member signed in on the iPad", () => {
  it("is kept with the session's token, for the next launch", async () => {
    let app = await launchApp();
    await app.keepSessionToken("session-token");
    await app.keepSignedInMember(alex);

    app = await launchApp();

    expect(await app.readSignedInMember()).toEqual(alex);
  });

  it("isn't read once the session's token is forgotten", async () => {
    const app = await launchApp();
    await app.keepSessionToken("session-token");
    await app.keepSignedInMember(alex);

    await app.forgetSessionToken();

    expect(await app.readSignedInMember()).toBeNull();
  });

  it("is forgotten when asked", async () => {
    const app = await launchApp();
    await app.keepSessionToken("session-token");
    await app.keepSignedInMember(alex);

    await app.forgetSignedInMember();

    expect(await app.readSignedInMember()).toBeNull();
  });

  it.each([
    ["that isn't JSON", "not json"],
    ["without a name", JSON.stringify({ id: alex.id })],
  ])("is null when what's kept is %s", async (_, kept) => {
    const app = await launchApp();
    await app.keepSessionToken("session-token");
    keychain.set("signed-in-member", kept);

    expect(await app.readSignedInMember()).toBeNull();
  });
});

import { reset, runInDurableObject } from "cloudflare:test";
import { env, withEnv } from "cloudflare:workers";
import { newId } from "@foyer/shared";
import { afterEach, describe, expect, it } from "vitest";
import { type GoogleAccount, theHousehold } from "../src/household";
import { householdMigrations, migrate } from "../src/migrations";
import { localBackendUrl, member, requestBackend, signInWithGoogle } from "./backend";

type Space = {
  id: string;
  kind: "inbox" | "personal" | "shared";
  owner_id: string | null;
  name: string | null;
  created_by: string;
  created_at: number;
};

const alex: GoogleAccount = { subject: "1", email: "alex@example.com", name: "Alex" };
const sam: GoogleAccount = { subject: "2", email: "sam@example.com", name: "Sam" };

/** Lets an account into the household, with Alex and Sam on the allowlist, and returns its id. */
function join(account: GoogleAccount): Promise<string> {
  const allowlist = JSON.stringify([alex.email, sam.email]);
  return runInDurableObject(theHousehold(), (household) => {
    const joined = withEnv({ ...env, HOUSEHOLD_MEMBERS: allowlist }, () => household.join(account));
    if (!joined) throw new Error(`${account.email} wasn't let in`);
    return (joined as { id: string }).id;
  });
}

function spaces(): Promise<Space[]> {
  return runInDurableObject(theHousehold(), (_, { storage }) =>
    storage.sql.exec<Space>("SELECT * FROM spaces ORDER BY kind, id").toArray(),
  );
}

function spacesOf(memberId: string): Promise<Space[]> {
  return spaces().then((all) => all.filter((space) => space.owner_id === memberId));
}

function addSharedSpace(createdBy: string): Promise<string> {
  const id = newId();
  return runInDurableObject(theHousehold(), (_, { storage }) => {
    storage.sql.exec(
      "INSERT INTO spaces (id, kind, owner_id, name, created_by, created_at) VALUES (?, 'shared', NULL, 'Home', ?, ?)",
      id,
      createdBy,
      Date.now(),
    );
    return id;
  });
}

function spaceOf(memberId: string, kind: Space["kind"]): Promise<string> {
  return spacesOf(memberId).then((own) => own.find((space) => space.kind === kind)?.id ?? "");
}

afterEach(() => reset());

describe("joining the household", () => {
  it("gives a new member their Inbox and a personal space named Personal", async () => {
    const before = Date.now();
    const alexId = await join(alex);

    const own = await spacesOf(alexId);

    expect(own).toEqual([
      expect.objectContaining({ kind: "inbox", owner_id: alexId, name: null, created_by: alexId }),
      expect.objectContaining({
        kind: "personal",
        owner_id: alexId,
        name: "Personal",
        created_by: alexId,
      }),
    ]);
    for (const space of own) expect(space.created_at).toBeGreaterThanOrEqual(before);
    expect(new Set(own.map((space) => space.id)).size).toBe(2);
  });

  it("gives a member no more spaces when they sign in again", async () => {
    const alexId = await join(alex);
    await join(alex);

    expect(await spacesOf(alexId)).toHaveLength(2);
  });

  it("gives someone who signs in with Google their first spaces", async () => {
    await signInWithGoogle(member);

    expect((await spaces()).map((space) => [space.kind, space.name])).toEqual([
      ["inbox", null],
      ["personal", "Personal"],
    ]);
  });

  it("gives someone who signs in without Google their first spaces", async () => {
    await requestBackend(`${localBackendUrl}/auth/dev?email=${member.email}`);

    expect((await spaces()).map((space) => [space.kind, space.name])).toEqual([
      ["inbox", null],
      ["personal", "Personal"],
    ]);
  });

  it("gives each member one Inbox only", async () => {
    const alexId = await join(alex);

    const addingAnother = runInDurableObject(theHousehold(), (_, { storage }) => {
      storage.sql.exec(
        "INSERT INTO spaces (id, kind, owner_id, name, created_by, created_at) VALUES (?, 'inbox', ?, NULL, ?, ?)",
        newId(),
        alexId,
        alexId,
        Date.now(),
      );
    });

    await expect(addingAnother).rejects.toThrow();
  });
});

describe("who can see a space", () => {
  it("lets only its owner see an Inbox", async () => {
    const alexId = await join(alex);
    const samId = await join(sam);
    const inbox = await spaceOf(alexId, "inbox");

    expect(await theHousehold().canSee(alexId, inbox)).toBe(true);
    expect(await theHousehold().canSee(samId, inbox)).toBe(false);
  });

  it("lets only its owner see a personal space", async () => {
    const alexId = await join(alex);
    const samId = await join(sam);
    const personal = await spaceOf(alexId, "personal");

    expect(await theHousehold().canSee(alexId, personal)).toBe(true);
    expect(await theHousehold().canSee(samId, personal)).toBe(false);
  });

  it("lets every member see a shared space, including members who join after it was made", async () => {
    const alexId = await join(alex);
    const shared = await addSharedSpace(alexId);
    const samId = await join(sam);

    expect(await theHousehold().canSee(alexId, shared)).toBe(true);
    expect(await theHousehold().canSee(samId, shared)).toBe(true);
  });

  it("lets nobody see a space that doesn't exist, and lets someone who isn't a member see none", async () => {
    const alexId = await join(alex);
    const shared = await addSharedSpace(alexId);

    expect(await theHousehold().canSee(alexId, newId())).toBe(false);
    expect(await theHousehold().canSee(newId(), shared)).toBe(false);
  });
});

describe("storage from before spaces", () => {
  it("gives the members who had already joined their Inbox and a personal space named Personal", async () => {
    const alexId = newId();

    const given = await runInDurableObject(theHousehold(), (_, { storage }) => {
      const beforeSpaces = householdMigrations.slice(0, 2);
      storage.sql.exec("DROP TABLE spaces; DELETE FROM migrations WHERE number > 2");
      migrate(storage, beforeSpaces);
      storage.sql.exec(
        "INSERT INTO members (id, email, google_subject, name, joined_at) VALUES (?, ?, ?, ?, ?)",
        alexId,
        alex.email,
        alex.subject,
        alex.name,
        Date.now(),
      );

      migrate(storage, householdMigrations);
      return storage.sql.exec<Space>("SELECT * FROM spaces ORDER BY kind, id").toArray();
    });

    expect(given.map(({ kind, owner_id, name }) => ({ kind, owner_id, name }))).toEqual([
      { kind: "inbox", owner_id: alexId, name: null },
      { kind: "personal", owner_id: alexId, name: "Personal" },
    ]);
  });
});

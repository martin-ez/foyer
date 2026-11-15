import { evictDurableObject, reset, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { theHousehold } from "../src/household";
import { householdMigrations, migrate } from "../src/migrations";

type Member = {
  id: string;
  email: string;
  google_subject: string;
  name: string;
  joined_at: number;
};

const alex: Member = {
  id: "019a8f4e-5c00-7000-8000-000000000001",
  email: "alex@example.com",
  google_subject: "100000000000000000001",
  name: "Alex",
  joined_at: Date.UTC(2026, 10, 15),
};

function addMember(storage: DurableObjectStorage, member: Member) {
  storage.sql.exec(
    "INSERT INTO members (id, email, google_subject, name, joined_at) VALUES (?, ?, ?, ?, ?)",
    member.id,
    member.email,
    member.google_subject,
    member.name,
    member.joined_at,
  );
}

function members(storage: DurableObjectStorage): Member[] {
  return storage.sql.exec<Member>("SELECT * FROM members").toArray();
}

function hasTable(storage: DurableObjectStorage, name: string): boolean {
  return (
    storage.sql
      .exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", name)
      .toArray().length > 0
  );
}

afterEach(() => reset());

describe("the household", () => {
  it("is the Durable Object named household, wherever the Worker runs", () => {
    expect(theHousehold().id.equals(env.HOUSEHOLD.idFromName("household"))).toBe(true);
  });

  it("starts with no members, and stores what a member is", async () => {
    const stored = await runInDurableObject(theHousehold(), (_, state) => {
      const before = members(state.storage);
      addMember(state.storage, alex);
      return { before, after: members(state.storage) };
    });

    expect(stored.before).toEqual([]);
    expect(stored.after).toEqual([alex]);
  });

  it("holds one member for each Google account", async () => {
    const adding = runInDurableObject(theHousehold(), (_, state) => {
      addMember(state.storage, alex);
      addMember(state.storage, { ...alex, id: "019a8f4e-5c00-7000-8000-000000000002" });
    });

    await expect(adding).rejects.toThrow();
  });

  it("keeps its members when it starts again", async () => {
    const household = theHousehold();
    await runInDurableObject(household, (_, state) => addMember(state.storage, alex));

    await evictDurableObject(household);

    expect(await household.ping()).toBe("ok");
    expect(await runInDurableObject(household, (_, state) => members(state.storage))).toEqual([
      alex,
    ]);
  });
});

describe("storage migrations", () => {
  it("run the ones added later, once each", async () => {
    const later = [...householdMigrations, "CREATE TABLE later (value TEXT)"];

    const result = await runInDurableObject(theHousehold(), (_, state) => {
      migrate(state.storage, later);
      state.storage.sql.exec("INSERT INTO later (value) VALUES ('kept')");
      migrate(state.storage, later);
      return state.storage.sql.exec("SELECT value FROM later").toArray();
    });

    expect(result).toEqual([{ value: "kept" }]);
  });

  it("undo a migration that fails, and don't run the ones after it", async () => {
    const result = await runInDurableObject(theHousehold(), (_, { storage }) => {
      let failed = false;
      try {
        migrate(storage, [
          ...householdMigrations,
          "CREATE TABLE half (value TEXT); INSERT INTO missing VALUES (1)",
          "CREATE TABLE after (value TEXT)",
        ]);
      } catch {
        failed = true;
      }
      const left = { half: hasTable(storage, "half"), after: hasTable(storage, "after") };

      migrate(storage, [...householdMigrations, "CREATE TABLE half (value TEXT)"]);
      return { failed, left, fixedOneRuns: hasTable(storage, "half") };
    });

    expect(result).toEqual({
      failed: true,
      left: { half: false, after: false },
      fixedOneRuns: true,
    });
  });

  it("run the ones written as functions, and undo one that fails", async () => {
    const result = await runInDurableObject(theHousehold(), (_, { storage }) => {
      let failed = false;
      try {
        migrate(storage, [
          ...householdMigrations,
          (sql) => {
            sql.exec("CREATE TABLE half (value TEXT)");
            throw new Error("The migration failed");
          },
        ]);
      } catch {
        failed = true;
      }
      const left = hasTable(storage, "half");

      migrate(storage, [
        ...householdMigrations,
        (sql) => sql.exec("CREATE TABLE half (value TEXT)"),
      ]);
      return { failed, left, fixedOneRuns: hasTable(storage, "half") };
    });

    expect(result).toEqual({ failed: true, left: false, fixedOneRuns: true });
  });

  it("leave storage that ran newer migrations as it is", async () => {
    const stillHasMembers = await runInDurableObject(theHousehold(), (_, state) => {
      migrate(state.storage, []);
      return hasTable(state.storage, "members");
    });

    expect(stillHasMembers).toBe(true);
  });
});

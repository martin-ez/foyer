import { create } from "@bufbuild/protobuf";
import { timestampMs } from "@bufbuild/protobuf/wkt";
import { clashingName, freeSpaceName, isId, spaceNameProblem } from "@foyer/shared";
import { SpaceKind } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import {
  type Change,
  type ChangeResult,
  ChangeResultSchema,
  type Push,
} from "@foyer/shared/gen/foyer/sync/v1/sync_pb";
import { nextSeq, type RowKey } from "./rows";
import { namesSeenBy } from "./spaces";

/** What a push did: what became of each change, the rows it changed, and the rows that changes
 *  with no effect would have changed, which only the device that pushed them receives. */
export type PushOutcome = { results: ChangeResult[]; changed: RowKey[]; unchanged: RowKey[] };

/** Applies a member's changes in order, each on its own, and remembers what became of each by its
 *  id, so that a change sent again is answered the same way and has no further effect. A change
 *  that fails unexpectedly is refused without being remembered, so sending it again retries it. */
export function applyPush(
  storage: DurableObjectStorage,
  memberId: string,
  push: Push,
  now: number,
): PushOutcome {
  const outcome: PushOutcome = { results: [], changed: [], unchanged: [] };
  for (const change of push.changes) {
    const before = rememberedOutcome(storage.sql, change.changeId);
    if (before) {
      outcome.results.push(resultOf(change.changeId, before));
      continue;
    }
    try {
      const applied = storage.transactionSync(() => {
        const applied = apply(storage.sql, memberId, change, now);
        remember(storage.sql, change.changeId, memberId, applied, now);
        return applied;
      });
      outcome.results.push(resultOf(change.changeId, applied));
      if ("seq" in applied) {
        outcome.changed.push(...applied.changed);
        outcome.unchanged.push(...applied.unchanged);
      }
    } catch (error) {
      console.error(`Applying change ${change.changeId} failed: ${error}`);
      const refused = "Something went wrong while saving this change.";
      outcome.results.push(resultOf(change.changeId, { refused }));
    }
  }
  return outcome;
}

type Outcome = { seq: number } | { refused: string };

function resultOf(changeId: string, outcome: Outcome): ChangeResult {
  return create(ChangeResultSchema, {
    changeId,
    result:
      "refused" in outcome
        ? { case: "refused", value: { reason: outcome.refused } }
        : { case: "seq", value: BigInt(outcome.seq) },
  });
}

type Applied = { refused: string } | { seq: number; changed: RowKey[]; unchanged: RowKey[] };

type Setter = { at: number; changeId: string };

const creatableSpaceKinds: Partial<Record<SpaceKind, "personal" | "shared">> = {
  [SpaceKind.PERSONAL]: "personal",
  [SpaceKind.SHARED]: "shared",
};

function apply(sql: SqlStorage, memberId: string, change: Change, now: number): Applied {
  if (!isId(change.changeId)) return { refused: "A change's id must be a UUID version 7." };
  if (!change.at) return { refused: "A change must say when it was made." };
  const setter = { at: Math.min(timestampMs(change.at), now), changeId: change.changeId };

  switch (change.change.case) {
    case "spaceCreate":
      return createSpace(sql, memberId, setter, change.change.value);
    case "spaceRename":
      return renameSpace(sql, memberId, setter, change.change.value);
    default:
      return { refused: "The household doesn't know this kind of change." };
  }
}

function createSpace(
  sql: SqlStorage,
  memberId: string,
  setter: Setter,
  space: { spaceId: string; kind: SpaceKind; name: string },
): Applied {
  if (!isId(space.spaceId)) return { refused: "A space's id must be a UUID version 7." };
  const kind = creatableSpaceKinds[space.kind];
  if (!kind) return { refused: "Only personal and shared spaces can be created." };
  if (sql.exec("SELECT 1 FROM spaces WHERE id = ?", space.spaceId).toArray().length > 0) {
    return { refused: "A space with this id already exists." };
  }
  const name = space.name.trim();
  const problem = spaceNameProblem(name);
  if (problem) return { refused: problem };

  const seq = nextSeq(sql);
  sql.exec(
    `INSERT INTO spaces (id, kind, owner_id, name, created_by, created_at, seq, name_at, name_change_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    space.spaceId,
    kind,
    kind === "personal" ? memberId : null,
    freeSpaceName(name, namesSeenBy(sql, memberId)),
    memberId,
    setter.at,
    seq,
    setter.at,
    setter.changeId,
  );
  return { seq, changed: [{ kind: "space", id: space.spaceId }], unchanged: [] };
}

function renameSpace(
  sql: SqlStorage,
  memberId: string,
  setter: Setter,
  rename: { spaceId: string; name: string },
): Applied {
  const [space] = sql
    .exec<{ kind: string; name_at: number; name_change_id: string }>(
      "SELECT kind, name_at, name_change_id FROM spaces WHERE id = ? AND (owner_id IS NULL OR owner_id = ?)",
      rename.spaceId,
      memberId,
    )
    .toArray();
  if (!space) return { refused: "There's no such space." };
  if (space.kind === "inbox") return { refused: "The Inbox can't be renamed." };
  const name = rename.name.trim();
  const problem = spaceNameProblem(name);
  if (problem) return { refused: problem };

  const key: RowKey = { kind: "space", id: rename.spaceId };
  if (!isLater(setter, { at: space.name_at, changeId: space.name_change_id })) {
    return { seq: nextSeq(sql), changed: [], unchanged: [key] };
  }
  const clash = clashingName(name, namesSeenBy(sql, memberId, rename.spaceId));
  if (clash !== undefined) return { refused: `Another space you see is called “${clash}”.` };

  const seq = nextSeq(sql);
  sql.exec(
    "UPDATE spaces SET name = ?, name_at = ?, name_change_id = ?, seq = ? WHERE id = ?",
    name,
    setter.at,
    setter.changeId,
    seq,
    rename.spaceId,
  );
  return { seq, changed: [key], unchanged: [] };
}

function isLater(change: Setter, than: Setter): boolean {
  return change.at > than.at || (change.at === than.at && change.changeId > than.changeId);
}

function rememberedOutcome(sql: SqlStorage, changeId: string): Outcome | null {
  const [remembered] = sql
    .exec<{ seq: number | null; refused: string | null }>(
      "SELECT seq, refused FROM changes WHERE id = ?",
      changeId,
    )
    .toArray();
  if (!remembered) return null;
  return remembered.seq === null ? { refused: remembered.refused ?? "" } : { seq: remembered.seq };
}

function remember(
  sql: SqlStorage,
  changeId: string,
  memberId: string,
  applied: Applied,
  now: number,
): void {
  if (!isId(changeId)) return;
  sql.exec(
    "INSERT INTO changes (id, member_id, seq, refused, received_at) VALUES (?, ?, ?, ?, ?)",
    changeId,
    memberId,
    "seq" in applied ? applied.seq : null,
    "refused" in applied ? applied.refused : null,
    now,
  );
}

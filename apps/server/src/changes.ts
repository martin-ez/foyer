import { create } from "@bufbuild/protobuf";
import { timestampMs } from "@bufbuild/protobuf/wkt";
import { clashingName, freeSpaceName, isId, newId, spaceNameProblem } from "@foyer/shared";
import { SpaceKind } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import {
  type Change,
  type ChangeResult,
  ChangeResultSchema,
  type Push,
} from "@foyer/shared/gen/foyer/sync/v1/sync_pb";
import { itemsOfRows, settleCalendarStickers } from "./calendar-stickers";
import { tickTask, untickTask } from "./completions";
import { queueEventWrites } from "./event-sync";
import { setEventTime } from "./events";
import { createItem, deleteItem, moveItem, setItemField, setItemRepeat } from "./items";
import { setItemParent } from "./nesting";
import { createPage } from "./pages";
import { nextSeq, type RowKey } from "./rows";
import { namesSeenBy } from "./spaces";
import { moveSticker, placeSticker, removeSticker } from "./stickers";

/** What a push did: what became of each change, the rows it changed, and the rows that changes
 *  with no effect would have changed, which only the device that pushed them receives. */
export type PushOutcome = { results: ChangeResult[]; changed: RowKey[]; unchanged: RowKey[] };

/** Applies a member's changes in order, each on its own and remembered by its id, so that sending
 *  it again has no effect, unless it failed unexpectedly. Queues the events they change for Google,
 *  then keeps the calendar stickers of the items they changed on their days. */
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
        if ("seq" in applied) queueEventWrites(storage.sql, applied.changed);
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
  try {
    const items = itemsOfRows(storage.sql, outcome.changed);
    const setter = { at: now, changeId: newId() };
    outcome.changed.push(
      ...storage.transactionSync(() =>
        settleCalendarStickers(storage.sql, items, setter, memberId),
      ),
    );
  } catch (error) {
    console.error(`Keeping calendar stickers on their days failed: ${error}`);
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

/** What applying one change did: refused it, or committed it with its number, along with the rows
 *  it changed and the rows it would have changed if it had had an effect. */
export type Applied = { refused: string } | { seq: number; changed: RowKey[]; unchanged: RowKey[] };

/** Which change sets a value, and when it was made, by the device's clock but no later than the
 *  household's. */
export type Setter = { at: number; changeId: string };

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
    case "pageCreate":
      return createPage(sql, memberId, setter, change.change.value);
    case "itemCreate":
      return createItem(sql, memberId, setter, change.change.value);
    case "stickerPlace":
      return placeSticker(sql, memberId, setter, change.change.value);
    case "stickerMove":
      return moveSticker(sql, memberId, setter, change.change.value);
    case "stickerRemove":
      return removeSticker(sql, memberId, change.change.value);
    case "itemSetTitle": {
      const { itemId, title } = change.change.value;
      return setItemField(sql, memberId, setter, itemId, "title", title);
    }
    case "itemSetDescription": {
      const { itemId, description } = change.change.value;
      return setItemField(sql, memberId, setter, itemId, "description", description);
    }
    case "itemSetDate": {
      const { itemId, date } = change.change.value;
      return setItemField(sql, memberId, setter, itemId, "date", date);
    }
    case "itemMove":
      return moveItem(sql, memberId, setter, change.change.value);
    case "itemDelete":
      return deleteItem(sql, memberId, setter, change.change.value, now);
    case "taskTick":
      return tickTask(sql, memberId, setter, change.change.value);
    case "taskUntick":
      return untickTask(sql, memberId, setter, change.change.value);
    case "itemSetRepeat":
      return setItemRepeat(sql, memberId, setter, change.change.value);
    case "itemSetParent":
      return setItemParent(sql, memberId, setter, change.change.value);
    case "eventSetTime":
      return setEventTime(sql, memberId, setter, change.change.value);
    case "itemSetTime": {
      const { itemId, time } = change.change.value;
      return setItemField(sql, memberId, setter, itemId, "time", time);
    }
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

/** Whether a change was made after another, by the device's clock, with equal times settled by the
 *  larger change id. */
export function isLater(change: Setter, than: Setter): boolean {
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

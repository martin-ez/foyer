import { create } from "@bufbuild/protobuf";
import { timestampMs } from "@bufbuild/protobuf/wkt";
import { freeSpaceName, isId, nameClashProblem, newId, spaceNameProblem } from "@foyer/shared";
import { SpaceKind } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import {
  type Change,
  type ChangeResult,
  ChangeResultSchema,
  type Push,
} from "@foyer/shared/gen/foyer/sync/v1/sync_pb";
import { spaceIsArchived, touchesArchivedSpace } from "./archived";
import { itemsOfRows, settleCalendarStickers } from "./calendar-stickers";
import { tickTask, untickTask } from "./completions";
import { queueEventWrites, wakeWaitingWrites } from "./event-sync";
import { setEventTime } from "./events";
import { createItem, deleteItem, moveItem, setItemField, setItemRepeat } from "./items";
import { setItemParent } from "./nesting";
import { createPage } from "./pages";
import { nextSeq, type RowKey } from "./rows";
import { namesSeenBy, spacesSeenBy } from "./spaces";
import { moveSticker, placeSticker, removeSticker } from "./stickers";
import {
  createTextBlock,
  createTextGroup,
  deleteTextBlock,
  deleteTextGroup,
  editTextBlock,
  moveTextBlock,
  moveTextGroup,
  resizeTextGroup,
} from "./text";

/** What a push did: what became of each change, the rows it changed, and the rows that changes
 *  with no effect would have changed, which only the device that pushed them receives. */
export type PushOutcome = { results: ChangeResult[]; changed: RowKey[]; unchanged: RowKey[] };

/** Applies a member's changes in order, each action's all or none, remembering each by its id so
 *  that sending it again has no effect. Queues the events they change for Google, then keeps the
 *  calendar stickers of the items they changed on their days. */
export function applyPush(
  storage: DurableObjectStorage,
  memberId: string,
  push: Push,
  now: number,
): PushOutcome {
  const outcome: PushOutcome = { results: [], changed: [], unchanged: [] };
  for (const action of actionsOf(push.changes)) {
    const outcomes = applyAction(storage, memberId, action, now);
    for (const [index, change] of action.entries()) {
      const applied = outcomes[index] ?? { refused: unexpected };
      outcome.results.push(resultOf(change.changeId, applied));
      if ("seq" in applied) {
        outcome.changed.push(...applied.changed);
        outcome.unchanged.push(...applied.unchanged);
      }
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

const unexpected = "Something went wrong while saving this change.";

function actionsOf(changes: Change[]): Change[][] {
  const actions: Change[][] = [];
  for (const change of changes) {
    const last = actions.at(-1);
    if (change.actionId !== "" && last?.[0]?.actionId === change.actionId) last.push(change);
    else actions.push([change]);
  }
  return actions;
}

class ActionRefused extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

function applyAction(
  storage: DurableObjectStorage,
  memberId: string,
  changes: Change[],
  now: number,
): Applied[] {
  const actionId = changes[0]?.actionId ?? "";
  const problem =
    actionId === "" || isId(actionId) ? null : "An action's id must be a UUID version 7.";
  let refused: { refused: string };
  try {
    return storage.transactionSync(() =>
      changes.map((change) => {
        const before = rememberedOutcome(storage.sql, change.changeId);
        if (before && "refused" in before) throw new ActionRefused(before.refused);
        if (before) return answerAgain(before);
        const applied = problem ? { refused: problem } : apply(storage.sql, memberId, change, now);
        if ("refused" in applied) throw new ActionRefused(applied.refused);
        remember(storage.sql, change.changeId, memberId, applied, now);
        queueEventWrites(storage.sql, applied.changed);
        return applied;
      }),
    );
  } catch (error) {
    if (!(error instanceof ActionRefused)) return failed(changes, error);
    refused = { refused: error.reason };
  }
  try {
    return storage.transactionSync(() =>
      changes.map((change) => {
        const before = rememberedOutcome(storage.sql, change.changeId);
        if (before) return answerAgain(before);
        remember(storage.sql, change.changeId, memberId, refused, now);
        return refused;
      }),
    );
  } catch (error) {
    return failed(changes, error);
  }
}

function failed(changes: Change[], error: unknown): Applied[] {
  const ids = changes.map(({ changeId }) => changeId).join(", ");
  console.error(`Applying changes ${ids} failed: ${error}`);
  return changes.map(() => ({ refused: unexpected }));
}

function answerAgain(before: Outcome): Applied {
  return "seq" in before ? { ...before, changed: [], unchanged: [] } : before;
}

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
  if (touchesArchivedSpace(sql, memberId, change.change)) return { refused: spaceIsArchived };

  switch (change.change.case) {
    case "spaceCreate":
      return createSpace(sql, memberId, setter, change.change.value);
    case "spaceRename":
      return renameSpace(sql, memberId, setter, change.change.value);
    case "spaceSetArchived":
      return setSpaceArchived(sql, memberId, setter, change.change.value);
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
    case "textGroupCreate":
      return createTextGroup(sql, memberId, setter, change.change.value);
    case "textGroupMove":
      return moveTextGroup(sql, memberId, setter, change.change.value);
    case "textGroupResize":
      return resizeTextGroup(sql, memberId, setter, change.change.value);
    case "textGroupDelete":
      return deleteTextGroup(sql, memberId, change.change.value);
    case "textBlockCreate":
      return createTextBlock(sql, memberId, setter, change.change.value);
    case "textBlockEdit":
      return editTextBlock(sql, memberId, setter, change.change.value);
    case "textBlockDelete":
      return deleteTextBlock(sql, memberId, change.change.value);
    case "textBlockMove":
      return moveTextBlock(sql, memberId, setter, change.change.value);
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
  const clash = nameClashProblem(name, spacesSeenBy(sql, memberId, rename.spaceId));
  if (clash) return { refused: clash };

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

function setSpaceArchived(
  sql: SqlStorage,
  memberId: string,
  setter: Setter,
  change: { spaceId: string; archived: boolean },
): Applied {
  const [space] = sql
    .exec<{ kind: string; archived_at: number; archived_change_id: string }>(
      `SELECT kind, archived_at, archived_change_id FROM spaces
       WHERE id = ? AND (owner_id IS NULL OR owner_id = ?)`,
      change.spaceId,
      memberId,
    )
    .toArray();
  if (!space) return { refused: "There's no such space." };
  if (space.kind === "inbox") return { refused: "The Inbox can't be archived." };

  const key: RowKey = { kind: "space", id: change.spaceId };
  if (!isLater(setter, { at: space.archived_at, changeId: space.archived_change_id })) {
    return { seq: nextSeq(sql), changed: [], unchanged: [key] };
  }
  const seq = nextSeq(sql);
  sql.exec(
    `UPDATE spaces SET archived = ?, archived_at = ?, archived_change_id = ?, seq = ?
     WHERE id = ?`,
    change.archived ? 1 : 0,
    setter.at,
    setter.changeId,
    seq,
    change.spaceId,
  );
  if (!change.archived) wakeWaitingWrites(sql);
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

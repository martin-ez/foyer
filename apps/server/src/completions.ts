import { isId } from "@foyer/shared";
import type { TaskTick, TaskUntick } from "@foyer/shared/gen/foyer/task/v1/task_pb";
import { type Applied, isLater, type Setter } from "./changes";
import { itemFor } from "./items";
import { nextSeq, type RowKey } from "./rows";

/** Ticks a task the member sees, adding a completion for the occurrence, unless it already has one
 *  or an untick of it was made later. Ticking a deleted task has no effect. */
export function tickTask(
  sql: SqlStorage,
  memberId: string,
  setter: Setter,
  tick: TaskTick,
): Applied {
  if (!isId(tick.completionId)) return { refused: "A completion's id must be a UUID version 7." };
  const found = taskFor(sql, memberId, tick.itemId, tick.occurrence);
  if ("applied" in found) return found.applied;
  if (completionExisted(sql, tick.completionId)) {
    return { refused: "A completion with this id already exists." };
  }

  const { won, completion } = settle(sql, tick.itemId, tick.occurrence, setter);
  if (!won || completion) {
    return { seq: nextSeq(sql), changed: [], unchanged: completion ? [completion] : [] };
  }
  const seq = nextSeq(sql);
  sql.exec(
    `INSERT INTO completions (id, item_id, occurrence, done_at, done_by, seq)
     VALUES (?, ?, ?, ?, ?, ?)`,
    tick.completionId,
    tick.itemId,
    tick.occurrence,
    setter.at,
    memberId,
    seq,
  );
  return { seq, changed: [{ kind: "completion", id: tick.completionId }], unchanged: [] };
}

/** Unticks a task the member sees, removing the occurrence's completion and leaving a tombstone,
 *  unless a tick of it was made later. Whoever ticked it, anyone who sees the task can untick it.
 *  Unticking a deleted task has no effect. */
export function untickTask(
  sql: SqlStorage,
  memberId: string,
  setter: Setter,
  untick: TaskUntick,
): Applied {
  const found = taskFor(sql, memberId, untick.itemId, untick.occurrence);
  if ("applied" in found) return found.applied;

  const { won, completion } = settle(sql, untick.itemId, untick.occurrence, setter);
  if (!won || !completion) {
    return { seq: nextSeq(sql), changed: [], unchanged: completion ? [completion] : [] };
  }
  const seq = nextSeq(sql);
  sql.exec("DELETE FROM completions WHERE id = ?", completion.id);
  sql.exec(
    "INSERT INTO tombstones (kind, id, visible_to, seq) VALUES ('completion', ?, ?, ?)",
    completion.id,
    found.ownerId,
    seq,
  );
  return { seq, changed: [completion], unchanged: [] };
}

function taskFor(
  sql: SqlStorage,
  memberId: string,
  itemId: string,
  occurrence: string,
): { ownerId: string | null } | { applied: Applied } {
  if (occurrence !== "") {
    return { applied: { refused: "Tasks don't repeat yet, so they have no occurrences." } };
  }
  const found = itemFor(sql, memberId, itemId);
  if ("applied" in found) return found;
  if (found.item.kind !== "task") return { applied: { refused: "Only tasks can be ticked." } };
  return { ownerId: found.item.owner_id };
}

function settle(
  sql: SqlStorage,
  itemId: string,
  occurrence: string,
  setter: Setter,
): { won: boolean; completion: RowKey | null } {
  const [completion] = sql
    .exec<{ id: string }>(
      "SELECT id FROM completions WHERE item_id = ? AND occurrence = ?",
      itemId,
      occurrence,
    )
    .toArray();
  const [last] = sql
    .exec<{ at: number; change_id: string }>(
      "SELECT at, change_id FROM last_ticks WHERE item_id = ? AND occurrence = ?",
      itemId,
      occurrence,
    )
    .toArray();
  const won = !last || isLater(setter, { at: last.at, changeId: last.change_id });
  if (won) {
    sql.exec(
      `INSERT INTO last_ticks (item_id, occurrence, at, change_id) VALUES (?, ?, ?, ?)
       ON CONFLICT (item_id, occurrence) DO UPDATE SET at = excluded.at, change_id = excluded.change_id`,
      itemId,
      occurrence,
      setter.at,
      setter.changeId,
    );
  }
  return { won, completion: completion ? { kind: "completion", id: completion.id } : null };
}

function completionExisted(sql: SqlStorage, completionId: string): boolean {
  return (
    sql
      .exec(
        `SELECT 1 FROM completions WHERE id = ?
         UNION ALL SELECT 1 FROM tombstones WHERE kind = 'completion' AND id = ?`,
        completionId,
        completionId,
      )
      .toArray().length > 0
  );
}

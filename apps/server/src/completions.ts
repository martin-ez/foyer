import { isId, isIsoDate } from "@foyer/shared";
import type { TaskTick, TaskUntick } from "@foyer/shared/gen/foyer/task/v1/task_pb";
import { type Applied, isLater, type Setter } from "./changes";
import { itemFor } from "./items";
import { nextSeq, type RowKey } from "./rows";

/** Ticks a task the member sees, adding a completion for the occurrence unless it has one or a
 *  later untick won. A repeating task's tick names its occurrence and next date, which the task
 *  moves to unless a later change to its date won. Ticking a deleted task has no effect. */
export function tickTask(
  sql: SqlStorage,
  memberId: string,
  setter: Setter,
  tick: TaskTick,
): Applied {
  if (!isId(tick.completionId)) return { refused: "A completion's id must be a UUID version 7." };
  const found = taskFor(sql, memberId, tick.itemId);
  if ("applied" in found) return found.applied;
  const { task } = found;
  const repeats = task.repeat !== null;
  if (repeats && (!isIsoDate(tick.occurrence) || !isIsoDate(tick.nextDate))) {
    return { refused: "This task repeats, so a tick must name its occurrence and next date." };
  }
  if (repeats && tick.nextDate === tick.occurrence) {
    return { refused: "A repeating task's next date can't be the occurrence ticked." };
  }
  if (!repeats && (tick.occurrence !== "" || tick.nextDate !== "")) {
    return { refused: "This task doesn't repeat, so a tick can't name an occurrence." };
  }
  if (completionExisted(sql, tick.completionId)) {
    return { refused: "A completion with this id already exists." };
  }

  const item: RowKey = { kind: "item", id: tick.itemId };
  const { won, completion } = settle(sql, tick.itemId, tick.occurrence, setter);
  if (!won || completion) {
    const unchanged = [...(completion ? [completion] : []), ...(repeats ? [item] : [])];
    return { seq: nextSeq(sql), changed: [], unchanged };
  }
  const seq = nextSeq(sql);
  sql.exec(
    `INSERT INTO completions (id, item_id, occurrence, done_at, done_by, seq, tick_change_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    tick.completionId,
    tick.itemId,
    tick.occurrence,
    setter.at,
    memberId,
    seq,
    setter.changeId,
  );
  const changed: RowKey[] = [{ kind: "completion", id: tick.completionId }];
  if (!repeats) return { seq, changed, unchanged: [] };
  const dateSetter = { at: task.date_at, changeId: task.date_change_id };
  if (!isLater(setter, dateSetter)) return { seq, changed, unchanged: [item] };
  setDate(sql, tick.itemId, tick.nextDate, setter, seq);
  return { seq, changed: [...changed, item], unchanged: [] };
}

/** Unticks a task the member sees, whoever ticked it, removing the occurrence's completion unless
 *  a later tick won. A task goes back to the occurrence if the tick moved it and nothing changed
 *  its date since. Unticking a deleted task has no effect. */
export function untickTask(
  sql: SqlStorage,
  memberId: string,
  setter: Setter,
  untick: TaskUntick,
): Applied {
  if (untick.occurrence !== "" && !isIsoDate(untick.occurrence)) {
    return { refused: "An occurrence is a day, as in “2026-11-17”." };
  }
  const found = taskFor(sql, memberId, untick.itemId);
  if ("applied" in found) return found.applied;
  const { task } = found;

  const { won, completion } = settle(sql, untick.itemId, untick.occurrence, setter);
  if (!won || !completion) {
    return { seq: nextSeq(sql), changed: [], unchanged: completion ? [completion] : [] };
  }
  const [{ tick_change_id: tickChangeId } = { tick_change_id: null }] = sql
    .exec<{ tick_change_id: string | null }>(
      "SELECT tick_change_id FROM completions WHERE id = ?",
      completion.id,
    )
    .toArray();
  const seq = nextSeq(sql);
  sql.exec("DELETE FROM completions WHERE id = ?", completion.id);
  sql.exec(
    "INSERT INTO tombstones (kind, id, visible_to, seq) VALUES ('completion', ?, ?, ?)",
    completion.id,
    task.owner_id,
    seq,
  );
  const dateSetter = { at: task.date_at, changeId: task.date_change_id };
  const movedByTick = tickChangeId !== null && task.date_change_id === tickChangeId;
  if (untick.occurrence === "" || !movedByTick || !isLater(setter, dateSetter)) {
    return { seq, changed: [completion], unchanged: [] };
  }
  setDate(sql, untick.itemId, untick.occurrence, setter, seq);
  return { seq, changed: [completion, { kind: "item", id: untick.itemId }], unchanged: [] };
}

type Task = {
  owner_id: string | null;
  repeat: string | null;
  date_at: number;
  date_change_id: string;
};

function taskFor(
  sql: SqlStorage,
  memberId: string,
  itemId: string,
): { task: Task } | { applied: Applied } {
  const found = itemFor(sql, memberId, itemId);
  if ("applied" in found) return found;
  if (found.item.kind !== "task") return { applied: { refused: "Only tasks can be ticked." } };
  return { task: found.item };
}

function setDate(sql: SqlStorage, itemId: string, date: string, setter: Setter, seq: number) {
  sql.exec(
    "UPDATE items SET date = ?, date_at = ?, date_change_id = ?, seq = ? WHERE id = ?",
    date,
    setter.at,
    setter.changeId,
    seq,
    itemId,
  );
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

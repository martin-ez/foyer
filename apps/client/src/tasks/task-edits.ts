import type { Item } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import { type RepeatChoice, repeatOf, sameRepeat } from "./repeats";

/** A task's fields that people edit as text. */
export type TaskFields = Pick<Item, "title" | "description" | "date" | "time">;

/** What a member has changed in a task's fields since opening it, and how they chose to repeat
 *  it. A field they haven't touched is missing, so it can follow changes made elsewhere. */
export type TaskEdits = Partial<TaskFields> & { repeat?: RepeatChoice };

/** The fields as an editor shows them: what the member typed, or else the task as it is now. A
 *  task without a date shows no time, as clearing its date clears its time. */
export function shownFields(task: TaskFields, edits: TaskEdits): TaskFields {
  const date = edits.date ?? task.date;
  return {
    title: edits.title ?? task.title,
    description: edits.description ?? task.description,
    date,
    time: date === "" ? "" : (edits.time ?? task.time),
  };
}

/** How the editor shows the task repeating: as the member chose, or else as it repeats now. */
export function shownRepeat(task: Pick<Item, "repeat" | "repeatFrom">, edits: TaskEdits) {
  return edits.repeat ?? repeatOf(task);
}

/** The fields to save: those the member edited that differ from the task as it is now, with the
 *  title trimmed. Fields they didn't touch are left out, so saving never undoes someone else's
 *  change to them. A time is left out when the date is cleared, which clears it. */
export function changedFields(
  task: TaskFields & Pick<Item, "repeat" | "repeatFrom">,
  edits: TaskEdits,
): TaskEdits {
  const changed: TaskEdits = {};
  const title = edits.title?.trim();
  if (title !== undefined && title !== task.title) changed.title = title;
  if (edits.description !== undefined && edits.description !== task.description) {
    changed.description = edits.description;
  }
  if (edits.date !== undefined && edits.date !== task.date) changed.date = edits.date;
  const { time } = shownFields(task, edits);
  if (edits.time !== undefined && time !== task.time && changed.date !== "") changed.time = time;
  if (edits.repeat !== undefined && !sameRepeat(edits.repeat, repeatOf(task))) {
    changed.repeat = edits.repeat;
  }
  return changed;
}

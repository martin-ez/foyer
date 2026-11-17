import type { Item } from "@foyer/shared/gen/foyer/item/v1/item_pb";

/** A task's fields that people edit as text. */
export type TaskFields = Pick<Item, "title" | "description" | "date">;

/** What a member has typed into a task's fields since opening it. A field they haven't touched is
 *  missing, so it can follow changes made elsewhere. */
export type TaskEdits = Partial<TaskFields>;

/** The fields as an editor shows them: what the member typed, or else the task as it is now. */
export function shownFields(task: TaskFields, edits: TaskEdits): TaskFields {
  return {
    title: edits.title ?? task.title,
    description: edits.description ?? task.description,
    date: edits.date ?? task.date,
  };
}

/** The fields to save: those the member edited that differ from the task as it is now, with the
 *  title trimmed. Fields they didn't touch are left out, so saving never undoes someone else's
 *  change to them. */
export function changedFields(task: TaskFields, edits: TaskEdits): TaskEdits {
  const changed: TaskEdits = {};
  const title = edits.title?.trim();
  if (title !== undefined && title !== task.title) changed.title = title;
  if (edits.description !== undefined && edits.description !== task.description) {
    changed.description = edits.description;
  }
  if (edits.date !== undefined && edits.date !== task.date) changed.date = edits.date;
  return changed;
}

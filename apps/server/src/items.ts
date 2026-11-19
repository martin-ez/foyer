import {
  type EventTime,
  eventTimeFields,
  formatRepeat,
  isId,
  isIsoDate,
  isTimeOfDay,
  itemDescriptionProblem,
  itemTitleProblem,
  parseRepeat,
  type RepeatFrom as RepeatFromName,
} from "@foyer/shared";
import {
  type ItemCreate,
  type ItemDelete,
  ItemKind,
  type ItemMove,
  type ItemSetRepeat,
  RepeatFrom,
} from "@foyer/shared/gen/foyer/item/v1/item_pb";
import { type Applied, isLater, type Setter } from "./changes";
import {
  calendarTimeZone,
  eventNeedsCalendar,
  eventsCanMoveTo,
  eventTimeIn,
  redateEvents,
} from "./events";
import { joinPageSpace, nextSeq, type RowKey } from "./rows";
import { canSee } from "./spaces";

const badDate = "A task's date must be a day, as in “2026-11-17”.";
const badTime = "A task's time must be hours and minutes, as in “19:00”.";

/** What an item is, as the household stores it. */
export type ItemKindName = "task" | "event" | "note";

/** Creates a task or an event in a space the member sees, with a trimmed title that isn't blank or
 *  too long, keeping the change that set each field. A task's date is a day or empty. An event
 *  needs a time it can happen at and a space with a Google calendar, whose time zone dates it. */
export function createItem(
  sql: SqlStorage,
  memberId: string,
  setter: Setter,
  item: ItemCreate,
): Applied {
  if (!isId(item.itemId)) return { refused: "An item's id must be a UUID version 7." };
  if (item.kind !== ItemKind.TASK && item.kind !== ItemKind.EVENT) {
    return { refused: "Only tasks and events can be created for now." };
  }
  if (itemExisted(sql, item.itemId)) return { refused: "An item with this id already exists." };
  if (!canSee(sql, memberId, item.spaceId)) return { refused: "There's no such space." };
  const title = item.title.trim();
  const problem = itemTitleProblem(title) ?? itemDescriptionProblem(item.description);
  if (problem) return { refused: problem };
  const event = item.kind === ItemKind.EVENT;
  const time = event ? eventTimeIn(item) : null;
  if (time && "problem" in time) return { refused: time.problem };
  if (!event && (item.startsOn || item.endsOn || item.startsAt || item.endsAt)) {
    return { refused: "Only events have a time." };
  }
  if (event && item.date !== "") return { refused: eventDateIsSet };
  if (event && calendarTimeZone(sql, item.spaceId) === null) return { refused: eventNeedsCalendar };
  if (item.date !== "" && !isIsoDate(item.date)) return { refused: badDate };

  const seq = nextSeq(sql);
  insertItem(sql, {
    itemId: item.itemId,
    kind: event ? "event" : "task",
    spaceId: item.spaceId,
    title,
    description: item.description,
    date: item.date === "" ? null : item.date,
    time,
    createdBy: memberId,
    createdAt: setter.at,
    setter,
    seq,
  });
  return { seq, changed: [{ kind: "item", id: item.itemId }], unchanged: [] };
}

/** Adds an item to the household's storage, as change `seq` made by `setter`, which every field it
 *  sets keeps. An event's date is the day it starts in its space's calendar's time zone. */
export function insertItem(
  sql: SqlStorage,
  item: {
    itemId: string;
    kind: ItemKindName;
    spaceId: string;
    title: string;
    description: string;
    date: string | null;
    time: EventTime | null;
    createdBy: string | null;
    createdAt: number;
    setter: Setter;
    seq: number;
  },
): void {
  const { at, changeId } = item.setter;
  const time = item.time ? eventTimeFields(item.time) : null;
  sql.exec(
    `INSERT INTO items (id, kind, space_id, title, description, date, created_by, created_at, seq,
       space_at, space_change_id, title_at, title_change_id, description_at, description_change_id,
       date_at, date_change_id, starts_on, ends_on, starts_at, ends_at, time_at, time_change_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    item.itemId,
    item.kind,
    item.spaceId,
    item.title,
    item.description,
    item.date,
    item.createdBy,
    item.createdAt,
    item.seq,
    ...[at, changeId, at, changeId, at, changeId, at, changeId],
    time ? time.startsOn || null : null,
    time ? time.endsOn || null : null,
    time?.startsAt ?? null,
    time?.endsAt ?? null,
    time ? at : 0,
    time ? changeId : "",
  );
  if (time) redateEvents(sql, [item.itemId], item.setter, item.seq);
}

const eventDateIsSet = "An event's date is the day it starts, which the household sets.";

/** An item that exists, with the space it lives in and the item it's under, or null. */
export function findItem(
  sql: SqlStorage,
  itemId: string,
): { kind: ItemKindName; spaceId: string; parentId: string | null } | null {
  const [item] = sql
    .exec<{ kind: ItemKindName; space_id: string; parent_id: string | null }>(
      "SELECT kind, space_id, parent_id FROM items WHERE id = ?",
      itemId,
    )
    .toArray();
  return item ? { kind: item.kind, spaceId: item.space_id, parentId: item.parent_id } : null;
}

/** The ids of the items under an item, at any depth. */
export function itemsUnder(sql: SqlStorage, itemId: string): string[] {
  return sql
    .exec<{ id: string }>(
      `WITH RECURSIVE under (id) AS (
         SELECT id FROM items WHERE parent_id = ?
         UNION SELECT items.id FROM items JOIN under ON items.parent_id = under.id
       )
       SELECT id FROM under`,
      itemId,
    )
    .toArray()
    .map(({ id }) => id);
}

function itemExisted(sql: SqlStorage, itemId: string): boolean {
  return (
    sql
      .exec(
        "SELECT 1 FROM items WHERE id = ? UNION ALL SELECT 1 FROM tombstones WHERE kind = 'item' AND id = ?",
        itemId,
        itemId,
      )
      .toArray().length > 0
  );
}

type ItemRow = {
  kind: ItemKindName;
  space_id: string;
  owner_id: string | null;
  parent_id: string | null;
  parent_at: number;
  parent_change_id: string;
  date: string | null;
  time: string | null;
  repeat: string | null;
  repeat_at: number;
  repeat_change_id: string;
  space_at: number;
  space_change_id: string;
  title_at: number;
  title_change_id: string;
  description_at: number;
  description_change_id: string;
  date_at: number;
  date_change_id: string;
  time_at: number;
  time_change_id: string;
};

type Field = "title" | "description" | "date" | "time";

/** Changes an item's title, description or date, or a task's time of day, unless a later change to
 *  the same field won. A title is trimmed and must not be blank or too long, a description must not
 *  be too long, a date must be a day, and a time hours and minutes, or empty, which clears them.
 *  Only a task with a date can have a time, and clearing its date clears its time. Changing a
 *  deleted item has no effect. */
export function setItemField(
  sql: SqlStorage,
  memberId: string,
  setter: Setter,
  itemId: string,
  field: Field,
  value: string,
): Applied {
  const checked = checkField(field, value);
  if ("refused" in checked) return checked;
  const found = itemFor(sql, memberId, itemId);
  if (!("item" in found)) return found.applied;
  if (field === "date" && found.item.kind === "event") return { refused: eventDateIsSet };
  if (field === "time" && found.item.kind !== "task") {
    return { refused: "Only tasks have a time of day." };
  }

  const key: RowKey = { kind: "item", id: itemId };
  const last = { at: found.item[`${field}_at`], changeId: found.item[`${field}_change_id`] };
  if (!isLater(setter, last)) return { seq: nextSeq(sql), changed: [], unchanged: [key] };
  if (field === "date" && checked.value === null && found.item.repeat !== null) {
    return { refused: "A repeating task always has a date. Stop it repeating first." };
  }
  if (field === "time" && checked.value !== null && found.item.date === null) {
    return { refused: "A task needs a date to have a time." };
  }
  const seq = nextSeq(sql);
  sql.exec(
    `UPDATE items SET ${field} = ?, ${field}_at = ?, ${field}_change_id = ?, seq = ? WHERE id = ?`,
    checked.value,
    setter.at,
    setter.changeId,
    seq,
    itemId,
  );
  if (field === "date" && checked.value === null && found.item.time !== null) {
    clearTime(sql, itemId, setter, { at: found.item.time_at, changeId: found.item.time_change_id });
  }
  return { seq, changed: [key], unchanged: [] };
}

/** Clears a task's time, as its date was cleared by `setter`, which becomes the change that last set
 *  the time unless a later one did, so that an earlier time sent afterwards has no effect. */
function clearTime(sql: SqlStorage, itemId: string, setter: Setter, last: Setter): void {
  const by = isLater(setter, last) ? setter : last;
  sql.exec(
    "UPDATE items SET time = NULL, time_at = ?, time_change_id = ? WHERE id = ?",
    by.at,
    by.changeId,
    itemId,
  );
}

const repeatFromNames: Partial<Record<RepeatFrom, RepeatFromName>> = {
  [RepeatFrom.SCHEDULE]: "schedule",
  [RepeatFrom.COMPLETION]: "completion",
};

/** Sets the rule a task repeats by, as `formatRepeat` writes it, and where its next date comes
 *  from, or stops it repeating when the rule is empty, unless a later change to its rule won. A
 *  task needs a date to repeat. Changing a deleted item has no effect. */
export function setItemRepeat(
  sql: SqlStorage,
  memberId: string,
  setter: Setter,
  change: ItemSetRepeat,
): Applied {
  let repeat: { rule: string; from: RepeatFromName } | null = null;
  if (change.repeat !== "") {
    const rule = parseRepeat(change.repeat);
    if (!rule) return { refused: "Foyer can't repeat a task by this rule." };
    const from = repeatFromNames[change.repeatFrom];
    if (!from) return { refused: "A repeating task must say where its next date comes from." };
    repeat = { rule: formatRepeat(rule), from };
  }
  const found = itemFor(sql, memberId, change.itemId);
  if (!("item" in found)) return found.applied;
  if (found.item.kind !== "task") return { refused: "Only tasks can repeat." };

  const key: RowKey = { kind: "item", id: change.itemId };
  const last = { at: found.item.repeat_at, changeId: found.item.repeat_change_id };
  if (!isLater(setter, last)) return { seq: nextSeq(sql), changed: [], unchanged: [key] };
  if (repeat && found.item.date === null) return { refused: "A task needs a date to repeat." };
  const seq = nextSeq(sql);
  sql.exec(
    `UPDATE items SET repeat = ?, repeat_from = ?, repeat_at = ?, repeat_change_id = ?, seq = ?
     WHERE id = ?`,
    repeat?.rule ?? null,
    repeat?.from ?? null,
    setter.at,
    setter.changeId,
    seq,
    change.itemId,
  );
  return { seq, changed: [key], unchanged: [] };
}

/** Moves an item at the top of its space to another space the member sees, unless a later move
 *  won, with everything under it. An item under another moves with it, so it's refused. Moving a
 *  deleted item has no effect. */
export function moveItem(
  sql: SqlStorage,
  memberId: string,
  setter: Setter,
  move: ItemMove,
): Applied {
  const found = itemFor(sql, memberId, move.itemId);
  if (!("item" in found)) return found.applied;
  if (!canSee(sql, memberId, move.spaceId)) return { refused: "There's no such space." };
  if (found.item.parent_id !== null) {
    return { refused: "An item under another moves with it. Take it out first." };
  }
  const moving = [move.itemId, ...itemsUnder(sql, move.itemId)];
  if (!eventsCanMoveTo(sql, moving, move.spaceId)) return { refused: eventNeedsCalendar };

  const key: RowKey = { kind: "item", id: move.itemId };
  const last = { at: found.item.space_at, changeId: found.item.space_change_id };
  if (!isLater(setter, last)) return { seq: nextSeq(sql), changed: [], unchanged: [key] };
  const seq = nextSeq(sql);
  const moved = moveIntoSpace(sql, move.itemId, found.item.owner_id, move.spaceId, setter, seq);
  return { seq, changed: moved, unchanged: [] };
}

/** Moves an item and everything under it into a space, with their completions, body pages and
 *  what's on them, as change `seq` made by `setter`, dating events by the space's calendar. Members
 *  who can't see the space are told to drop them, and those who see them again receive them. */
export function moveIntoSpace(
  sql: SqlStorage,
  itemId: string,
  ownerBefore: string | null,
  spaceId: string,
  setter: Setter,
  seq: number,
): RowKey[] {
  const [space] = sql
    .exec<{ owner_id: string | null }>("SELECT owner_id FROM spaces WHERE id = ?", spaceId)
    .toArray();
  const ownerAfter = space?.owner_id ?? null;
  const items = [itemId, ...itemsUnder(sql, itemId)];
  for (const id of items) {
    sql.exec(
      "UPDATE items SET space_id = ?, space_at = ?, space_change_id = ?, seq = ? WHERE id = ?",
      spaceId,
      setter.at,
      setter.changeId,
      seq,
      id,
    );
    sql.exec("UPDATE completions SET seq = ? WHERE item_id = ?", seq, id);
    sql.exec("UPDATE pages SET seq = ? WHERE item_id = ?", seq, id);
    sql.exec(
      "UPDATE stickers SET seq = ? WHERE page_id IN (SELECT id FROM pages WHERE item_id = ?)",
      seq,
      id,
    );
  }
  redateEvents(sql, items, setter, seq);

  const losing =
    ownerAfter === null || ownerBefore === ownerAfter
      ? []
      : ownerBefore === null
        ? sql
            .exec<{ id: string }>("SELECT id FROM members WHERE id != ?", ownerAfter)
            .toArray()
            .map(({ id }) => id)
        : [ownerBefore];
  const moved = items.flatMap((id): RowKey[] => [{ kind: "item", id }, ...carriedBy(sql, id)]);
  for (const row of moved) {
    if (ownerAfter === null) {
      sql.exec("DELETE FROM hidden_rows WHERE kind = ? AND id = ?", row.kind, row.id);
    } else {
      sql.exec(
        "DELETE FROM hidden_rows WHERE kind = ? AND id = ? AND member_id = ?",
        row.kind,
        row.id,
        ownerAfter,
      );
    }
    for (const member of losing) {
      sql.exec(
        `INSERT INTO hidden_rows (kind, id, member_id, seq) VALUES (?, ?, ?, ?)
         ON CONFLICT (kind, id, member_id) DO UPDATE SET seq = excluded.seq`,
        row.kind,
        row.id,
        member,
        seq,
      );
    }
  }
  return moved;
}

/** Deletes an item, its stickers on every page, its completions, and its body page with what's
 *  on it, leaving tombstones that the members who saw them receive. Items still under it move up
 *  to its parent, or to the top of its space. Deleting it again has no effect. */
export function deleteItem(
  sql: SqlStorage,
  memberId: string,
  setter: Setter,
  remove: ItemDelete,
): Applied {
  const found = itemFor(sql, memberId, remove.itemId);
  if (!("item" in found)) return found.applied;
  return deleteFound(sql, remove.itemId, found.item, setter);
}

/** Deletes an item as `deleteItem` does, for the household itself rather than a member, as when
 *  it was deleted in Google Calendar. Does nothing to an item that doesn't exist. */
export function deleteItemForHousehold(sql: SqlStorage, itemId: string, setter: Setter): RowKey[] {
  const [item] = sql
    .exec<Pick<ItemRow, "owner_id" | "parent_id">>(
      `SELECT spaces.owner_id, items.parent_id
       FROM items JOIN spaces ON spaces.id = items.space_id WHERE items.id = ?`,
      itemId,
    )
    .toArray();
  if (!item) return [];
  const applied = deleteFound(sql, itemId, item, setter);
  return "changed" in applied ? applied.changed : [];
}

function deleteFound(
  sql: SqlStorage,
  itemId: string,
  item: Pick<ItemRow, "owner_id" | "parent_id">,
  setter: Setter,
): Applied {
  const remove = { itemId };
  const found = { item };
  const seq = nextSeq(sql);
  const children = sql
    .exec<{ id: string }>("SELECT id FROM items WHERE parent_id = ?", remove.itemId)
    .toArray()
    .map(({ id }): RowKey => ({ kind: "item", id }));
  for (const { id } of children) {
    sql.exec(
      "UPDATE items SET parent_id = ?, parent_at = ?, parent_change_id = ?, seq = ? WHERE id = ?",
      found.item.parent_id,
      setter.at,
      setter.changeId,
      seq,
      id,
    );
  }
  const owner = found.item.owner_id;
  const bury = (kind: RowKey["kind"], id: string, visibleTo: string | null) =>
    sql.exec(
      "INSERT INTO tombstones (kind, id, visible_to, seq) VALUES (?, ?, ?, ?)",
      kind,
      id,
      visibleTo,
      seq,
    );
  const stickers = sql
    .exec<{ id: string; owner_id: string | null }>(
      `SELECT stickers.id, spaces.owner_id FROM stickers
       JOIN pages ON pages.id = stickers.page_id ${joinPageSpace}
       WHERE stickers.item_id = ? OR pages.item_id = ?`,
      remove.itemId,
      remove.itemId,
    )
    .toArray();
  for (const sticker of stickers) {
    sql.exec("DELETE FROM stickers WHERE id = ?", sticker.id);
    bury("sticker", sticker.id, sticker.owner_id);
  }
  const carried = carriedBy(sql, remove.itemId).filter(({ kind }) => kind !== "sticker");
  for (const row of carried) bury(row.kind, row.id, owner);
  sql.exec("DELETE FROM completions WHERE item_id = ?", remove.itemId);
  sql.exec("DELETE FROM last_ticks WHERE item_id = ?", remove.itemId);
  sql.exec("DELETE FROM pages WHERE item_id = ?", remove.itemId);
  sql.exec("DELETE FROM items WHERE id = ?", remove.itemId);
  bury("item", remove.itemId, owner);
  const changed: RowKey[] = [
    { kind: "item", id: remove.itemId },
    ...carried,
    ...stickers.map(({ id }): RowKey => ({ kind: "sticker", id })),
    ...children,
  ];
  return { seq, changed, unchanged: [] };
}

function carriedBy(sql: SqlStorage, itemId: string): RowKey[] {
  const ids = (query: string) =>
    sql
      .exec<{ id: string }>(query, itemId)
      .toArray()
      .map(({ id }) => id);
  return [
    ...ids("SELECT id FROM completions WHERE item_id = ?").map(
      (id): RowKey => ({ kind: "completion", id }),
    ),
    ...ids("SELECT id FROM pages WHERE item_id = ?").map((id): RowKey => ({ kind: "page", id })),
    ...ids("SELECT id FROM stickers WHERE page_id IN (SELECT id FROM pages WHERE item_id = ?)").map(
      (id): RowKey => ({ kind: "sticker", id }),
    ),
  ];
}

function checkField(field: Field, value: string): { value: string | null } | { refused: string } {
  switch (field) {
    case "title": {
      const title = value.trim();
      const problem = itemTitleProblem(title);
      return problem ? { refused: problem } : { value: title };
    }
    case "description": {
      const problem = itemDescriptionProblem(value);
      return problem ? { refused: problem } : { value };
    }
    case "date":
      if (value === "") return { value: null };
      return isIsoDate(value) ? { value } : { refused: badDate };
    case "time":
      if (value === "") return { value: null };
      return isTimeOfDay(value) ? { value } : { refused: badTime };
  }
}

/** An item the member sees, or else what a change to it does: nothing for a deleted item, and a
 *  refusal for one that never existed or that the member doesn't see. */
export function itemFor(
  sql: SqlStorage,
  memberId: string,
  itemId: string,
): { item: ItemRow } | { applied: Applied } {
  const [item] = sql
    .exec<ItemRow>(
      `SELECT items.kind, items.space_id, spaces.owner_id, items.parent_id, items.parent_at,
         items.parent_change_id, items.date, items.time, items.repeat, items.repeat_at,
         items.repeat_change_id,
         items.space_at, items.space_change_id,
         items.title_at, items.title_change_id, items.description_at, items.description_change_id,
         items.date_at, items.date_change_id, items.time_at, items.time_change_id
       FROM items JOIN spaces ON spaces.id = items.space_id WHERE items.id = ?`,
      itemId,
    )
    .toArray();
  if (item && canSee(sql, memberId, item.space_id)) return { item };
  const deleted =
    !item &&
    sql.exec("SELECT 1 FROM tombstones WHERE kind = 'item' AND id = ?", itemId).toArray().length >
      0;
  if (!deleted) return { applied: { refused: "There's no such item." } };
  const key: RowKey = { kind: "item", id: itemId };
  return { applied: { seq: nextSeq(sql), changed: [], unchanged: [key] } };
}

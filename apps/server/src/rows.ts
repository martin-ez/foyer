import { create } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import {
  GoogleConnectionSchema,
  GoogleConnectionState,
} from "@foyer/shared/gen/foyer/calendar/v1/calendar_pb";
import { ItemKind, ItemSchema, RepeatFrom } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import { MemberSchema } from "@foyer/shared/gen/foyer/member/v1/member_pb";
import { PageKind, PageSchema } from "@foyer/shared/gen/foyer/page/v1/page_pb";
import { CalendarState, SpaceKind, SpaceSchema } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import { StickerKind, StickerSchema } from "@foyer/shared/gen/foyer/sticker/v1/sticker_pb";
import { type Row, RowKind, RowSchema } from "@foyer/shared/gen/foyer/sync/v1/sync_pb";
import { CompletionSchema } from "@foyer/shared/gen/foyer/task/v1/task_pb";

/** Which row devices hold: its kind and its id. */
export type RowKey = {
  kind: "member" | "space" | "page" | "item" | "sticker" | "completion" | "google_connection";
  id: string;
};

/** A row as devices receive it, and who can see it: one member, or every member when null. */
export type VisibleRow = { row: Row; visibleTo: string | null };

/** At most this many rows go in one reply to a pull, unless one change alone changed more. */
export const pullReplyRowLimit = 500;

/** The number of the household's latest change. */
export function latestSeq(sql: SqlStorage): number {
  return sql.exec<{ seq: number }>("SELECT seq FROM household").one().seq;
}

/** Gives a change the next number in the household's sequence. The rows it changes keep that
 *  number as their `seq`. */
export function nextSeq(sql: SqlStorage): number {
  return sql.exec<{ seq: number }>("UPDATE household SET seq = seq + 1 RETURNING seq").one().seq;
}

/** The rows a member can see that changed after a cursor, oldest change first. Rows that one
 *  change changed always come together, so a reply holds more than the limit only when a single
 *  change changed more rows than that. */
export function pullRows(
  sql: SqlStorage,
  memberId: string,
  cursor: number,
  limit = pullReplyRowLimit,
): { rows: Row[]; cursor: number; done: boolean } {
  const seqsOf = (query: string, ...bindings: unknown[]) =>
    sql
      .exec<{ seq: number }>(`${query} ORDER BY seq LIMIT ?`, ...bindings, limit + 1)
      .toArray()
      .map(({ seq }) => seq);
  const seqs = [
    ...seqsOf(
      `SELECT seq FROM members WHERE seq > ?
       UNION ALL SELECT seq FROM spaces WHERE seq > ? AND (owner_id IS NULL OR owner_id = ?)
       UNION ALL SELECT pages.seq FROM ${pagesWithOwner} AND pages.seq > ? AND ${pageSeenBy}
       UNION ALL SELECT seq FROM google_connections WHERE seq > ? AND member_id = ?`,
      cursor,
      cursor,
      memberId,
      cursor,
      memberId,
      cursor,
      memberId,
    ),
    ...seqsOf(
      `SELECT items.seq FROM ${itemsWithOwner} WHERE items.seq > ? AND ${itemSeenBy}
       UNION ALL SELECT stickers.seq FROM ${stickersWithOwner} AND stickers.seq > ? AND ${pageSeenBy}
       UNION ALL SELECT completions.seq FROM ${completionsWithOwner}
         WHERE completions.seq > ? AND ${itemSeenBy}
       UNION ALL SELECT seq FROM tombstones WHERE seq > ? AND (visible_to IS NULL OR visible_to = ?)
       UNION ALL SELECT seq FROM hidden_rows WHERE seq > ? AND member_id = ?`,
      cursor,
      memberId,
      cursor,
      memberId,
      cursor,
      memberId,
      cursor,
      memberId,
      cursor,
      memberId,
    ),
  ]
    .sort((a, b) => a - b)
    .slice(0, limit + 1);

  const first = seqs[0];
  const beyondLimit = seqs[limit];
  if (first === undefined || beyondLimit === undefined) {
    const upTo = latestSeq(sql);
    return { rows: rowsBetween(sql, memberId, cursor, upTo), cursor: upTo, done: true };
  }
  const upTo = beyondLimit > first ? beyondLimit - 1 : beyondLimit;
  return { rows: rowsBetween(sql, memberId, cursor, upTo), cursor: upTo, done: false };
}

/** The rows as they are now, each once, with who can see each. A row that no longer exists comes
 *  as deleted when the household keeps its tombstone, and is left out otherwise. */
export function readRows(sql: SqlStorage, keys: RowKey[]): VisibleRow[] {
  const unique = new Map(keys.map((key) => [`${key.kind} ${key.id}`, key]));
  return [...unique.values()].flatMap((key) => {
    const found = readRow(sql, key);
    if (found.length > 0) return found;
    return sql
      .exec<Tombstone>(`${selectTombstones} WHERE kind = ? AND id = ?`, key.kind, key.id)
      .toArray()
      .map(deletedRow);
  });
}

function readRow(sql: SqlStorage, key: RowKey): VisibleRow[] {
  const found = readCurrentRow(sql, key);
  const hidden = found.flatMap(({ row }) =>
    sql
      .exec<Tombstone>(
        `${selectHiddenRows} WHERE kind = ? AND id = ? AND seq = ?`,
        key.kind,
        key.id,
        Number(row.seq),
      )
      .toArray()
      .map(deletedRow),
  );
  return [...found, ...hidden];
}

function readCurrentRow(sql: SqlStorage, { kind, id }: RowKey): VisibleRow[] {
  switch (kind) {
    case "member":
      return sql.exec<MemberRow>(`${selectMembers} WHERE id = ?`, id).toArray().map(memberRow);
    case "space":
      return sql.exec<SpaceRow>(`${selectSpaces} WHERE spaces.id = ?`, id).toArray().map(spaceRow);
    case "page":
      return sql.exec<PageRow>(`${selectPages} AND pages.id = ?`, id).toArray().map(pageRow);
    case "item":
      return sql.exec<ItemRow>(`${selectItems} WHERE items.id = ?`, id).toArray().map(itemRow);
    case "sticker":
      return sql
        .exec<StickerRow>(`${selectStickers} AND stickers.id = ?`, id)
        .toArray()
        .map(stickerRow);
    case "completion":
      return sql
        .exec<CompletionRow>(`${selectCompletions} WHERE completions.id = ?`, id)
        .toArray()
        .map(completionRow);
    case "google_connection":
      return sql
        .exec<GoogleConnectionRow>(`${selectGoogleConnections} WHERE member_id = ?`, id)
        .toArray()
        .map(googleConnectionRow);
  }
}

type MemberRow = { id: string; name: string; seq: number };

type SpaceRow = {
  id: string;
  kind: "inbox" | "personal" | "shared";
  owner_id: string | null;
  name: string | null;
  seq: number;
  calendar_member_id: string | null;
  calendar_holder_state: "connected" | "needs_reconnecting" | null;
};

type GoogleConnectionRow = {
  member_id: string;
  state: "connected" | "needs_reconnecting";
  seq: number;
};

type PageRow = {
  id: string;
  kind: "month" | "week" | "day" | "space" | "item";
  space_id: string | null;
  number: number | null;
  item_id: string | null;
  width: number;
  height: number;
  seq: number;
  owner_id: string | null;
};

type ItemRow = {
  id: string;
  kind: "task" | "event" | "note";
  space_id: string;
  title: string;
  description: string;
  date: string | null;
  repeat: string | null;
  repeat_from: "schedule" | "completion" | null;
  parent_id: string | null;
  created_by: string | null;
  created_at: number;
  starts_on: string | null;
  ends_on: string | null;
  starts_at: number | null;
  ends_at: number | null;
  seq: number;
  owner_id: string | null;
};

type StickerRow = {
  id: string;
  page_id: string;
  x: number;
  y: number;
  kind: "task" | "event" | "note";
  item_id: string;
  occurrence: string | null;
  placed_at: number;
  placed_by: string;
  seq: number;
  owner_id: string | null;
};

type CompletionRow = {
  id: string;
  item_id: string;
  occurrence: string;
  done_at: number;
  done_by: string;
  seq: number;
  owner_id: string | null;
};

type Tombstone = { kind: RowKey["kind"]; id: string; visible_to: string | null; seq: number };

const selectMembers = "SELECT id, name, seq FROM members";

const selectSpaces = `SELECT spaces.id, spaces.kind, spaces.owner_id, spaces.name, spaces.seq,
  space_calendars.member_id AS calendar_member_id,
  google_connections.state AS calendar_holder_state
  FROM spaces LEFT JOIN space_calendars ON space_calendars.space_id = spaces.id
  LEFT JOIN google_connections ON google_connections.member_id = space_calendars.member_id`;

const selectGoogleConnections = "SELECT member_id, state, seq FROM google_connections";

/** Joins each of the `pages` to the space whose members see it, as `spaces`: a space page's own,
 *  or an item page's item's. Calendar pages have none, as every member sees them. */
export const joinPageSpace = `LEFT JOIN items AS page_items ON page_items.id = pages.item_id
  LEFT JOIN spaces ON spaces.id = coalesce(pages.space_id, page_items.space_id)`;

const pagesWithOwner = `pages ${joinPageSpace}
  WHERE (pages.kind != 'item' OR page_items.id IS NOT NULL)`;

const pageSeenBy = "(spaces.owner_id IS NULL OR spaces.owner_id = ?)";

const selectPages = `SELECT pages.id, pages.kind, pages.space_id, pages.number, pages.item_id,
  pages.width, pages.height, pages.seq, spaces.owner_id FROM ${pagesWithOwner}`;

const itemsWithOwner = "items JOIN spaces ON spaces.id = items.space_id";

const itemSeenBy = "(spaces.owner_id IS NULL OR spaces.owner_id = ?)";

const selectItems = `SELECT items.id, items.kind, items.space_id, items.title, items.description,
  items.date, items.repeat, items.repeat_from, items.parent_id, items.created_by, items.created_at,
  items.starts_on, items.ends_on, items.starts_at, items.ends_at, items.seq, spaces.owner_id
  FROM ${itemsWithOwner}`;

const stickersWithOwner = `stickers JOIN pages ON pages.id = stickers.page_id ${joinPageSpace}
  WHERE (pages.kind != 'item' OR page_items.id IS NOT NULL)`;

const selectStickers = `SELECT stickers.id, stickers.page_id, stickers.x, stickers.y, stickers.kind,
  stickers.item_id, stickers.occurrence, stickers.placed_at, stickers.placed_by, stickers.seq,
  spaces.owner_id
  FROM ${stickersWithOwner}`;

const completionsWithOwner = `completions JOIN items ON items.id = completions.item_id
  JOIN spaces ON spaces.id = items.space_id`;

const selectCompletions = `SELECT completions.id, completions.item_id, completions.occurrence,
  completions.done_at, completions.done_by, completions.seq, spaces.owner_id
  FROM ${completionsWithOwner}`;

const selectTombstones = "SELECT kind, id, visible_to, seq FROM tombstones";

const selectHiddenRows = "SELECT kind, id, member_id AS visible_to, seq FROM hidden_rows";

const spaceKinds = {
  inbox: SpaceKind.INBOX,
  personal: SpaceKind.PERSONAL,
  shared: SpaceKind.SHARED,
} as const;

const pageKinds = {
  month: PageKind.MONTH,
  week: PageKind.WEEK,
  day: PageKind.DAY,
  space: PageKind.SPACE,
  item: PageKind.ITEM,
} as const;

const itemKinds = { task: ItemKind.TASK, event: ItemKind.EVENT, note: ItemKind.NOTE } as const;

const repeatFroms = {
  schedule: RepeatFrom.SCHEDULE,
  completion: RepeatFrom.COMPLETION,
} as const;

const stickerKinds = {
  task: StickerKind.TASK,
  event: StickerKind.EVENT,
  note: StickerKind.NOTE,
} as const;

const rowKinds = {
  member: RowKind.MEMBER,
  space: RowKind.SPACE,
  page: RowKind.PAGE,
  item: RowKind.ITEM,
  sticker: RowKind.STICKER,
  completion: RowKind.COMPLETION,
  google_connection: RowKind.GOOGLE_CONNECTION,
} as const;

const googleConnectionStates = {
  connected: GoogleConnectionState.CONNECTED,
  needs_reconnecting: GoogleConnectionState.NEEDS_RECONNECTING,
} as const;

function rowsBetween(sql: SqlStorage, memberId: string, after: number, upTo: number): Row[] {
  const members = sql
    .exec<MemberRow>(`${selectMembers} WHERE seq > ? AND seq <= ?`, after, upTo)
    .toArray()
    .map(memberRow);
  const spaces = sql
    .exec<SpaceRow>(
      `${selectSpaces} WHERE spaces.seq > ? AND spaces.seq <= ?
       AND (spaces.owner_id IS NULL OR spaces.owner_id = ?)`,
      after,
      upTo,
      memberId,
    )
    .toArray()
    .map(spaceRow);
  const pages = sql
    .exec<PageRow>(
      `${selectPages} AND pages.seq > ? AND pages.seq <= ? AND ${pageSeenBy}`,
      after,
      upTo,
      memberId,
    )
    .toArray()
    .map(pageRow);
  const items = sql
    .exec<ItemRow>(
      `${selectItems} WHERE items.seq > ? AND items.seq <= ? AND ${itemSeenBy}`,
      after,
      upTo,
      memberId,
    )
    .toArray()
    .map(itemRow);
  const stickers = sql
    .exec<StickerRow>(
      `${selectStickers} AND stickers.seq > ? AND stickers.seq <= ? AND ${pageSeenBy}`,
      after,
      upTo,
      memberId,
    )
    .toArray()
    .map(stickerRow);
  const completions = sql
    .exec<CompletionRow>(
      `${selectCompletions} WHERE completions.seq > ? AND completions.seq <= ? AND ${itemSeenBy}`,
      after,
      upTo,
      memberId,
    )
    .toArray()
    .map(completionRow);
  const googleConnections = sql
    .exec<GoogleConnectionRow>(
      `${selectGoogleConnections} WHERE seq > ? AND seq <= ? AND member_id = ?`,
      after,
      upTo,
      memberId,
    )
    .toArray()
    .map(googleConnectionRow);
  const tombstones = sql
    .exec<Tombstone>(
      `${selectTombstones} WHERE seq > ? AND seq <= ? AND (visible_to IS NULL OR visible_to = ?)`,
      after,
      upTo,
      memberId,
    )
    .toArray()
    .map(deletedRow);
  const hidden = sql
    .exec<Tombstone>(
      `${selectHiddenRows} WHERE seq > ? AND seq <= ? AND member_id = ?`,
      after,
      upTo,
      memberId,
    )
    .toArray()
    .map(deletedRow);
  return [
    ...members,
    ...spaces,
    ...pages,
    ...items,
    ...stickers,
    ...completions,
    ...googleConnections,
    ...tombstones,
    ...hidden,
  ]
    .map(({ row }) => row)
    .sort((a, b) => Number(a.seq - b.seq));
}

function memberRow({ id, name, seq }: MemberRow): VisibleRow {
  const member = create(MemberSchema, { id, name });
  return {
    row: create(RowSchema, { seq: BigInt(seq), row: { case: "member", value: member } }),
    visibleTo: null,
  };
}

function spaceRow(space: SpaceRow): VisibleRow {
  const value = create(SpaceSchema, {
    id: space.id,
    kind: spaceKinds[space.kind],
    ownerId: space.owner_id ?? "",
    name: space.name ?? "",
    calendarMemberId: space.calendar_member_id ?? "",
    calendarState: calendarStateOf(space),
  });
  return {
    row: create(RowSchema, { seq: BigInt(space.seq), row: { case: "space", value } }),
    visibleTo: space.owner_id,
  };
}

function calendarStateOf(space: SpaceRow): CalendarState {
  if (space.calendar_member_id === null) return CalendarState.NONE;
  return space.calendar_holder_state === "connected" ? CalendarState.SYNCING : CalendarState.PAUSED;
}

function googleConnectionRow(connection: GoogleConnectionRow): VisibleRow {
  const value = create(GoogleConnectionSchema, {
    memberId: connection.member_id,
    state: googleConnectionStates[connection.state],
  });
  return {
    row: create(RowSchema, {
      seq: BigInt(connection.seq),
      row: { case: "googleConnection", value },
    }),
    visibleTo: connection.member_id,
  };
}

function pageRow(page: PageRow): VisibleRow {
  const value = create(PageSchema, {
    id: page.id,
    kind: pageKinds[page.kind],
    spaceId: page.space_id ?? "",
    number: page.number ?? 0,
    itemId: page.item_id ?? "",
    width: page.width,
    height: page.height,
  });
  return {
    row: create(RowSchema, { seq: BigInt(page.seq), row: { case: "page", value } }),
    visibleTo: page.owner_id,
  };
}

function itemRow(item: ItemRow): VisibleRow {
  const value = create(ItemSchema, {
    id: item.id,
    kind: itemKinds[item.kind],
    spaceId: item.space_id,
    title: item.title,
    description: item.description,
    date: item.date ?? "",
    repeat: item.repeat ?? "",
    repeatFrom: item.repeat_from ? repeatFroms[item.repeat_from] : RepeatFrom.UNSPECIFIED,
    parentId: item.parent_id ?? "",
    createdBy: item.created_by ?? "",
    createdAt: timestampFromMs(item.created_at),
    startsOn: item.starts_on ?? "",
    endsOn: item.ends_on ?? "",
    ...(item.starts_at === null ? {} : { startsAt: timestampFromMs(item.starts_at) }),
    ...(item.ends_at === null ? {} : { endsAt: timestampFromMs(item.ends_at) }),
  });
  return {
    row: create(RowSchema, { seq: BigInt(item.seq), row: { case: "item", value } }),
    visibleTo: item.owner_id,
  };
}

function stickerRow(sticker: StickerRow): VisibleRow {
  const value = create(StickerSchema, {
    id: sticker.id,
    pageId: sticker.page_id,
    x: sticker.x,
    y: sticker.y,
    kind: stickerKinds[sticker.kind],
    itemId: sticker.item_id,
    placedAt: timestampFromMs(sticker.placed_at),
    placedBy: sticker.placed_by,
    occurrence: sticker.occurrence ?? "",
  });
  return {
    row: create(RowSchema, { seq: BigInt(sticker.seq), row: { case: "sticker", value } }),
    visibleTo: sticker.owner_id,
  };
}

function completionRow(completion: CompletionRow): VisibleRow {
  const value = create(CompletionSchema, {
    id: completion.id,
    itemId: completion.item_id,
    occurrence: completion.occurrence,
    doneAt: timestampFromMs(completion.done_at),
    doneBy: completion.done_by,
  });
  return {
    row: create(RowSchema, { seq: BigInt(completion.seq), row: { case: "completion", value } }),
    visibleTo: completion.owner_id,
  };
}

function deletedRow(tombstone: Tombstone): VisibleRow {
  const value = { kind: rowKinds[tombstone.kind], id: tombstone.id };
  return {
    row: create(RowSchema, { seq: BigInt(tombstone.seq), row: { case: "deleted", value } }),
    visibleTo: tombstone.visible_to,
  };
}

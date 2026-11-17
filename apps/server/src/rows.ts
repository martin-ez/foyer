import { create } from "@bufbuild/protobuf";
import { MemberSchema } from "@foyer/shared/gen/foyer/member/v1/member_pb";
import { PageKind, PageSchema } from "@foyer/shared/gen/foyer/page/v1/page_pb";
import { SpaceKind, SpaceSchema } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import { type Row, RowKind, RowSchema } from "@foyer/shared/gen/foyer/sync/v1/sync_pb";

/** Which row devices hold: its kind and its id. */
export type RowKey = { kind: "member" | "space" | "page"; id: string };

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
  const seqs = sql
    .exec<{ seq: number }>(
      `SELECT seq FROM members WHERE seq > ?
       UNION ALL SELECT seq FROM spaces WHERE seq > ? AND (owner_id IS NULL OR owner_id = ?)
       UNION ALL SELECT pages.seq FROM ${pagesWithOwner} AND pages.seq > ? AND ${pageSeenBy}
       UNION ALL SELECT seq FROM tombstones WHERE seq > ? AND (visible_to IS NULL OR visible_to = ?)
       ORDER BY seq LIMIT ?`,
      cursor,
      cursor,
      memberId,
      cursor,
      memberId,
      cursor,
      memberId,
      limit + 1,
    )
    .toArray()
    .map(({ seq }) => seq);

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

function readRow(sql: SqlStorage, { kind, id }: RowKey): VisibleRow[] {
  switch (kind) {
    case "member":
      return sql.exec<MemberRow>(`${selectMembers} WHERE id = ?`, id).toArray().map(memberRow);
    case "space":
      return sql.exec<SpaceRow>(`${selectSpaces} WHERE id = ?`, id).toArray().map(spaceRow);
    case "page":
      return sql.exec<PageRow>(`${selectPages} AND pages.id = ?`, id).toArray().map(pageRow);
  }
}

type MemberRow = { id: string; name: string; seq: number };

type SpaceRow = {
  id: string;
  kind: "inbox" | "personal" | "shared";
  owner_id: string | null;
  name: string | null;
  seq: number;
};

type PageRow = {
  id: string;
  kind: "month" | "week" | "day" | "space";
  space_id: string | null;
  number: number | null;
  width: number;
  height: number;
  seq: number;
  owner_id: string | null;
};

type Tombstone = { kind: RowKey["kind"]; id: string; visible_to: string | null; seq: number };

const selectMembers = "SELECT id, name, seq FROM members";

const selectSpaces = "SELECT id, kind, owner_id, name, seq FROM spaces";

/** Pages with the owner of the space they belong to, if it's a personal space or an Inbox. Item
 *  pages are left out until items exist, since they follow their item's space. */
const pagesWithOwner = `pages LEFT JOIN spaces ON spaces.id = pages.space_id WHERE pages.kind != 'item'`;

/** Whether a member sees a page: every member sees calendar pages, and a space's pages are seen by
 *  the members who see the space. Takes the member's id. */
const pageSeenBy = "(spaces.owner_id IS NULL OR spaces.owner_id = ?)";

const selectPages = `SELECT pages.id, pages.kind, pages.space_id, pages.number, pages.width, pages.height,
  pages.seq, spaces.owner_id FROM ${pagesWithOwner}`;

const selectTombstones = "SELECT kind, id, visible_to, seq FROM tombstones";

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
} as const;

const rowKinds = { member: RowKind.MEMBER, space: RowKind.SPACE, page: RowKind.PAGE } as const;

function rowsBetween(sql: SqlStorage, memberId: string, after: number, upTo: number): Row[] {
  const members = sql
    .exec<MemberRow>(`${selectMembers} WHERE seq > ? AND seq <= ?`, after, upTo)
    .toArray()
    .map(memberRow);
  const spaces = sql
    .exec<SpaceRow>(
      `${selectSpaces} WHERE seq > ? AND seq <= ? AND (owner_id IS NULL OR owner_id = ?)`,
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
  const tombstones = sql
    .exec<Tombstone>(
      `${selectTombstones} WHERE seq > ? AND seq <= ? AND (visible_to IS NULL OR visible_to = ?)`,
      after,
      upTo,
      memberId,
    )
    .toArray()
    .map(deletedRow);
  return [...members, ...spaces, ...pages, ...tombstones]
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
  });
  return {
    row: create(RowSchema, { seq: BigInt(space.seq), row: { case: "space", value } }),
    visibleTo: space.owner_id,
  };
}

function pageRow(page: PageRow): VisibleRow {
  const value = create(PageSchema, {
    id: page.id,
    kind: pageKinds[page.kind],
    spaceId: page.space_id ?? "",
    number: page.number ?? 0,
    width: page.width,
    height: page.height,
  });
  return {
    row: create(RowSchema, { seq: BigInt(page.seq), row: { case: "page", value } }),
    visibleTo: page.owner_id,
  };
}

function deletedRow(tombstone: Tombstone): VisibleRow {
  const value = { kind: rowKinds[tombstone.kind], id: tombstone.id };
  return {
    row: create(RowSchema, { seq: BigInt(tombstone.seq), row: { case: "deleted", value } }),
    visibleTo: tombstone.visible_to,
  };
}

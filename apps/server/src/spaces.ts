import { newId } from "@foyer/shared";

/** Gives a member who just joined their Inbox, and a personal space named "Personal" that they can
 *  rename, as part of the change numbered `seq`. */
export function createFirstSpaces(sql: SqlStorage, memberId: string, seq: number): void {
  const now = Date.now();
  for (const [kind, name] of [
    ["inbox", null],
    ["personal", "Personal"],
  ]) {
    sql.exec(
      `INSERT INTO spaces (id, kind, owner_id, name, created_by, created_at, seq, name_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      newId(),
      kind,
      memberId,
      name,
      memberId,
      now,
      seq,
      now,
    );
  }
}

/** Whether a member can see a space, and so its items: every member sees every shared space, and
 *  only its owner sees an Inbox or a personal space. False for a member or a space that doesn't
 *  exist. */
export function canSee(sql: SqlStorage, memberId: string, spaceId: string): boolean {
  return (
    sql
      .exec(
        `SELECT 1 FROM spaces JOIN members ON members.id = ?
         WHERE spaces.id = ? AND (spaces.kind = 'shared' OR spaces.owner_id = members.id)`,
        memberId,
        spaceId,
      )
      .toArray().length > 0
  );
}

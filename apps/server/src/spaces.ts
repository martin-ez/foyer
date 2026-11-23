import { freeSpaceName, newId } from "@foyer/shared";

/** Gives a member who just joined their Inbox, and a personal space named "Personal" that they can
 *  rename, as part of the change numbered `seq`. The personal space is numbered, as in
 *  "Personal 2", when a shared space already has that name. */
export function createFirstSpaces(sql: SqlStorage, memberId: string, seq: number): void {
  const now = Date.now();
  for (const [kind, name] of [
    ["inbox", null],
    ["personal", freeSpaceName("Personal", namesSeenBy(sql, memberId))],
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

/** The names of the spaces a member sees, archived ones included, which a new name mustn't clash
 *  with: every shared space's and their own personal spaces', leaving out `except`. Others'
 *  personal spaces don't count, so that a refusal never reveals a private space's name. */
export function namesSeenBy(sql: SqlStorage, memberId: string, except = ""): string[] {
  return spacesSeenBy(sql, memberId, except).map(({ name }) => name);
}

/** The names of the spaces `namesSeenBy` gives, with whether each space is archived. */
export function spacesSeenBy(
  sql: SqlStorage,
  memberId: string,
  except = "",
): { name: string; archived: boolean }[] {
  return sql
    .exec<{ name: string; archived: number }>(
      `SELECT name, archived FROM spaces
       WHERE (kind = 'shared' OR (kind = 'personal' AND owner_id = ?)) AND id != ?`,
      memberId,
      except,
    )
    .toArray()
    .map(({ name, archived }) => ({ name, archived: archived !== 0 }));
}

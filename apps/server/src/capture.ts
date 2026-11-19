import { create } from "@bufbuild/protobuf";
import { newId, pageSizeFor, spacePageId, stickerSpotInSpace } from "@foyer/shared";
import { ItemCreateSchema, ItemKind } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import { PageCreateSchema, PageKind } from "@foyer/shared/gen/foyer/page/v1/page_pb";
import { StickerKind, StickerPlaceSchema } from "@foyer/shared/gen/foyer/sticker/v1/sticker_pb";
import type { Applied } from "./changes";
import { createItem } from "./items";
import { createPage, newestPageOf } from "./pages";
import type { RowKey } from "./rows";
import { hashSecret, newSecret } from "./secrets";
import { placeSticker } from "./stickers";

const day = 24 * 60 * 60 * 1000;

/** A member's capture key, as they see it: when it was made, and when it was last used, to within
 *  a day, or null when it never was. */
export type CaptureKey = { createdAt: number; lastUsedAt: number | null };

/** Makes a capture key for a member, replacing any key they had, and returns it. Only its hash is
 *  kept, as sessions' are. */
export async function makeCaptureKey(
  storage: DurableObjectStorage,
  memberId: string,
  now: number,
): Promise<string> {
  const key = newSecret();
  const tokenHash = await hashSecret(key);
  const { sql } = storage;
  storage.transactionSync(() => {
    sql.exec("DELETE FROM capture_keys WHERE member_id = ?", memberId);
    sql.exec(
      "INSERT INTO capture_keys (id, member_id, token_hash, created_at) VALUES (?, ?, ?, ?)",
      newId(),
      memberId,
      tokenHash,
      now,
    );
  });
  return key;
}

/** Removes a member's capture key, if they have one. */
export function removeCaptureKey(sql: SqlStorage, memberId: string): void {
  sql.exec("DELETE FROM capture_keys WHERE member_id = ?", memberId);
}

/** A member's capture key, or null when they have none. */
export function captureKeyOf(sql: SqlStorage, memberId: string): CaptureKey | null {
  const [key] = sql
    .exec<{ created_at: number; last_used_at: number | null }>(
      "SELECT created_at, last_used_at FROM capture_keys WHERE member_id = ?",
      memberId,
    )
    .toArray();
  return key ? { createdAt: key.created_at, lastUsedAt: key.last_used_at } : null;
}

/** The member a capture key belongs to, with their email, or null for a key that was never made,
 *  was replaced or was removed. Moves the key's last use forward, at most once a day. */
export async function useCaptureKey(
  sql: SqlStorage,
  key: string,
  now: number,
): Promise<{ memberId: string; email: string } | null> {
  const [found] = sql
    .exec<{ id: string; member_id: string; email: string; last_used_at: number | null }>(
      `SELECT capture_keys.id, capture_keys.member_id, capture_keys.last_used_at, members.email
       FROM capture_keys JOIN members ON members.id = capture_keys.member_id
       WHERE capture_keys.token_hash = ?`,
      await hashSecret(key),
    )
    .toArray();
  if (!found) return null;
  if (found.last_used_at === null || found.last_used_at <= now - day) {
    sql.exec("UPDATE capture_keys SET last_used_at = ? WHERE id = ?", now, found.id);
  }
  return { memberId: found.member_id, email: found.email };
}

/** Adds a task with a checked title to a member's Inbox, as if their device had pushed it: the
 *  task, with its sticker in the next free spot of the Inbox's newest page, or on a new page when
 *  it's full, each a change made at `now`. Returns the rows it changed. */
export function captureTask(
  storage: DurableObjectStorage,
  memberId: string,
  title: string,
  now: number,
): RowKey[] {
  const { sql } = storage;
  return storage.transactionSync(() => {
    const inbox = sql
      .exec<{ id: string }>("SELECT id FROM spaces WHERE kind = 'inbox' AND owner_id = ?", memberId)
      .one().id;
    const size = pageSizeFor("space");
    const spot = stickerSpotInSpace(newestPageOf(sql, inbox), "task", size);
    const pageId = spacePageId(inbox, spot.number);
    const itemId = newId();
    const made = () => ({ at: now, changeId: newId() });

    const steps: Applied[] = [];
    if (spot.isNewPage) {
      const page = { pageId, kind: PageKind.SPACE, spaceId: inbox, number: spot.number, ...size };
      steps.push(createPage(sql, memberId, made(), create(PageCreateSchema, page)));
    }
    const item = { itemId, kind: ItemKind.TASK, spaceId: inbox, title };
    steps.push(createItem(sql, memberId, made(), create(ItemCreateSchema, item)));
    const sticker = { stickerId: newId(), pageId, ...spot.at, kind: StickerKind.TASK, itemId };
    steps.push(placeSticker(sql, memberId, made(), create(StickerPlaceSchema, sticker)));

    return steps.flatMap((step) => {
      if ("refused" in step) throw new Error(`The household refused a capture: ${step.refused}`);
      return step.changed;
    });
  });
}

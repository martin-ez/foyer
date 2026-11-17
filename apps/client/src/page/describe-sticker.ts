import type { Item } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import { type Sticker, StickerKind } from "@foyer/shared/gen/foyer/sticker/v1/sticker_pb";

/** What a sticker says to people who can't see it, such as VoiceOver's users: a task's title, or
 *  that it's hidden when the member can't see the task. */
export function describeSticker(sticker: Sticker, item: Item | undefined): string {
  if (sticker.kind !== StickerKind.TASK) return "Sticker";
  return item ? `Task: ${item.title}` : "Task, hidden";
}

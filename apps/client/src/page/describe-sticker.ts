import type { Item } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import { type Sticker, StickerKind } from "@foyer/shared/gen/foyer/sticker/v1/sticker_pb";

/** What a sticker says to people who can't see it, such as VoiceOver's users: a task's or an
 *  event's title, with a task's next date when it repeats, or that it's hidden when the member
 *  can't see its item. */
export function describeSticker(sticker: Sticker, item: Item | undefined): string {
  if (sticker.kind === StickerKind.EVENT) return item ? `Event: ${item.title}` : "Event, hidden";
  if (sticker.kind !== StickerKind.TASK) return "Sticker";
  if (!item) return "Task, hidden";
  return item.repeat ? `Task: ${item.title}, repeats, next on ${item.date}` : `Task: ${item.title}`;
}

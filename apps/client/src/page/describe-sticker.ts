import { timestampMs } from "@bufbuild/protobuf/wkt";
import { minutesOf } from "@foyer/shared";
import type { Item } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import { type Sticker, StickerKind } from "@foyer/shared/gen/foyer/sticker/v1/sticker_pb";
import { describeTime } from "./calendar-date";

/** What a sticker says to people who can't see it, such as VoiceOver's users: a task's or an
 *  event's title, with a task's time and next date when it repeats, or when an event with times
 *  starts and ends on the device's clock, or that it's hidden when the member can't see its item. */
export function describeSticker(sticker: Sticker, item: Item | undefined, locale?: string): string {
  if (sticker.kind === StickerKind.EVENT) {
    if (!item) return "Event, hidden";
    if (!item.startsAt || !item.endsAt) return `Event: ${item.title}`;
    const clock = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" });
    const [start, end] = [item.startsAt, item.endsAt].map((at) => clock.format(timestampMs(at)));
    return `Event: ${item.title}, ${start} to ${end}`;
  }
  if (sticker.kind !== StickerKind.TASK) return "Sticker";
  if (!item) return "Task, hidden";
  const time = item.time === "" ? "" : `, at ${describeTime(minutesOf(item.time), locale)}`;
  const repeats = item.repeat ? `, repeats, next on ${item.date}` : "";
  return `Task: ${item.title}${time}${repeats}`;
}

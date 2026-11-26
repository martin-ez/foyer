import { timestampMs } from "@bufbuild/protobuf/wkt";
import { type Item, ItemKind } from "@foyer/shared/gen/foyer/item/v1/item_pb";

/** The `count` notes written most recently, newest first. */
export function recentNotes(items: Iterable<Item>, count: number): Item[] {
  const written = (note: Item) => (note.createdAt ? timestampMs(note.createdAt) : 0);
  return [...items]
    .filter(({ kind }) => kind === ItemKind.NOTE)
    .sort((a, b) => written(b) - written(a) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
    .slice(0, count);
}

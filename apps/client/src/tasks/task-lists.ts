import { type Item, ItemKind } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import type { Space } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import type { Sticker } from "@foyer/shared/gen/foyer/sticker/v1/sticker_pb";
import type { Completion } from "@foyer/shared/gen/foyer/task/v1/task_pb";

/** The ids of the tasks that are done: those with a completion, since no task repeats yet. */
export function doneTasks(completions: Iterable<Completion>): Set<string> {
  return new Set(Array.from(completions, ({ itemId }) => itemId));
}

/** A space's tasks in the order of their stickers on its pages: page by page, top to bottom, then
 *  left to right. A task with no sticker on its space's pages comes last. */
export function spaceList(
  spaceId: string,
  items: Iterable<Item>,
  stickers: Iterable<Sticker>,
): Item[] {
  const prefix = `space:${spaceId}:`;
  const spots = new Map<string, { page: number; y: number; x: number }>();
  for (const sticker of stickers) {
    if (!sticker.pageId.startsWith(prefix)) continue;
    const spot = { page: Number(sticker.pageId.slice(prefix.length)), y: sticker.y, x: sticker.x };
    const known = spots.get(sticker.itemId);
    if (!known || compareSpots(spot, known) < 0) spots.set(sticker.itemId, spot);
  }
  const tasks = [...items].filter(
    (item) => item.kind === ItemKind.TASK && item.spaceId === spaceId,
  );
  return tasks.sort((a, b) => {
    const spotA = spots.get(a.id);
    const spotB = spots.get(b.id);
    if (spotA && spotB) return compareSpots(spotA, spotB) || compareIds(a.id, b.id);
    if (spotA || spotB) return spotA ? -1 : 1;
    return compareIds(a.id, b.id);
  });
}

/** The open tasks dated `today` or earlier, overdue first, each group in the order of the spaces,
 *  then of their space's list. `today` is a plain ISO 8601 date, from the device's own clock and
 *  zone, and `done` holds the ids of the tasks that are done. */
export function todayList(
  today: string,
  spaces: readonly Space[],
  items: Iterable<Item>,
  stickers: Iterable<Sticker>,
  done: ReadonlySet<string>,
): Item[] {
  const all = [...items];
  const stuck = [...stickers];
  return spaces
    .flatMap((space) => spaceList(space.id, all, stuck))
    .filter(({ id, date }) => date !== "" && date <= today && !done.has(id))
    .sort((a, b) => Number(a.date === today) - Number(b.date === today));
}

function compareSpots(
  a: { page: number; y: number; x: number },
  b: { page: number; y: number; x: number },
): number {
  return a.page - b.page || a.y - b.y || a.x - b.x;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

import { itemPageId } from "@foyer/shared";
import { type Item, ItemKind } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import { CalendarState, type Space } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import type { Sticker } from "@foyer/shared/gen/foyer/sticker/v1/sticker_pb";
import type { Completion } from "@foyer/shared/gen/foyer/task/v1/task_pb";
import { currentOccurrence } from "./repeats";

/** The ids of the tasks that are done: those with a completion for their current occurrence,
 *  which is a repeating task's date, and none for a task that doesn't repeat. */
export function doneTasks(
  items: ReadonlyMap<string, Item>,
  completions: Iterable<Completion>,
): Set<string> {
  const done = new Set<string>();
  for (const { itemId, occurrence } of completions) {
    const item = items.get(itemId);
    if (item && occurrence === currentOccurrence(item)) done.add(itemId);
  }
  return done;
}

/** Whether the task a sticker shows is done on the sticker's day: for a repeating task on a
 *  calendar page, whether that occurrence was ticked, and otherwise whether the task is done. */
export function isStickerDone(
  sticker: Pick<Sticker, "itemId" | "occurrence">,
  item: Item | undefined,
  completions: Iterable<Completion>,
): boolean {
  if (!item || item.kind !== ItemKind.TASK) return false;
  const onDay = item.repeat !== "" && sticker.occurrence !== "";
  const occurrence = onDay ? sticker.occurrence : currentOccurrence(item);
  for (const completion of completions) {
    if (completion.itemId === item.id && completion.occurrence === occurrence) return true;
  }
  return false;
}

/** A space's tasks, and the events under them, in list order: top-level tasks by their stickers on
 *  its pages, page by page, top to bottom, then left to right, each followed by the items under it,
 *  by their stickers on its body page. Items without such a sticker come last among them. */
export function spaceList(
  spaceId: string,
  items: Iterable<Item>,
  stickers: Iterable<Sticker>,
): Item[] {
  return spaceTree(spaceId, items, stickers).map(({ item }) => item);
}

/** A space's tasks, and the events under them, in list order, as `spaceList` gives them, each with
 *  how deep it is: 0 at the top of the space, 1 under a top-level task, and so on. */
export function spaceTree(
  spaceId: string,
  items: Iterable<Item>,
  stickers: Iterable<Sticker>,
): { item: Item; depth: number }[] {
  const inSpace = [...items].filter((item) => item.spaceId === spaceId);
  const taskIds = new Set(inSpace.filter(({ kind }) => kind === ItemKind.TASK).map(({ id }) => id));
  const listable = inSpace.filter(
    (item) => taskIds.has(item.id) || (item.kind === ItemKind.EVENT && taskIds.has(item.parentId)),
  );
  const parentOf = (item: Item) => (taskIds.has(item.parentId) ? item.parentId : "");
  const placedOn = new Map(
    listable.map((item) => [item.id, placementPage(spaceId, parentOf(item))]),
  );
  const spots = new Map<string, Spot>();
  for (const sticker of stickers) {
    const page = placedOn.get(sticker.itemId)?.(sticker.pageId);
    if (page === undefined) continue;
    const spot = { page, y: sticker.y, x: sticker.x };
    const known = spots.get(sticker.itemId);
    if (!known || compareSpots(spot, known) < 0) spots.set(sticker.itemId, spot);
  }
  const byParent = new Map<string, Item[]>();
  for (const item of listable)
    byParent.set(parentOf(item), [...(byParent.get(parentOf(item)) ?? []), item]);
  const listed: { item: Item; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (parentId: string, depth: number) => {
    const children = (byParent.get(parentId) ?? []).sort((a, b) => {
      const spotA = spots.get(a.id);
      const spotB = spots.get(b.id);
      if (spotA && spotB) return compareSpots(spotA, spotB) || compareIds(a.id, b.id);
      if (spotA || spotB) return spotA ? -1 : 1;
      return compareIds(a.id, b.id);
    });
    for (const item of children) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      listed.push({ item, depth });
      walk(item.id, depth + 1);
    }
  };
  walk("", 0);
  return listed;
}

/** The ids of the items under an item, at any depth. */
export function itemsUnder(itemId: string, items: Iterable<Item>): string[] {
  const all = [...items];
  const under: string[] = [];
  const queue = [itemId];
  for (let parent = queue.shift(); parent !== undefined; parent = queue.shift()) {
    for (const item of all) {
      if (item.parentId === parent && item.id !== itemId && !under.includes(item.id)) {
        under.push(item.id);
        queue.push(item.id);
      }
    }
  }
  return under;
}

/** Whether an item can move into a space with everything under it, as the household allows: an
 *  event only into a space with a Google calendar, and an occurrence of a repeating event never,
 *  since it moves with its series in Google Calendar. Its own space always takes it. */
export function canMoveTo(
  item: Item,
  spaceId: string,
  items: ReadonlyMap<string, Item>,
  spaces: readonly Pick<Space, "id" | "calendarState">[],
): boolean {
  if (spaceId === item.spaceId) return true;
  const moving = [item.id, ...itemsUnder(item.id, items.values())].flatMap((id) => {
    const found = items.get(id);
    return found ? [found] : [];
  });
  if (moving.some(({ seriesId }) => seriesId !== "")) return false;
  if (!moving.some(({ kind }) => kind === ItemKind.EVENT)) return true;
  return spaces.some(
    ({ id, calendarState }) => id === spaceId && calendarState !== CalendarState.NONE,
  );
}

/** The tasks under an item, at any depth, that aren't done. `done` holds the ids of the tasks that
 *  are done. */
export function openTasksUnder(
  itemId: string,
  items: ReadonlyMap<string, Item>,
  done: ReadonlySet<string>,
): Item[] {
  return itemsUnder(itemId, items.values()).flatMap((id) => {
    const item = items.get(id);
    return item && item.kind === ItemKind.TASK && !done.has(id) ? [item] : [];
  });
}

type Spot = { page: number; y: number; x: number };

function placementPage(spaceId: string, parentId: string): (pageId: string) => number | undefined {
  if (parentId !== "") return (pageId) => (pageId === itemPageId(parentId) ? 0 : undefined);
  const prefix = `space:${spaceId}:`;
  return (pageId) => (pageId.startsWith(prefix) ? Number(pageId.slice(prefix.length)) : undefined);
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

function compareSpots(a: Spot, b: Spot): number {
  return a.page - b.page || a.y - b.y || a.x - b.x;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

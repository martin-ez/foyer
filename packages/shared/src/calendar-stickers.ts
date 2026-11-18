import { type Box, calendarLayout, calendarPageOf } from "./calendar-layout";
import { monthOf } from "./dates";
import { newId } from "./id";
import {
  dayPageId,
  firstDayOfWeek,
  isIsoDate,
  monthPageId,
  type PageSize,
  pageSizeFor,
  weekPageId,
} from "./page";
import { type PagePoint, type StickerKindName, stickerSizeOf } from "./sticker-spot";

/** The kinds of calendar page, each of which shows a dated item once. */
export type CalendarPageKind = "month" | "week" | "day";

/** Every kind of calendar page, from the one that shows the most days. */
export const calendarPageKinds: readonly CalendarPageKind[] = ["month", "week", "day"];

/** The size of a sticker on a calendar page, of any kind, in points: small enough that a few fit
 *  in a day of a month's page. */
export const calendarStickerSize: PageSize = { width: 200, height: 32 };

/** The space automatic placement leaves between a day's stickers, and around them in its box. */
export const calendarStickerGap = 6;

/** How much lower than the last sticker in a full day the next one goes, as in a pile. */
export const pileStep = 6;

/** The size of a sticker of `kind` on a page: the same for every kind on a calendar page, and the
 *  kind's own size anywhere else. */
export function stickerSizeOn(pageId: string, kind: StickerKindName | null): PageSize {
  return calendarPageOf(pageId) ? calendarStickerSize : stickerSizeOf(kind);
}

/** The id of the calendar page of a kind that shows a day. */
export function calendarPageId(kind: CalendarPageKind, date: string): string {
  switch (kind) {
    case "month":
      return monthPageId(monthOf(date));
    case "week":
      return weekPageId(firstDayOfWeek(date));
    case "day":
      return dayPageId(date);
  }
}

/** Whether a day is one a calendar page shows: in its month, in its week, or the day itself. */
export function showsDay(pageId: string, date: string): boolean {
  const calendar = calendarPageOf(pageId);
  return calendar !== null && isIsoDate(date) && calendarPageId(calendar.kind, date) === pageId;
}

/** The day whose space on a calendar page holds a point, or null when the point is in no day's,
 *  such as on a month page's days of other months, or on a page that isn't a calendar page. */
export function dayAt(pageId: string, page: PageSize, at: PagePoint): string | null {
  const day = calendarLayout(pageId, page)?.days.find(({ box }) => contains(box, at));
  return day?.date ?? null;
}

/** Where a calendar sticker put at `at` on a day goes so that it stays inside the day's space on
 *  the page: as close to `at` as that allows. Anywhere on the page for a day it doesn't show. */
export function keepInDay(pageId: string, page: PageSize, date: string, at: PagePoint): PagePoint {
  const box = calendarLayout(pageId, page)?.days.find((day) => day.date === date)?.box;
  const area = box ?? { x: 0, y: 0, ...page };
  const { width, height } = calendarStickerSize;
  const clamp = (value: number, from: number, size: number, length: number) =>
    Math.min(Math.max(value, from), Math.max(from + length - size, from));
  return {
    x: clamp(at.x, area.x, width, area.width),
    y: clamp(at.y, area.y, height, area.height),
  };
}

/** A sticker on a page, as placing calendar stickers needs it. `occurrence` is the day it's on, on
 *  a calendar page, and empty on any other page. */
export type PlacedSticker = {
  id: string;
  pageId: string;
  itemId: string;
  x: number;
  y: number;
  occurrence: string;
};

/** The next free spot in a day's box on a calendar page: at its left edge, below the lowest of the
 *  day's stickers. When the box is full, it goes on the lowest one, a little lower, like a pile. */
export function spotInDay(
  pageId: string,
  page: PageSize,
  date: string,
  stickers: Iterable<PlacedSticker>,
): PagePoint {
  const area = calendarLayout(pageId, page)?.days.find((day) => day.date === date)?.stickers;
  const box = area ?? { x: 0, y: 0, ...page };
  const { width, height } = calendarStickerSize;
  const left = box.x + calendarStickerGap;
  const top = box.y + calendarStickerGap;
  const bottom = Math.max(box.y + box.height - calendarStickerGap - height, top);
  let lowest: PlacedSticker | null = null;
  for (const sticker of stickers) {
    if (sticker.pageId !== pageId || sticker.occurrence !== date) continue;
    if (!lowest || sticker.y > lowest.y) lowest = sticker;
  }
  if (!lowest) return { x: left, y: top };
  const below = lowest.y + height + calendarStickerGap;
  if (below <= bottom) return { x: left, y: below };
  const x = Math.min(Math.max(lowest.x, box.x), Math.max(box.x + box.width - width, box.x));
  return { x, y: Math.min(lowest.y + pileStep, bottom) };
}

/** What to change so that an item has one sticker on its day on each kind of calendar page: the
 *  calendar pages to create first, the stickers to place, those to move, and those to remove. */
export type CalendarStickerPlan = {
  pages: { pageId: string; kind: CalendarPageKind; size: PageSize }[];
  place: { stickerId: string; pageId: string; x: number; y: number; occurrence: string }[];
  move: { stickerId: string; x: number; y: number; occurrence: string }[];
  remove: string[];
};

/** Plans one sticker on an item's date on each kind of calendar page: one already on that day stays,
 *  one on another day of the page moves to the day's next free spot, or a new one is placed there.
 *  Any others are removed, except on a `kept` day, such as a repeating task's ticked days. */
export function planCalendarStickers(options: {
  itemId: string;
  date: string | null;
  kept?: ReadonlySet<string>;
  /** Every sticker on the calendar pages the device or household knows, of every item. */
  stickers: readonly PlacedSticker[];
  /** The calendar pages that have been created, with their sizes. */
  pages: ReadonlyMap<string, PageSize>;
}): CalendarStickerPlan {
  const { itemId, date, kept = new Set(), stickers, pages } = options;
  const plan: CalendarStickerPlan = { pages: [], place: [], move: [], remove: [] };
  for (const kind of calendarPageKinds) {
    const mine = stickers.filter(
      (sticker) => sticker.itemId === itemId && calendarPageOf(sticker.pageId)?.kind === kind,
    );
    const pageId = date === null ? null : calendarPageId(kind, date);
    const settled = mine.find(
      (sticker) => sticker.pageId === pageId && sticker.occurrence === date,
    );
    const loose = mine.filter((sticker) => sticker !== settled && !kept.has(sticker.occurrence));
    if (date === null || pageId === null || settled) {
      plan.remove.push(...loose.map(({ id }) => id));
      continue;
    }
    const size = pages.get(pageId) ?? pageSizeFor(kind);
    const spot = spotInDay(pageId, size, date, stickers);
    const onPage = loose.find((sticker) => sticker.pageId === pageId);
    if (onPage) {
      plan.move.push({ stickerId: onPage.id, ...spot, occurrence: date });
    } else {
      if (!pages.has(pageId)) plan.pages.push({ pageId, kind, size });
      plan.place.push({ stickerId: newId(), pageId, ...spot, occurrence: date });
    }
    plan.remove.push(...loose.filter((sticker) => sticker !== onPage).map(({ id }) => id));
  }
  return plan;
}

/** The stickers after a plan for an item, so that the next plan places around them. */
export function afterPlan(
  stickers: readonly PlacedSticker[],
  itemId: string,
  plan: CalendarStickerPlan,
): PlacedSticker[] {
  const removed = new Set(plan.remove);
  const moved = new Map(plan.move.map((move) => [move.stickerId, move]));
  return [
    ...stickers
      .filter(({ id }) => !removed.has(id))
      .map((sticker) => {
        const move = moved.get(sticker.id);
        return move ? { ...sticker, x: move.x, y: move.y, occurrence: move.occurrence } : sticker;
      }),
    ...plan.place.map(({ stickerId, ...placed }) => ({ id: stickerId, itemId, ...placed })),
  ];
}

function contains(box: Box, at: PagePoint): boolean {
  return at.x >= box.x && at.x <= box.x + box.width && at.y >= box.y && at.y <= box.y + box.height;
}

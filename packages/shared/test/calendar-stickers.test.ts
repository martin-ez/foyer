import {
  a2Landscape,
  a4Portrait,
  afterPlan,
  type CalendarStickerPlan,
  calendarLayout,
  calendarPageId,
  calendarStickerGap,
  calendarStickerSize,
  dayAt,
  dropOnDayPage,
  heightOfTime,
  inStrip,
  keepInDay,
  type PlacedSticker,
  pileStep,
  planCalendarStickers,
  showsDay,
  spotAtTime,
  spotInDay,
  stickerSizeOn,
  taskStickerSize,
  timelineOf,
} from "@foyer/shared";
import { describe, expect, it } from "vitest";

const month = "month:2026-11";
const week = "week:2026-11-16";
const day = "day:2026-11-17";

function areaOf(pageId: string, date: string) {
  const size = pageId.startsWith("day:") ? a4Portrait : a2Landscape;
  const area = calendarLayout(pageId, size)?.days.find((each) => each.date === date)?.stickers;
  if (!area) throw new Error(`${date} isn't on ${pageId}`);
  return area;
}

function topOf(pageId: string, date: string) {
  const area = areaOf(pageId, date);
  return { x: area.x + calendarStickerGap, y: area.y + calendarStickerGap };
}

let made = 0;
function sticker(pageId: string, occurrence: string, more: Partial<PlacedSticker> = {}) {
  made += 1;
  const at = topOf(pageId, occurrence);
  return { id: `sticker-${made}`, pageId, itemId: "task", ...at, occurrence, ...more };
}

const noPages = new Map();
const allPages = new Map([
  [month, a2Landscape],
  [week, a2Landscape],
  [day, a4Portrait],
]);

describe("stickerSizeOn", () => {
  it("gives every sticker on a calendar page the calendar's size", () => {
    for (const pageId of [month, week, day]) {
      expect(stickerSizeOn(pageId, "task")).toEqual(calendarStickerSize);
      expect(stickerSizeOn(pageId, "event")).toEqual(calendarStickerSize);
    }
  });

  it("gives stickers on other pages their kind's size", () => {
    expect(stickerSizeOn("space:0190c6c4-6c2b-7d4e-8a1b-1234567890ab:1", "task")).toEqual(
      taskStickerSize,
    );
  });

  it("fits a calendar sticker in a day of a month's page, with room around it", () => {
    for (const { stickers } of calendarLayout(month, a2Landscape)?.days ?? []) {
      expect(calendarStickerSize.width + 2 * calendarStickerGap).toBeLessThanOrEqual(
        stickers.width,
      );
      expect(3 * (calendarStickerSize.height + calendarStickerGap)).toBeLessThanOrEqual(
        stickers.height,
      );
    }
  });
});

describe("calendarPageId and showsDay", () => {
  it("names the month, week and day pages that show a day", () => {
    expect(calendarPageId("month", "2026-11-17")).toBe(month);
    expect(calendarPageId("week", "2026-11-17")).toBe(week);
    expect(calendarPageId("week", "2026-11-22")).toBe(week);
    expect(calendarPageId("day", "2026-11-17")).toBe(day);
  });

  it("says which days a calendar page shows", () => {
    expect(showsDay(month, "2026-11-30")).toBe(true);
    expect(showsDay(month, "2026-12-01")).toBe(false);
    expect(showsDay(week, "2026-11-22")).toBe(true);
    expect(showsDay(week, "2026-11-23")).toBe(false);
    expect(showsDay(day, "2026-11-17")).toBe(true);
    expect(showsDay(day, "2026-11-18")).toBe(false);
    expect(showsDay(month, "2026-11-31")).toBe(false);
    expect(showsDay("space:0190c6c4-6c2b-7d4e-8a1b-1234567890ab:1", "2026-11-17")).toBe(false);
  });
});

describe("dayAt", () => {
  it("finds the day whose space holds a point, number and all", () => {
    const layout = calendarLayout(month, a2Landscape);
    const seventeenth = layout?.days.find(({ date }) => date === "2026-11-17");
    const box = seventeenth?.box ?? { x: 0, y: 0, width: 0, height: 0 };

    expect(dayAt(month, a2Landscape, { x: box.x + 5, y: box.y + 5 })).toBe("2026-11-17");
    expect(dayAt(month, a2Landscape, { x: box.x + 5, y: box.y + box.height - 5 })).toBe(
      "2026-11-17",
    );
  });

  it("finds no day on a month's days of other months, in its margins, or off calendar pages", () => {
    const shaded = calendarLayout(month, a2Landscape)?.ruling.shaded[0];

    expect(dayAt(month, a2Landscape, { x: (shaded?.x ?? 0) + 5, y: (shaded?.y ?? 0) + 5 })).toBe(
      null,
    );
    expect(dayAt(month, a2Landscape, { x: 2, y: 2 })).toBeNull();
    expect(
      dayAt("space:0190c6c4-6c2b-7d4e-8a1b-1234567890ab:1", a4Portrait, { x: 99, y: 99 }),
    ).toBe(null);
  });

  it("finds the day anywhere inside a day page's margins, and each day of a week", () => {
    expect(dayAt(day, a4Portrait, { x: 300, y: 700 })).toBe("2026-11-17");
    const area = areaOf(week, "2026-11-20");
    expect(dayAt(week, a2Landscape, { x: area.x + 1, y: area.y + 1 })).toBe("2026-11-20");
  });
});

describe("keepInDay", () => {
  it("keeps a sticker inside its day's space, as close as it can to where it was put", () => {
    const box = calendarLayout(week, a2Landscape)?.days.find(({ date }) => date === "2026-11-18")
      ?.box ?? { x: 0, y: 0, width: 0, height: 0 };

    expect(keepInDay(week, a2Landscape, "2026-11-18", { x: box.x + 10, y: box.y + 300 })).toEqual({
      x: box.x + 10,
      y: box.y + 300,
    });
    expect(keepInDay(week, a2Landscape, "2026-11-18", { x: box.x + box.width - 5, y: 0 })).toEqual({
      x: box.x + box.width - calendarStickerSize.width,
      y: box.y,
    });
  });
});

describe("spotInDay", () => {
  it("starts at the top-left of an empty day's box", () => {
    expect(spotInDay(month, a2Landscape, "2026-11-17", [])).toEqual(topOf(month, "2026-11-17"));
    expect(spotInDay(day, a4Portrait, "2026-11-17", [])).toEqual(topOf(day, "2026-11-17"));
  });

  it("goes below the lowest of the day's stickers, ignoring other days and pages", () => {
    const top = topOf(month, "2026-11-17");
    const stickers = [
      sticker(month, "2026-11-17", { y: top.y + 50, x: top.x + 30 }),
      sticker(month, "2026-11-17"),
      sticker(month, "2026-11-18", { y: top.y + 300 }),
      sticker(week, "2026-11-17", { y: top.y + 400 }),
    ];

    expect(spotInDay(month, a2Landscape, "2026-11-17", stickers)).toEqual({
      x: top.x,
      y: top.y + 50 + calendarStickerSize.height + calendarStickerGap,
    });
  });

  it("piles a sticker on the lowest one, a little lower, when the day is full, inside its box", () => {
    const area = areaOf(month, "2026-11-17");
    const stickers: PlacedSticker[] = [];
    for (let count = 0; count < 12; count += 1) {
      const spot = spotInDay(month, a2Landscape, "2026-11-17", stickers);
      expect(spot.y + calendarStickerSize.height).toBeLessThanOrEqual(area.y + area.height);
      stickers.push(sticker(month, "2026-11-17", spot));
    }
    const ys = stickers.map(({ y }) => y);
    const full = ys.findIndex((y, index) => index > 0 && y - (ys[index - 1] ?? 0) === pileStep);

    expect(full).toBeGreaterThan(1);
    expect(ys.at(-1)).toBe(ys.at(-2));
  });
});

describe("a day page's strip and timeline", () => {
  const timeline = timelineOf(day, a4Portrait);
  if (!timeline) throw new Error("A day page has a timeline.");
  const at = (minutes: number) => heightOfTime(timeline, minutes);

  it("is only on day pages", () => {
    expect(timelineOf(week, a2Landscape)).toBeNull();
    expect(dropOnDayPage(month, a2Landscape, { x: 100, y: 100 })).toBeNull();
  });

  it("places things without a time in the strip, ignoring stickers on the timeline", () => {
    const strip = areaOf(day, "2026-11-17");
    const timed = sticker(day, "2026-11-17", { x: timeline.left, y: at(9 * 60) });

    expect(spotInDay(day, a4Portrait, "2026-11-17", [timed])).toEqual(topOf(day, "2026-11-17"));
    const stickers: PlacedSticker[] = [timed];
    for (let count = 0; count < 5; count += 1) {
      const spot = spotInDay(day, a4Portrait, "2026-11-17", stickers);
      expect(spot.y + calendarStickerSize.height).toBeLessThanOrEqual(strip.y + strip.height);
      expect(inStrip(timeline, spot.y)).toBe(true);
      stickers.push(sticker(day, "2026-11-17", spot));
    }
  });

  it("places a sticker at its time, beside those it would cover", () => {
    const first = spotAtTime(day, a4Portrait, 9 * 60, []);
    const nine = sticker(day, "2026-11-17", first);
    const second = spotAtTime(day, a4Portrait, 9 * 60 + 15, [nine]);
    const later = spotAtTime(day, a4Portrait, 11 * 60, [nine]);

    expect(first).toEqual({ x: timeline.left, y: at(9 * 60) });
    expect(second).toEqual({
      x: timeline.left + calendarStickerSize.width + calendarStickerGap,
      y: at(9 * 60 + 15),
    });
    expect(later).toEqual({ x: timeline.left, y: at(11 * 60) });
  });

  it("piles a sticker a little to the right when every column at its time is taken", () => {
    const stickers: PlacedSticker[] = [];
    for (let count = 0; count < 4; count += 1) {
      stickers.push(sticker(day, "2026-11-17", spotAtTime(day, a4Portrait, 9 * 60, stickers)));
    }
    const right = timeline.box.x + timeline.box.width;

    expect(new Set(stickers.map(({ y }) => y)).size).toBe(1);
    expect(new Set(stickers.map(({ x }) => x)).size).toBe(4);
    for (const { x } of stickers) {
      expect(x).toBeGreaterThanOrEqual(timeline.left);
      expect(x + calendarStickerSize.width).toBeLessThanOrEqual(right + 0.001);
    }
  });

  it("snaps a sticker dropped on the timeline to its nearest quarter of an hour", () => {
    const quarter = at(9 * 60 + 15) - at(9 * 60);
    const dropped = dropOnDayPage(day, a4Portrait, { x: 300, y: at(9 * 60) + quarter * 0.7 });

    expect(dropped).toEqual({ at: { x: 300, y: at(9 * 60 + 15) }, time: 9 * 60 + 15 });
  });

  it("keeps a dropped sticker right of the hours and inside the day", () => {
    const left = dropOnDayPage(day, a4Portrait, { x: 0, y: at(12 * 60) });
    const right = dropOnDayPage(day, a4Portrait, { x: a4Portrait.width, y: at(12 * 60) });

    expect(left?.at.x).toBe(timeline.left);
    expect(right?.at.x).toBe(timeline.box.x + timeline.box.width - calendarStickerSize.width);
  });

  it("takes the time off a sticker dropped in the strip, keeping it there", () => {
    const strip = areaOf(day, "2026-11-17");
    const dropped = dropOnDayPage(day, a4Portrait, { x: 200, y: strip.y + 40 });
    const top = dropOnDayPage(day, a4Portrait, { x: 200, y: 0 });

    expect(dropped).toEqual({ at: { x: 200, y: strip.y + 40 }, time: null });
    expect(top).toEqual({ at: { x: 200, y: strip.y }, time: null });
  });
});

describe("planCalendarStickers", () => {
  const plan = (date: string | null, stickers: PlacedSticker[], more = {}) =>
    planCalendarStickers({ itemId: "task", date, stickers, pages: allPages, ...more });
  const placedOn = (result: CalendarStickerPlan) => result.place.map(({ pageId }) => pageId);

  it("places a dated item on its month, week and day pages, creating the pages it needs", () => {
    const result = planCalendarStickers({
      itemId: "task",
      date: "2026-11-17",
      stickers: [],
      pages: new Map([[month, a2Landscape]]),
    });

    expect(result.pages.map(({ pageId, kind }) => [pageId, kind])).toEqual([
      [week, "week"],
      [day, "day"],
    ]);
    expect(result.pages.map(({ size }) => size)).toEqual([a2Landscape, a4Portrait]);
    expect(placedOn(result)).toEqual([month, week, day]);
    expect(result.place.every(({ occurrence }) => occurrence === "2026-11-17")).toBe(true);
    expect(result.place[0]).toMatchObject(topOf(month, "2026-11-17"));
    expect(result.move).toEqual([]);
    expect(result.remove).toEqual([]);
  });

  it("places around other items' stickers on the same day", () => {
    const other = sticker(month, "2026-11-17", { itemId: "other" });
    const result = planCalendarStickers({
      itemId: "task",
      date: "2026-11-17",
      stickers: [other],
      pages: noPages,
    });

    expect(result.place[0]?.y).toBe(other.y + calendarStickerSize.height + calendarStickerGap);
    expect(result.pages).toHaveLength(3);
  });

  it("changes nothing when the item's stickers are already on its day", () => {
    const stickers = [
      sticker(month, "2026-11-17", { y: 500 }),
      sticker(week, "2026-11-17"),
      sticker(day, "2026-11-17"),
    ];

    expect(plan("2026-11-17", stickers)).toEqual({ pages: [], place: [], move: [], remove: [] });
  });

  it("moves stickers to the new day on pages that show it, and replaces the rest", () => {
    const old = [
      sticker(month, "2026-11-17"),
      sticker(week, "2026-11-17"),
      sticker(day, "2026-11-17"),
    ];
    const result = plan("2026-11-19", old);

    expect(result.move).toEqual([
      { stickerId: old[0]?.id, ...topOf(month, "2026-11-19"), occurrence: "2026-11-19" },
      { stickerId: old[1]?.id, ...topOf(week, "2026-11-19"), occurrence: "2026-11-19" },
    ]);
    expect(placedOn(result)).toEqual(["day:2026-11-19"]);
    expect(result.pages.map(({ pageId }) => pageId)).toEqual(["day:2026-11-19"]);
    expect(result.remove).toEqual([old[2]?.id]);
  });

  it("replaces every sticker when the item moves to another month", () => {
    const old = [
      sticker(month, "2026-11-17"),
      sticker(week, "2026-11-17"),
      sticker(day, "2026-11-17"),
    ];
    const result = plan("2026-12-02", old);

    expect(result.move).toEqual([]);
    expect(placedOn(result)).toEqual(["month:2026-12", "week:2026-11-30", "day:2026-12-02"]);
    expect(result.remove).toEqual(old.map(({ id }) => id));
  });

  it("keeps a sticker already moved to the new day where it is, and moves the others", () => {
    const dropped = sticker(month, "2026-11-19", { x: 900, y: 600 });
    const result = plan("2026-11-19", [
      dropped,
      sticker(week, "2026-11-17"),
      sticker(day, "2026-11-17"),
    ]);

    expect(result.move.map(({ stickerId }) => stickerId)).not.toContain(dropped.id);
    expect(result.remove).not.toContain(dropped.id);
    expect(placedOn(result)).toEqual(["day:2026-11-19"]);
  });

  it("removes every calendar sticker when the date is cleared", () => {
    const old = [
      sticker(month, "2026-11-17"),
      sticker(week, "2026-11-17"),
      sticker(day, "2026-11-17"),
    ];
    const result = plan(null, old);

    expect(result).toEqual({ pages: [], place: [], move: [], remove: old.map(({ id }) => id) });
  });

  it("removes extra stickers of the item on the same kind of page", () => {
    const kept = sticker(month, "2026-11-17");
    const extra = sticker(month, "2026-11-17", { y: 700 });
    const elsewhere = sticker("month:2026-10", "2026-10-02");
    const result = plan("2026-11-17", [
      kept,
      extra,
      elsewhere,
      sticker(week, "2026-11-17"),
      sticker(day, "2026-11-17"),
    ]);

    expect(result.remove).toEqual([extra.id, elsewhere.id]);
  });

  it("leaves stickers on kept days, as a repeating task's ticked days, and places new ones", () => {
    const ticked = [
      sticker(month, "2026-11-17"),
      sticker(week, "2026-11-17"),
      sticker(day, "2026-11-17"),
    ];
    const result = plan("2026-11-24", ticked, { kept: new Set(["2026-11-17"]) });

    expect(result.remove).toEqual([]);
    expect(result.move).toEqual([]);
    expect(placedOn(result)).toEqual([month, "week:2026-11-23", "day:2026-11-24"]);
  });

  it("puts a ticked day's stickers back in use when it's unticked, removing the next date's", () => {
    const ticked = [
      sticker(month, "2026-11-17"),
      sticker(week, "2026-11-17"),
      sticker(day, "2026-11-17"),
    ];
    const next = [
      sticker(month, "2026-11-24"),
      sticker("week:2026-11-23", "2026-11-24"),
      sticker("day:2026-11-24", "2026-11-24"),
    ];
    const result = plan("2026-11-17", [...ticked, ...next]);

    expect(result.place).toEqual([]);
    expect(result.move).toEqual([]);
    expect(result.remove).toEqual(next.map(({ id }) => id));
  });

  it("puts the item's day page sticker at its time, and other pages' as before", () => {
    const timeline = timelineOf(day, a4Portrait);
    const result = plan("2026-11-17", [], { time: 19 * 60 });

    expect(placedOn(result)).toEqual([month, week, day]);
    expect(result.place[0]).toMatchObject(topOf(month, "2026-11-17"));
    expect(result.place[2]).toMatchObject({
      x: timeline?.left,
      y: timeline && heightOfTime(timeline, 19 * 60),
    });
  });

  it("moves a sticker on the day page to the item's new time, and leaves other pages", () => {
    const timeline = timelineOf(day, a4Portrait);
    if (!timeline) throw new Error("A day page has a timeline.");
    const onDay = sticker(day, "2026-11-17", spotAtTime(day, a4Portrait, 9 * 60, []));
    const stickers = [sticker(month, "2026-11-17"), sticker(week, "2026-11-17"), onDay];
    const result = plan("2026-11-17", stickers, { time: 14 * 60 + 30 });

    expect(plan("2026-11-17", stickers, { time: 9 * 60 }).move).toEqual([]);
    expect(result.move).toEqual([
      {
        stickerId: onDay.id,
        x: timeline.left,
        y: heightOfTime(timeline, 14 * 60 + 30),
        occurrence: "2026-11-17",
      },
    ]);
    expect(result.place).toEqual([]);
    expect(result.remove).toEqual([]);
  });

  it("moves a sticker to the strip when its item has no time, and back to the timeline", () => {
    const timeline = timelineOf(day, a4Portrait);
    if (!timeline) throw new Error("A day page has a timeline.");
    const timed = sticker(day, "2026-11-17", spotAtTime(day, a4Portrait, 9 * 60, []));
    const untimed = sticker(day, "2026-11-17");

    expect(plan("2026-11-17", [timed]).move).toEqual([
      { stickerId: timed.id, ...topOf(day, "2026-11-17"), occurrence: "2026-11-17" },
    ]);
    expect(plan("2026-11-17", [untimed]).move).toEqual([]);
    expect(plan("2026-11-17", [untimed], { time: 9 * 60 }).move).toEqual([
      {
        stickerId: untimed.id,
        x: timeline.left,
        y: heightOfTime(timeline, 9 * 60),
        occurrence: "2026-11-17",
      },
    ]);
  });

  it("keeps a sticker where it was dropped at its time, across the timeline", () => {
    const timeline = timelineOf(day, a4Portrait);
    if (!timeline) throw new Error("A day page has a timeline.");
    const dropped = sticker(day, "2026-11-17", { x: 320, y: heightOfTime(timeline, 9 * 60) });

    expect(plan("2026-11-17", [dropped], { time: 9 * 60 }).move).toEqual([]);
  });
});

describe("afterPlan", () => {
  it("lets the next item's plan place around the stickers just planned", () => {
    const first = planCalendarStickers({
      itemId: "a",
      date: "2026-11-17",
      stickers: [],
      pages: noPages,
    });
    const stickers = afterPlan([], "a", first);
    const second = planCalendarStickers({
      itemId: "b",
      date: "2026-11-17",
      stickers,
      pages: noPages,
    });

    expect(stickers.map(({ itemId, pageId }) => [itemId, pageId])).toEqual([
      ["a", month],
      ["a", week],
      ["a", day],
    ]);
    expect(second.place[0]?.y).toBe(
      (first.place[0]?.y ?? 0) + calendarStickerSize.height + calendarStickerGap,
    );
  });

  it("moves and removes stickers as the plan says", () => {
    const old = [sticker(month, "2026-11-17"), sticker(day, "2026-11-17")];
    const plan = planCalendarStickers({
      itemId: "task",
      date: "2026-11-18",
      stickers: old,
      pages: allPages,
    });
    const after = afterPlan(old, "task", plan);

    expect(after.find(({ id }) => id === old[0]?.id)?.occurrence).toBe("2026-11-18");
    expect(after.some(({ id }) => id === old[1]?.id)).toBe(false);
    expect(after.filter(({ pageId }) => pageId === "day:2026-11-18")).toHaveLength(1);
  });
});

import {
  a2Landscape,
  a4Portrait,
  type Box,
  type CalendarLayout,
  calendarLayout,
  calendarPageOf,
  calendarStickerSize,
  dayLayout,
  heightOfTime,
  inStrip,
  monthLayout,
  timeAtHeight,
  timelineStep,
  timeOfDay,
  weekLayout,
} from "@foyer/shared";
import { describe, expect, it } from "vitest";

function within(box: Box) {
  return (
    box.x >= 0 &&
    box.y >= 0 &&
    box.x + box.width <= a2Landscape.width + 0.001 &&
    box.y + box.height <= a2Landscape.height + 0.001
  );
}

function overlaps(a: Box, b: Box) {
  const apart = 0.001;
  return (
    a.x + apart < b.x + b.width &&
    b.x + apart < a.x + a.width &&
    a.y + apart < b.y + b.height &&
    b.y + apart < a.y + a.height
  );
}

function rowsOf(layout: CalendarLayout) {
  return new Set(layout.days.map(({ box }) => box.y)).size;
}

describe("monthLayout", () => {
  const november = monthLayout("2026-11", a2Landscape);

  it("puts every day of the month on the page, once, in order", () => {
    expect(november.days.map(({ date }) => date)).toEqual(
      Array.from({ length: 30 }, (_, day) => `2026-11-${String(day + 1).padStart(2, "0")}`),
    );
    expect(november.days.every(({ box, label }) => within(box) && label && within(label))).toBe(
      true,
    );
  });

  it("puts each day in its weekday's column, Monday first", () => {
    const columnOf = (date: string) => november.days.find((day) => day.date === date)?.box.x;

    expect(november.weekdays.map(({ date }) => date)).toEqual([
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
    ]);
    expect(columnOf("2026-11-01")).toBe(november.weekdays[6]?.box.x);
    expect(columnOf("2026-11-02")).toBe(november.weekdays[0]?.box.x);
    expect(columnOf("2026-11-17")).toBe(november.weekdays[1]?.box.x);
  });

  it("gives each week the month touches a row, and shades the days of other months", () => {
    expect(rowsOf(november)).toBe(6);
    expect(november.ruling.shaded).toHaveLength(6 * 7 - 30);
    expect(rowsOf(monthLayout("2027-02", a2Landscape))).toBe(4);
    expect(monthLayout("2027-02", a2Landscape).ruling.shaded).toHaveLength(0);
  });

  it("keeps days and shaded boxes apart, and every one on the page", () => {
    const boxes = [...november.days.map(({ box }) => box), ...november.ruling.shaded];

    expect(boxes.every(within)).toBe(true);
    expect(boxes.some((a, i) => boxes.some((b, j) => i < j && overlaps(a, b)))).toBe(false);
  });
});

describe("weekLayout", () => {
  const week = weekLayout("2026-12-28", a2Landscape);

  it("puts the week's seven days side by side, from Monday, across months and years", () => {
    expect(week.days.map(({ date }) => date)).toEqual([
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
    ]);
    const lefts = week.days.map(({ box }) => box.x);
    expect([...lefts].sort((a, b) => a - b)).toEqual(lefts);
    expect(rowsOf(week)).toBe(1);
  });

  it("names each day above its space, on the page", () => {
    for (const { label, box } of week.days) {
      expect(label && within(label) && within(box)).toBe(true);
      expect((label?.y ?? 0) + (label?.height ?? 0)).toBeLessThanOrEqual(box.y);
    }
  });
});

describe("stickers' space on calendar pages", () => {
  it("keeps a month's day's stickers in its box, below its number", () => {
    for (const { box, label, stickers } of monthLayout("2026-11", a2Landscape).days) {
      expect(inside(stickers, box)).toBe(true);
      expect(stickers.y).toBeGreaterThanOrEqual((label?.y ?? 0) + (label?.height ?? 0));
    }
  });

  it("gives a week's day its whole box below its name", () => {
    for (const { box, stickers } of weekLayout("2026-11-16", a2Landscape).days) {
      expect(stickers).toEqual(box);
    }
  });

  it("gives a day's page to the day, with a strip for things without a time above its timeline", () => {
    const day = calendarLayout("day:2026-11-17", a4Portrait);
    const [only] = day?.days ?? [];
    const timeline = day?.timeline;
    if (!only || !timeline) throw new Error("A day page has its day and a timeline.");

    expect(day?.days).toHaveLength(1);
    expect(only.date).toBe("2026-11-17");
    expect(only.label).toBeNull();
    expect(inside(only.box, { x: 0, y: 0, ...a4Portrait })).toBe(true);
    expect(inside(only.stickers, only.box)).toBe(true);
    expect(inside(timeline.box, only.box)).toBe(true);
    expect(only.stickers.y + only.stickers.height).toBe(timeline.box.y);
    expect(only.stickers.height).toBeGreaterThanOrEqual(3 * calendarStickerSize.height);
  });
});

describe("a day page's timeline", () => {
  const timeline = dayLayout("2026-11-17", a4Portrait).timeline;
  if (!timeline) throw new Error("A day page has a timeline.");

  it("runs from 6:00 to 23:00, leaving room for a sticker at 23:00 inside the day", () => {
    expect(timeline.from).toBe(6 * 60);
    expect(timeline.to).toBe(23 * 60);
    expect(timeline.top).toBeGreaterThan(timeline.box.y);
    expect(timeline.bottom + calendarStickerSize.height).toBeLessThanOrEqual(
      timeline.box.y + timeline.box.height + 0.001,
    );
  });

  it("prints each hour beside a line across the page, top to bottom", () => {
    const hours = timeline.hours.map(({ time }) => time);

    expect(hours).toEqual(Array.from({ length: 18 }, (_, index) => timeOfDay((6 + index) * 60)));
    expect(timeline.hours[0]?.y).toBe(timeline.top);
    expect(timeline.hours.at(-1)?.y).toBe(timeline.bottom);
    for (const { label } of timeline.hours) {
      expect(inside(label, timeline.box)).toBe(true);
      expect(label.x + label.width).toBeLessThanOrEqual(timeline.left);
    }
    const lines = dayLayout("2026-11-17", a4Portrait).ruling.lines;
    for (const { y } of timeline.hours) {
      expect(lines).toContainEqual({
        from: { x: timeline.left, y },
        to: expect.objectContaining({ y }),
      });
    }
  });

  it("turns a time into a height and back", () => {
    for (let minutes = timeline.from; minutes <= timeline.to; minutes += timelineStep) {
      expect(timeAtHeight(timeline, heightOfTime(timeline, minutes))).toBe(minutes);
    }
    expect(heightOfTime(timeline, 12 * 60)).toBeGreaterThan(heightOfTime(timeline, 11 * 60));
  });

  it("snaps a height to the nearest quarter of an hour", () => {
    const quarter = heightOfTime(timeline, 9 * 60 + 15) - heightOfTime(timeline, 9 * 60);
    const nine = heightOfTime(timeline, 9 * 60);

    expect(timeAtHeight(timeline, nine + quarter * 0.4)).toBe(9 * 60);
    expect(timeAtHeight(timeline, nine + quarter * 0.6)).toBe(9 * 60 + 15);
    expect(timeAtHeight(timeline, nine - quarter * 0.6)).toBe(8 * 60 + 45);
  });

  it("keeps times it doesn't show at its ends", () => {
    expect(heightOfTime(timeline, 4 * 60)).toBe(timeline.top);
    expect(heightOfTime(timeline, 23 * 60 + 30)).toBe(timeline.bottom);
    expect(timeAtHeight(timeline, timeline.box.y)).toBe(timeline.from);
    expect(timeAtHeight(timeline, a4Portrait.height)).toBe(timeline.to);
  });

  it("tells the strip from the timeline by where a sticker's middle is", () => {
    const half = calendarStickerSize.height / 2;

    expect(inStrip(timeline, timeline.box.y - half - 1)).toBe(true);
    expect(inStrip(timeline, timeline.box.y - half + 1)).toBe(false);
  });

  it("is only on day pages", () => {
    expect(monthLayout("2026-11", a2Landscape).timeline).toBeNull();
    expect(weekLayout("2026-11-16", a2Landscape).timeline).toBeNull();
  });
});

describe("calendarPageOf", () => {
  it.each([
    ["month:2026-11", { kind: "month", date: "2026-11" }],
    ["week:2026-11-16", { kind: "week", date: "2026-11-16" }],
    ["day:2026-11-17", { kind: "day", date: "2026-11-17" }],
  ])("reads %s", (pageId, calendar) => {
    expect(calendarPageOf(pageId)).toEqual(calendar);
  });

  it.each([
    "week:2026-11-17",
    "day:2026-11-31",
    "month:2026-13",
    "space:0190c6c4-6c2b-7d4e-8a1b-1234567890ab:1",
    "day:2026-11-17:x",
  ])("reads %s as no calendar page", (pageId) => {
    expect(calendarPageOf(pageId)).toBeNull();
    expect(calendarLayout(pageId, a4Portrait)).toBeNull();
  });
});

function inside(inner: Box, outer: Box) {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width + 0.001 &&
    inner.y + inner.height <= outer.y + outer.height + 0.001
  );
}

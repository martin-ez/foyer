import { a2Landscape } from "@foyer/shared";
import { describe, expect, it } from "vitest";
import { type CalendarLayout, monthLayout, weekLayout } from "../src/calendar/calendar-layout";
import type { Box } from "../src/page/page-drawing";

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
    expect(november.days.every(({ box, label }) => within(box) && within(label))).toBe(true);
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
      expect(within(label) && within(box)).toBe(true);
      expect(label.y + label.height).toBeLessThanOrEqual(box.y);
    }
  });
});

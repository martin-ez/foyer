import { newId } from "@foyer/shared";
import { afterEach, expect, it, vi } from "vitest";

const uuidVersion7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.useRealTimers();
});

it("makes UUID version 7 ids, written in lowercase", () => {
  for (let i = 0; i < 100; i++) {
    expect(newId()).toMatch(uuidVersion7);
  }
});

it("starts each id with the time it was made", () => {
  vi.useFakeTimers({ now: 0x017f22e279b0 });

  expect(newId()).toMatch(/^017f22e2-79b0-7/);
});

it("sorts ids by when they were made", () => {
  vi.useFakeTimers({ now: Date.UTC(2026, 10, 15) });
  const ids = [newId()];
  for (let i = 0; i < 20; i++) {
    vi.advanceTimersByTime(1);
    ids.push(newId());
  }

  expect(ids.toSorted()).toEqual(ids);
});

it("makes a different id each time, even in the same millisecond", () => {
  vi.useFakeTimers({ now: Date.UTC(2026, 10, 15) });
  const ids = new Set(Array.from({ length: 10_000 }, () => newId()));

  expect(ids.size).toBe(10_000);
});

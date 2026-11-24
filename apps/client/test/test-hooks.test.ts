import { afterEach, describe, expect, it } from "vitest";
import { setTestHooks } from "../src/shell/test-hooks";

afterEach(() => {
  globalThis.foyerTest = undefined;
});

describe("setTestHooks", () => {
  it("sets hooks where checks reach them, beside those already set", () => {
    const throwInOpenView = () => {};
    const scene = () => ({ page: { id: "day:2026-11-24" } }) as never;
    setTestHooks({ throwInOpenView });

    setTestHooks({ scene });

    expect(globalThis.foyerTest).toEqual({ throwInOpenView, scene });
  });

  it("takes its hooks away again, except those another call has set since", () => {
    const first = { scene: () => ({}) as never, addStrokes: () => ["first"] };
    const later = () => ["later"];
    const unset = setTestHooks(first);
    setTestHooks({ addStrokes: later });

    unset();

    expect(globalThis.foyerTest?.scene).toBeUndefined();
    expect(globalThis.foyerTest?.addStrokes).toBe(later);
  });
});

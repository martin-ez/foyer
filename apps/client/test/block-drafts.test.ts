import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BlockDrafts, typingPause } from "../src/text/block-drafts";

let sent: [string, string][];
let drafts: BlockDrafts;

beforeEach(() => {
  vi.useFakeTimers();
  sent = [];
  drafts = new BlockDrafts((blockId, markdown) => sent.push([blockId, markdown]));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("BlockDrafts", () => {
  it("sends a block's latest text once typing pauses, not every key", () => {
    drafts.type("a", "B");
    vi.advanceTimersByTime(typingPause - 1);
    drafts.type("a", "Bu");
    vi.advanceTimersByTime(typingPause - 1);
    drafts.type("a", "Buy");

    expect(sent).toEqual([]);

    vi.advanceTimersByTime(typingPause);

    expect(sent).toEqual([["a", "Buy"]]);
  });

  it("sends a block's text at once when the person leaves it, and only once", () => {
    drafts.type("a", "Buy");
    drafts.leave("a");
    vi.advanceTimersByTime(typingPause);
    drafts.leave("a");

    expect(sent).toEqual([["a", "Buy"]]);
  });

  it("sends every block's unsent text when flushed, and forgets a dropped one", () => {
    drafts.type("a", "One");
    drafts.type("b", "Two");
    drafts.type("c", "Three");
    drafts.drop("b");
    drafts.flush();
    vi.advanceTimersByTime(typingPause);

    expect(sent).toEqual([
      ["a", "One"],
      ["c", "Three"],
    ]);
  });
});

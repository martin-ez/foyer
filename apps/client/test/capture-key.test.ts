import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";
import { describeCaptureKey } from "../src/capture/capture-key";

const madeOn = Date.UTC(2026, 10, 17);
const usedOn = Date.UTC(2026, 10, 20);
const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

describe("describeCaptureKey", () => {
  it("says when there's no key", () => {
    expect(describeCaptureKey({ exists: false }, isoDate)).toBe("You have no capture key.");
  });

  it("says when a key was made, and that it was never used", () => {
    const key = { exists: true, createdAt: timestampFromMs(madeOn) };

    expect(describeCaptureKey(key, isoDate)).toBe(
      "Your capture key was made on 2026-11-17, and never used.",
    );
  });

  it("says when a key was last used", () => {
    const key = {
      exists: true,
      createdAt: timestampFromMs(madeOn),
      lastUsedAt: timestampFromMs(usedOn),
    };

    expect(describeCaptureKey(key, isoDate)).toBe(
      "Your capture key was made on 2026-11-17, and last used on 2026-11-20.",
    );
  });
});

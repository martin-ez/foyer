import { rm } from "node:fs/promises";
import path from "node:path";
import { Circle, Group, Path, vec } from "react-native-skia";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectToMatchGoldenImage } from "./golden-image";

const name = "golden-image-test-drawing";
const size = { width: 40, height: 40 };

function DrawnWithVecMissingFromHeadlessSkia() {
  return <Circle c={vec(20, 20)} r={10} color="black" />;
}

describe("expectToMatchGoldenImage", () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(path.join(import.meta.dirname, "golden-images", `${name}.png`), { force: true });
  });

  it("fails with a component's error instead of comparing the blank page it left", async () => {
    vi.stubEnv("UPDATE_GOLDEN_IMAGES", "1");
    await expectToMatchGoldenImage(name, <Group />, size);
    vi.stubEnv("UPDATE_GOLDEN_IMAGES", "");

    await expect(
      expectToMatchGoldenImage(name, <DrawnWithVecMissingFromHeadlessSkia />, size),
    ).rejects.toThrow(/vec\)? is not a function/);
  });

  it("fails with a component's error instead of saving the blank page it left", async () => {
    vi.stubEnv("UPDATE_GOLDEN_IMAGES", "1");

    await expect(
      expectToMatchGoldenImage(name, <DrawnWithVecMissingFromHeadlessSkia />, size),
    ).rejects.toThrow(/vec\)? is not a function/);
    vi.stubEnv("UPDATE_GOLDEN_IMAGES", "");
    await expect(expectToMatchGoldenImage(name, <Group />, size)).rejects.toThrow(
      "has no golden image yet",
    );
  });

  it("fails with the error Skia throws while drawing", async () => {
    await expect(
      expectToMatchGoldenImage(name, <Path path="not a path" color="black" />, size),
    ).rejects.toThrow("Invalid path: not a path");
  });
});

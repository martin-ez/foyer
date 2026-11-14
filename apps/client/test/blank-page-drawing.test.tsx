import { describe, it } from "vitest";
import { BlankPageDrawing } from "../src/page/blank-page-drawing";
import { expectToMatchGoldenImage } from "./golden-image";

describe("BlankPageDrawing", () => {
  it("draws an empty page centred on a landscape desk", async () => {
    const size = { width: 800, height: 600 };
    await expectToMatchGoldenImage("blank-page-landscape", <BlankPageDrawing {...size} />, size);
  });

  it("draws an empty page centred on a portrait desk", async () => {
    const size = { width: 600, height: 900 };
    await expectToMatchGoldenImage("blank-page-portrait", <BlankPageDrawing {...size} />, size);
  });

  it("draws only the desk when the page doesn't fit inside the margins", async () => {
    const size = { width: 40, height: 40 };
    await expectToMatchGoldenImage("blank-page-no-room", <BlankPageDrawing {...size} />, size);
  });
});

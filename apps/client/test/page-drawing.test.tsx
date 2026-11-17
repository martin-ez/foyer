import { a4Portrait } from "@foyer/shared";
import { describe, it } from "vitest";
import { DeskDrawing } from "../src/page/desk-drawing";
import { PageDrawing } from "../src/page/page-drawing";
import { fittedCamera, zoomCamera } from "../src/page/sheet-camera";
import { expectToMatchGoldenImage } from "./golden-image";

describe("PageDrawing", () => {
  it("draws a blank day page at its own size", async () => {
    const size = { width: Math.ceil(a4Portrait.width), height: Math.ceil(a4Portrait.height) };
    await expectToMatchGoldenImage("blank-day-page", <PageDrawing size={a4Portrait} />, size);
  });
});

describe("DeskDrawing", () => {
  const view = { width: 800, height: 600 };

  it("draws a blank day page fitted to the desk", async () => {
    const camera = fittedCamera(view, a4Portrait);
    const drawing = <DeskDrawing page={a4Portrait} camera={camera} />;
    await expectToMatchGoldenImage("blank-day-page-fitted", drawing, view);
  });

  it("draws a blank day page zoomed in on its top-left corner", async () => {
    const camera = zoomCamera(fittedCamera(view, a4Portrait), view, a4Portrait, 3, { x: 0, y: 0 });
    const drawing = <DeskDrawing page={a4Portrait} camera={camera} />;
    await expectToMatchGoldenImage("blank-day-page-zoomed", drawing, view);
  });
});

import { a2Landscape, a4Portrait } from "@foyer/shared";
import { describe, it } from "vitest";
import { monthLayout, weekLayout } from "../src/calendar/calendar-layout";
import { DeskDrawing } from "../src/page/desk-drawing";
import { PageDrawing } from "../src/page/page-drawing";
import { fittedCamera, zoomCamera } from "../src/page/sheet-camera";
import { expectToMatchGoldenImage } from "./golden-image";

describe("PageDrawing", () => {
  it("draws a blank day page at its own size", async () => {
    const size = { width: Math.ceil(a4Portrait.width), height: Math.ceil(a4Portrait.height) };
    await expectToMatchGoldenImage("blank-day-page", <PageDrawing size={a4Portrait} />, size);
  });

  const a2 = { width: Math.ceil(a2Landscape.width), height: Math.ceil(a2Landscape.height) };

  it("draws a blank month page's grid, with the days of other months shaded", async () => {
    const { ruling } = monthLayout("2026-11", a2Landscape);
    const drawing = <PageDrawing size={a2Landscape} ruling={ruling} />;
    await expectToMatchGoldenImage("blank-month-page", drawing, a2);
  });

  it("draws a blank week page's columns", async () => {
    const { ruling } = weekLayout("2026-11-16", a2Landscape);
    const drawing = <PageDrawing size={a2Landscape} ruling={ruling} />;
    await expectToMatchGoldenImage("blank-week-page", drawing, a2);
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

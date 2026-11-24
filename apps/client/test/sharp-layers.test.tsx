import { create } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import { a4Portrait, dayLayout, encodeSamples } from "@foyer/shared";
import { Input, StrokeSchema, Tool } from "@foyer/shared/gen/foyer/ink/v1/ink_pb";
import type { Skia } from "react-native-skia";
import { getSkiaExports } from "react-native-skia/lib/commonjs/headless";
import { describe, expect, it } from "vitest";
import { InkDrawing } from "../src/ink/ink-drawing";
import { PageDrawing } from "../src/page/page-drawing";
import {
  cleared,
  layerDrawn,
  needsSharpLayer,
  noSharpLayers,
  type Rest,
  restedAt,
  SharpDrawing,
} from "../src/page/sharp-layers";
import { expectToMatchGoldenImage } from "./golden-image";

const fitted: Rest = { x: -40, y: -20, width: 680, height: 900, zoom: 0.9 };
const zoomedIn: Rest = { x: 100, y: 200, width: 170, height: 225, zoom: 4 };
const movedOn: Rest = { x: 140, y: 260, width: 170, height: 225, zoom: 4 };
const movedAgain: Rest = { x: 180, y: 300, width: 170, height: 225, zoom: 4 };

describe("sharp layers", () => {
  it("needs a layer only once one point of the page takes more than one screen point", () => {
    expect(needsSharpLayer({ ...zoomedIn, zoom: 1 })).toBe(false);
    expect(needsSharpLayer({ ...zoomedIn, zoom: 1.2 })).toBe(true);
  });

  it("draws no layer while one point of the page takes at most one screen point", () => {
    const sharp = restedAt(noSharpLayers, fitted);

    expect(sharp.layers).toEqual([]);
    expect(sharp.inkHiddenIn).toBeNull();
  });

  it("draws a layer where a zoomed-in page rests, and hides the page's ink under it once drawn", () => {
    const resting = restedAt(noSharpLayers, zoomedIn);
    const [layer] = resting.layers;

    expect(resting.layers).toEqual([{ key: layer?.key, rest: zoomedIn, drawn: false }]);
    expect(resting.inkHiddenIn).toBeNull();

    const drawn = layerDrawn(resting, layer?.key ?? -1);

    expect(drawn.layers).toEqual([{ key: layer?.key, rest: zoomedIn, drawn: true }]);
    expect(drawn.inkHiddenIn).toEqual(zoomedIn);
  });

  it("keeps the drawn layer until the next one is drawn over it", () => {
    const first = drawnAt(noSharpLayers, zoomedIn);

    const moved = restedAt(first, movedOn);

    expect(moved.layers.map(({ rest, drawn }) => ({ rest, drawn }))).toEqual([
      { rest: zoomedIn, drawn: true },
      { rest: movedOn, drawn: false },
    ]);
    expect(moved.inkHiddenIn).toEqual(zoomedIn);

    const next = layerDrawn(moved, moved.layers[1]?.key ?? -1);

    expect(next.layers.map(({ rest, drawn }) => ({ rest, drawn }))).toEqual([
      { rest: movedOn, drawn: true },
    ]);
    expect(next.inkHiddenIn).toEqual(movedOn);
  });

  it("drops a layer not drawn yet once the page rests somewhere else", () => {
    const first = drawnAt(noSharpLayers, zoomedIn);
    const moved = restedAt(first, movedOn);
    const skipped = moved.layers[1]?.key ?? -1;

    const again = restedAt(moved, movedAgain);

    expect(again.layers.map(({ rest }) => rest)).toEqual([zoomedIn, movedAgain]);
    expect(layerDrawn(again, skipped)).toEqual(again);
  });

  it("shows the page's ink everywhere before letting the layers go once zoomed out", () => {
    const zoomed = drawnAt(noSharpLayers, zoomedIn);
    const pending = restedAt(zoomed, movedOn);

    const zoomedOut = restedAt(pending, fitted);

    expect(zoomedOut.inkHiddenIn).toBeNull();
    expect(zoomedOut.layers.map(({ rest }) => rest)).toEqual([zoomedIn]);
    expect(layerDrawn(zoomedOut, pending.layers[1]?.key ?? -1)).toEqual(zoomedOut);
    expect(cleared(zoomedOut).layers).toEqual([]);
  });

  it("keeps the layers of a page that rests zoomed in", () => {
    const zoomed = drawnAt(noSharpLayers, zoomedIn);

    expect(cleared(zoomed)).toEqual(zoomed);
  });
});

describe("SharpDrawing", () => {
  it("draws the part of a page a rest shows at its zoom, sharp", async () => {
    const rest: Rest = { x: 40, y: 150, width: 120, height: 80, zoom: 4 };
    const { ruling } = dayLayout("2026-11-17", a4Portrait);
    const skia = getSkiaExports().Skia as unknown as typeof Skia;
    const drawing = (
      <SharpDrawing rest={rest}>
        <PageDrawing size={a4Portrait} ruling={ruling} />
        <InkDrawing skia={skia} strokes={[diagonal]} />
      </SharpDrawing>
    );

    await expectToMatchGoldenImage("sharp-layer-day-page", drawing, { width: 480, height: 320 });
  });
});

function drawnAt(sharp: typeof noSharpLayers, rest: Rest) {
  const resting = restedAt(sharp, rest);
  return layerDrawn(resting, resting.layers.at(-1)?.key ?? -1);
}

const diagonal = create(StrokeSchema, {
  id: "stroke-1",
  pageId: "day:2026-11-17",
  drawnAt: timestampFromMs(0),
  input: Input.PENCIL,
  tool: Tool.MONOLINE,
  colour: 0x1a1a1a,
  size: 1.4,
  samples: encodeSamples({
    x: [55, 80, 105, 130, 150],
    y: [165, 180, 190, 205, 215],
    time: [0, 10, 20, 30, 40],
  }),
});

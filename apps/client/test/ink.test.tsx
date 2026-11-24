import { create } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import {
  decodeSamples,
  encodeSamples,
  fixtureStrokeAsStroke,
  readStrokeFixture,
  type StrokeSamples,
  strokeSampleLimit,
} from "@foyer/shared";
import { Input, StrokeSchema, Tool } from "@foyer/shared/gen/foyer/ink/v1/ink_pb";
import { strokeFixtures } from "@foyer/shared/stroke-fixtures";
import { Group, type Skia } from "react-native-skia";
import { getSkiaExports } from "react-native-skia/lib/commonjs/headless";
import { describe, expect, it } from "vitest";
import { strokesCrossed } from "../src/ink/eraser";
import { InkDrawing, inDrawingOrder } from "../src/ink/ink-drawing";
import { inkWidth, pencilKitSizeFor } from "../src/ink/ink-width";
import { samplesInPieces } from "../src/ink/stroke-pieces";
import { expectToMatchGoldenImage } from "./golden-image";

let nextId = 0;

function stroke(
  samples: StrokeSamples,
  brush: { tool?: Tool; colour?: number; size?: number; drawnAt?: number; id?: string } = {},
) {
  nextId += 1;
  const { drawnAt = 0, id = `stroke-${String(nextId).padStart(3, "0")}`, ...rest } = brush;
  return create(StrokeSchema, {
    id,
    pageId: "day:2026-11-23",
    drawnAt: timestampFromMs(drawnAt),
    input: Input.PENCIL,
    tool: Tool.PEN,
    colour: 0x1a1a1a,
    size: 1.4,
    samples: encodeSamples(samples),
    ...rest,
  });
}

function wave(left: number, top: number, count: number, force?: (index: number) => number) {
  const indexes = Array.from({ length: count }, (_, index) => index);
  return {
    x: indexes.map((index) => left + index * 2),
    y: indexes.map((index) => top + Math.sin(index / 4) * 8),
    time: indexes.map((index) => index * 4),
    ...(force ? { force: indexes.map(force) } : {}),
  };
}

describe("inkWidth", () => {
  it("draws a monoline at its size, whatever the pressure", () => {
    expect(inkWidth(Tool.MONOLINE, 2, 0)).toBe(2);
    expect(inkWidth(Tool.MONOLINE, 2, 1)).toBe(2);
  });

  it("draws a pen at its size without pressure, growing as PencilKit's pen does", () => {
    expect(inkWidth(Tool.PEN, 1.4)).toBeCloseTo(1.4);
    expect(inkWidth(Tool.PEN, 1.4, 0.5)).toBeCloseTo(2 * (2.7 * 1.185) - 4);
    expect(inkWidth(Tool.PEN, 1.4, 1)).toBeCloseTo(2 * (2.7 * 1.37) - 4);
  });

  it("gives the point size PencilKit draws a line of a width with", () => {
    expect(pencilKitSizeFor(1.4)).toBeCloseTo(2.7);
    expect(inkWidth(Tool.PEN, 2 * pencilKitSizeFor(3) - 4)).toBeCloseTo(
      2 * pencilKitSizeFor(3) - 4,
    );
  });
});

describe("inDrawingOrder", () => {
  it("stacks strokes in the order the pen touched down, then by id", () => {
    const late = stroke(wave(0, 0, 2), { drawnAt: 2000, id: "a" });
    const early = stroke(wave(0, 0, 2), { drawnAt: 1000, id: "c" });
    const alongside = stroke(wave(0, 0, 2), { drawnAt: 1000, id: "b" });

    expect(inDrawingOrder([late, early, alongside]).map(({ id }) => id)).toEqual(["b", "c", "a"]);
  });
});

describe("strokesCrossed", () => {
  const across = stroke({ x: [100, 200], y: [100, 100], time: [0, 100] });
  const below = stroke({ x: [100, 200], y: [140, 140], time: [0, 100] });
  const dot = stroke({ x: [300], y: [300], time: [0] });

  it("finds the strokes the eraser passes over", () => {
    const crossed = strokesCrossed([across, below, dot], { x: 150, y: 80 }, { x: 150, y: 120 }, 4);

    expect(crossed).toEqual([across.id]);
  });

  it("reaches as far as the eraser and the ink's own width, and no further", () => {
    const beside = { x: 150, y: 100 + 4 + inkWidth(Tool.PEN, 1.4, 1) / 2 };

    expect(strokesCrossed([across], beside, beside, 4)).toEqual([across.id]);
    expect(strokesCrossed([across], { x: beside.x, y: beside.y + 0.1 }, beside, 4)).toEqual([
      across.id,
    ]);
    expect(
      strokesCrossed([across], { x: 150, y: beside.y + 1 }, { x: 150, y: beside.y + 1 }, 4),
    ).toEqual([]);
  });

  it("finds a stroke of one sample", () => {
    expect(strokesCrossed([dot], { x: 290, y: 300 }, { x: 310, y: 300 }, 2)).toEqual([dot.id]);
  });
});

describe("InkDrawing", () => {
  it("draws pens wider where they pressed harder, and monolines evenly, in their colours", async () => {
    const strokes = [
      stroke(wave(10, 20, 60, (index) => index / 59)),
      stroke(wave(10, 50, 60), { tool: Tool.MONOLINE, colour: 0x2255aa, size: 2 }),
      stroke({ x: [140], y: [80], time: [0] }, { colour: 0xb0302a, size: 6 }),
    ];

    await expectToMatchGoldenImage(
      "ink-strokes",
      <InkDrawing skia={getSkiaExports().Skia as unknown as typeof Skia} strokes={strokes} />,
      {
        width: 160,
        height: 100,
      },
    );
  });

  it("draws strokes that turn back on themselves or widen suddenly whole, with round turns", async () => {
    const strokes = [
      stroke(
        { x: [14, 34, 16, 36, 18, 38], y: [14, 22, 30, 38, 46, 54], time: [0, 8, 16, 24, 32, 40] },
        { tool: Tool.MONOLINE, size: 14 },
      ),
      stroke(
        {
          x: [70, 74, 78, 82, 86],
          y: [60, 60, 60, 60, 60],
          time: [0, 4, 8, 12, 16],
          force: [0.02, 1, 0.02, 1, 0.02],
        },
        { size: 8, colour: 0x2255aa },
      ),
    ];

    await expectToMatchGoldenImage(
      "ink-turns",
      <InkDrawing skia={getSkiaExports().Skia as unknown as typeof Skia} strokes={strokes} />,
      { width: 160, height: 100 },
    );
  });
});

const fixtureScale = 2;
const fixtureMargin = 12;

it.each(Object.entries(strokeFixtures))(
  "draws the recorded %s stroke fixture as Skia draws it",
  async (name, json) => {
    const strokes = readStrokeFixture(json).map((recorded, index) =>
      fixtureStrokeAsStroke(recorded, {
        id: `stroke-${String(index).padStart(3, "0")}`,
        pageId: "day:2026-11-24",
        drawnBy: "",
      }),
    );
    const decoded = strokes.map(({ samples }) => decodeSamples(samples));
    const left = Math.min(...decoded.flatMap(({ x }) => x)) - fixtureMargin;
    const top = Math.min(...decoded.flatMap(({ y }) => y)) - fixtureMargin;
    const right = Math.max(...decoded.flatMap(({ x }) => x)) + fixtureMargin;
    const bottom = Math.max(...decoded.flatMap(({ y }) => y)) + fixtureMargin;

    await expectToMatchGoldenImage(
      `stroke-fixture-${name}`,
      <Group transform={[{ scale: fixtureScale }, { translateX: -left }, { translateY: -top }]}>
        <InkDrawing skia={getSkiaExports().Skia as unknown as typeof Skia} strokes={strokes} />
      </Group>,
      {
        width: Math.ceil((right - left) * fixtureScale),
        height: Math.ceil((bottom - top) * fixtureScale),
      },
    );
  },
);

describe("samplesInPieces", () => {
  const drawn = (count: number, pressed: boolean) => {
    const values = Array.from({ length: count }, (_, index) => index);
    return {
      x: values,
      y: values,
      time: values,
      force: pressed ? values.map((value) => value / count) : [],
      altitude: [],
      azimuth: [],
    };
  };

  it("keeps a stroke of up to 10,000 samples whole, leaving out what wasn't reported", () => {
    const [piece, ...more] = samplesInPieces(drawn(strokeSampleLimit, false));

    expect(more).toEqual([]);
    expect(piece?.x).toHaveLength(strokeSampleLimit);
    expect(piece).not.toHaveProperty("force");
    expect(piece).not.toHaveProperty("altitude");
  });

  it("splits a longer stroke into pieces that each start where the one before ended", () => {
    const pieces = samplesInPieces(drawn(2 * strokeSampleLimit, true));

    expect(pieces.map(({ x }) => x.length)).toEqual([strokeSampleLimit, strokeSampleLimit, 2]);
    expect(pieces.map(({ x }) => x[0])).toEqual([
      0,
      strokeSampleLimit - 1,
      2 * strokeSampleLimit - 2,
    ]);
    expect(pieces.every(({ force, x }) => force?.length === x.length)).toBe(true);
  });
});

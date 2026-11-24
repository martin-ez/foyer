import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import {
  decodeSamples,
  encodeSamples,
  fixtureStrokeAsStroke,
  readStrokeFixture,
  redrawnAt,
  strokeFixtureOf,
} from "@foyer/shared";
import { Input, StrokeSchema, Tool } from "@foyer/shared/gen/foyer/ink/v1/ink_pb";
import { strokeFixtures } from "@foyer/shared/stroke-fixtures";
import { describe, expect, it } from "vitest";

const degree = Math.PI / 180;

function drawn(overrides: MessageInitShape<typeof StrokeSchema> = {}) {
  return create(StrokeSchema, {
    id: "019a0000-0000-7000-8000-000000000001",
    pageId: "day:2026-11-24",
    drawnAt: timestampFromMs(Date.UTC(2026, 10, 24, 9, 30)),
    drawnBy: "019a0000-0000-7000-8000-0000000000aa",
    input: Input.PENCIL,
    tool: Tool.PEN,
    colour: 0x1f5fd6,
    size: 1.4,
    samples: encodeSamples({
      x: [100.25, 101.5, 103],
      y: [200, 200.75, 202.1],
      time: [0, 8, 16],
      force: [0.2, 0.45, 0.3],
      altitude: [50 * degree, 51 * degree, 52 * degree],
      azimuth: [140 * degree, 141 * degree, 141 * degree],
    }),
    ...overrides,
  });
}

describe("strokeFixtureOf and readStrokeFixture", () => {
  it("keep a stroke's brush, when it was drawn, and the very bytes of its samples", () => {
    const stroke = drawn();

    const [read] = readStrokeFixture(JSON.parse(JSON.stringify(strokeFixtureOf([stroke]))));

    expect(read).toEqual({
      drawnAt: Date.UTC(2026, 10, 24, 9, 30),
      input: Input.PENCIL,
      tool: Tool.PEN,
      colour: 0x1f5fd6,
      size: stroke.size,
      samples: stroke.samples,
    });
  });

  it("write the samples as numbers a diff shows, and leave out the stroke's id, page and member", () => {
    const [written] = strokeFixtureOf([drawn()]);

    expect(written).toEqual({
      drawnAt: "2026-11-24T09:30:00Z",
      input: "INPUT_PENCIL",
      tool: "TOOL_PEN",
      colour: 0x1f5fd6,
      size: expect.closeTo(1.4, 5),
      samples: {
        x: [10025, 125, 150],
        y: [20000, 75, 135],
        time: [0, 8, 8],
        force: [200, 250, -150],
        altitude: [5000, 100, 100],
        azimuth: [14000, 100, 0],
      },
    });
  });

  it("keep a black stroke's colour and leave out what a mouse can't report", () => {
    const samples = encodeSamples({ x: [1, 2], y: [3, 4], time: [0, 8] });
    const stroke = drawn({ input: Input.MOUSE, tool: Tool.MONOLINE, colour: 0, samples });

    const [written] = strokeFixtureOf([stroke]);
    const [read] = readStrokeFixture([written]);

    expect(written).toMatchObject({ colour: 0, samples: { x: [100, 100], y: [300, 100] } });
    expect(read).toMatchObject({ colour: 0, input: Input.MOUSE, tool: Tool.MONOLINE, samples });
  });

  it("refuse a stroke that couldn't be added", () => {
    const [written] = strokeFixtureOf([drawn()]);
    const tooWide = { ...written, size: 200 };
    const noSamples = { ...written, samples: {} };

    expect(() => readStrokeFixture([written, tooWide])).toThrow(/Stroke 2 .* at most 100 points/);
    expect(() => readStrokeFixture([noSamples])).toThrow(/at least one sample/);
    expect(() => readStrokeFixture({ strokes: [] })).toThrow(/list of strokes/);
  });
});

describe("redrawnAt", () => {
  it("draws the last stroke at the given time, keeping the time between strokes", () => {
    const strokes = readStrokeFixture(
      strokeFixtureOf([
        drawn({ drawnAt: timestampFromMs(1_000) }),
        drawn({ drawnAt: timestampFromMs(1_750) }),
        drawn({ drawnAt: timestampFromMs(4_000) }),
      ]),
    );

    expect(redrawnAt(strokes, 50_000)).toEqual([47_000, 47_750, 50_000]);
  });
});

describe("fixtureStrokeAsStroke", () => {
  it("makes the stroke a household holds, with the given id, page and member", () => {
    const stroke = drawn();
    const [read] = readStrokeFixture(strokeFixtureOf([stroke]));
    if (!read) throw new Error("No stroke read");

    const ids = { id: stroke.id, pageId: stroke.pageId, drawnBy: stroke.drawnBy };

    expect(fixtureStrokeAsStroke(read, ids)).toEqual(stroke);
  });
});

it.each(Object.entries(strokeFixtures))(
  "reads the recorded %s stroke fixture, whose samples decode",
  (_, json) => {
    const strokes = readStrokeFixture(json);

    expect(strokes.length).toBeGreaterThan(0);
    for (const { samples } of strokes) {
      expect(encodeSamples(decodeSamples(samples))).toEqual(samples);
    }
  },
);

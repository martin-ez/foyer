import { create, toBinary } from "@bufbuild/protobuf";
import {
  decodeSamples,
  encodeSamples,
  type StrokeSamples,
  samplesProblem,
  strokeProblem,
  strokeSampleLimit,
} from "@foyer/shared";
import { Input, SamplesSchema, Tool } from "@foyer/shared/gen/foyer/ink/v1/ink_pb";
import { describe, expect, it } from "vitest";

const degree = Math.PI / 180;

function handwritten(count: number): StrokeSamples {
  const indexes = Array.from({ length: count }, (_, index) => index);
  return {
    x: indexes.map((index) => 120.5 + index * 0.37),
    y: indexes.map((index) => 300.25 + Math.sin(index / 9) * 6),
    time: indexes.map((index) => Math.round(index * 4.17)),
    force: indexes.map((index) => 0.4 + Math.sin(index / 15) * 0.1),
    altitude: indexes.map((index) => (55 + index * 0.01) * degree),
    azimuth: indexes.map(() => 140 * degree),
  };
}

function expectClose(
  actual: readonly number[] | undefined,
  expected: readonly number[],
  within: number,
) {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((value, index) => {
    expect(Math.abs((actual?.[index] ?? Number.NaN) - value)).toBeLessThanOrEqual(within);
  });
}

function encoded(lists: Partial<Record<keyof StrokeSamples, number[]>>): Uint8Array {
  return toBinary(SamplesSchema, create(SamplesSchema, lists));
}

describe("encodeSamples and decodeSamples", () => {
  it("bring back each value to within its unit", () => {
    const samples = handwritten(50);

    const decoded = decodeSamples(encodeSamples(samples));

    expectClose(decoded.x, samples.x, 0.005);
    expectClose(decoded.y, samples.y, 0.005);
    expectClose(decoded.time, samples.time, 0);
    expectClose(decoded.force, samples.force ?? [], 0.0005);
    expectClose(decoded.altitude, samples.altitude ?? [], 0.005 * degree);
    expectClose(decoded.azimuth, samples.azimuth ?? [], 0.005 * degree);
  });

  it("leave out the values the device couldn't report", () => {
    const decoded = decodeSamples(encodeSamples({ x: [1, 2], y: [3, 4], time: [0, 8] }));

    expect(decoded).toEqual({ x: [1, 2], y: [3, 4], time: [0, 8] });
  });

  it("keep a handwritten stroke of half a second under a kilobyte", () => {
    expect(encodeSamples(handwritten(120)).length).toBeLessThan(1024);
  });

  it("refuse to encode lists of different lengths", () => {
    expect(() => encodeSamples({ x: [1, 2], y: [3], time: [0, 8] })).toThrow(
      "A stroke's lists of samples must all be the same length.",
    );
  });

  it("refuse to decode what samplesProblem refuses", () => {
    expect(() => decodeSamples(encoded({ x: [], y: [], time: [] }))).toThrow(
      "A stroke must have at least one sample.",
    );
  });
});

describe("samplesProblem", () => {
  it("accepts encoded samples", () => {
    expect(samplesProblem(encodeSamples(handwritten(3)))).toBeNull();
  });

  it.each([
    [
      "bytes that aren't a Samples message",
      new Uint8Array([0x0a, 0x05, 0x01]),
      "A stroke's samples must be an encoded Samples message.",
    ],
    ["no samples", encoded({}), "A stroke must have at least one sample."],
    [
      "too many samples",
      encoded({
        x: Array(strokeSampleLimit + 1).fill(1),
        y: Array(strokeSampleLimit + 1).fill(1),
        time: Array(strokeSampleLimit + 1).fill(1),
      }),
      "A stroke can have at most 10,000 samples.",
    ],
    [
      "fewer times than positions",
      encoded({ x: [1, 2], y: [1, 2], time: [0] }),
      "A stroke's x, y and time must have one value for each sample.",
    ],
    [
      "pressure for only some samples",
      encoded({ x: [1, 2], y: [1, 2], time: [0, 4], force: [500] }),
      "A stroke's force and tilt must have one value for each sample, or none.",
    ],
  ])("refuses %s", (_, samples, problem) => {
    expect(samplesProblem(samples)).toBe(problem);
  });
});

describe("strokeProblem", () => {
  const stroke = {
    input: Input.PENCIL,
    tool: Tool.PEN,
    colour: 0x1a1a1a,
    size: 2,
    samples: encodeSamples(handwritten(3)),
  };

  it("accepts a stroke a device can add", () => {
    expect(strokeProblem(stroke)).toBeNull();
  });

  it.each([
    ["no input", { input: Input.UNSPECIFIED }, "A stroke must say what drew it."],
    ["no brush", { tool: Tool.UNSPECIFIED }, "A stroke must say which brush drew it."],
    [
      "a colour with transparency",
      { colour: 0x801a1a1a },
      "A stroke's colour must be an opaque colour, as 0xRRGGBB.",
    ],
    ["no width", { size: 0 }, "A stroke's size must be more than 0 and at most 100 points."],
    [
      "too wide a brush",
      { size: 101 },
      "A stroke's size must be more than 0 and at most 100 points.",
    ],
    ["samples it can't have", { samples: encoded({}) }, "A stroke must have at least one sample."],
  ])("refuses %s", (_, change, problem) => {
    expect(strokeProblem({ ...stroke, ...change })).toBe(problem);
  });
});

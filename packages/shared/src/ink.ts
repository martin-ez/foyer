import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { Input, type Samples, SamplesSchema, Tool } from "./gen/foyer/ink/v1/ink_pb";

/** A stroke's samples, one list per value, all of the same length: where the pen was, in points
 *  from the page's top-left corner, milliseconds from the pen touching down, how hard it pressed
 *  from 0 to 1, and its tilt in radians. Lists the device can't report are left out. */
export type StrokeSamples = {
  x: readonly number[];
  y: readonly number[];
  time: readonly number[];
  force?: readonly number[];
  altitude?: readonly number[];
  azimuth?: readonly number[];
};

/** The most samples a stroke can have. */
export const strokeSampleLimit = 10_000;

/** The widest a stroke's brush can be, in points. */
export const strokeSizeLimit = 100;

const degreesPerRadian = 180 / Math.PI;

const scales = {
  x: 100,
  y: 100,
  time: 1,
  force: 1000,
  altitude: 100 * degreesPerRadian,
  azimuth: 100 * degreesPerRadian,
} as const;

type Value = keyof typeof scales;

const optional: readonly Value[] = ["force", "altitude", "azimuth"];

/** Encodes samples as a stroke's `samples`: each value rounded to its unit, as the difference from
 *  the one before. Throws when the lists aren't all the same length. */
export function encodeSamples(samples: StrokeSamples): Uint8Array {
  const count = samples.x.length;
  const lengths = (Object.keys(scales) as Value[]).map((value) => samples[value]?.length ?? count);
  if (lengths.some((length) => length !== count)) {
    throw new Error("A stroke's lists of samples must all be the same length.");
  }
  const encode = (value: Value) => differences(samples[value] ?? [], scales[value]);
  return toBinary(
    SamplesSchema,
    create(SamplesSchema, {
      x: encode("x"),
      y: encode("y"),
      time: encode("time"),
      force: encode("force"),
      altitude: encode("altitude"),
      azimuth: encode("azimuth"),
    }),
  );
}

/** Reads a stroke's `samples` back into points, milliseconds, pressure and radians. Throws when
 *  they aren't samples a stroke can have, as `samplesProblem` says. */
export function decodeSamples(encoded: Uint8Array): StrokeSamples {
  const decoded = readSamples(encoded);
  if (typeof decoded === "string") throw new Error(decoded);
  return decoded;
}

/** Why encoded samples can't be a stroke's, or null if they can. */
export function samplesProblem(encoded: Uint8Array): string | null {
  const decoded = readSamples(encoded);
  return typeof decoded === "string" ? decoded : null;
}

/** Why a stroke can't be added with these values, or null if it can. */
export function strokeProblem(stroke: {
  input: Input;
  tool: Tool;
  colour: number;
  size: number;
  samples: Uint8Array;
}): string | null {
  if (!Object.values(Input).includes(stroke.input) || stroke.input === Input.UNSPECIFIED) {
    return "A stroke must say what drew it.";
  }
  if (!Object.values(Tool).includes(stroke.tool) || stroke.tool === Tool.UNSPECIFIED) {
    return "A stroke must say which brush drew it.";
  }
  if (!Number.isInteger(stroke.colour) || stroke.colour < 0 || stroke.colour > 0xffffff) {
    return "A stroke's colour must be an opaque colour, as 0xRRGGBB.";
  }
  if (!(stroke.size > 0 && stroke.size <= strokeSizeLimit)) {
    return `A stroke's size must be more than 0 and at most ${strokeSizeLimit} points.`;
  }
  return samplesProblem(stroke.samples);
}

function readSamples(encoded: Uint8Array): StrokeSamples | string {
  let message: Samples;
  try {
    message = fromBinary(SamplesSchema, encoded);
  } catch {
    return "A stroke's samples must be an encoded Samples message.";
  }
  const count = message.x.length;
  if (count === 0) return "A stroke must have at least one sample.";
  if (count > strokeSampleLimit) {
    return `A stroke can have at most ${strokeSampleLimit.toLocaleString("en")} samples.`;
  }
  if (message.y.length !== count || message.time.length !== count) {
    return "A stroke's x, y and time must have one value for each sample.";
  }
  if (optional.some((value) => ![0, count].includes(message[value].length))) {
    return "A stroke's force and tilt must have one value for each sample, or none.";
  }
  const read = (value: Value) => sums(message[value], scales[value]);
  const samples: StrokeSamples = { x: read("x"), y: read("y"), time: read("time") };
  for (const value of optional) {
    if (message[value].length > 0) Object.assign(samples, { [value]: read(value) });
  }
  return samples;
}

function differences(values: readonly number[], scale: number): number[] {
  let previous = 0;
  return values.map((value) => {
    const rounded = Math.round(value * scale);
    const difference = rounded - previous;
    previous = rounded;
    return difference;
  });
}

function sums(steps: readonly number[], scale: number): number[] {
  let total = 0;
  return steps.map((step) => {
    total += step;
    return total / scale;
  });
}

import { decodeSamples, type StrokeSamples } from "@foyer/shared";
import type { Stroke } from "@foyer/shared/gen/foyer/ink/v1/ink_pb";
import type { Skia, SkPath, SkPoint } from "react-native-skia";
import { inkWidth } from "./ink-width";

type Disc = { x: number; y: number; r: number };

const decoded = new WeakMap<Uint8Array, StrokeSamples>();
const outlines = new WeakMap<Uint8Array, SkPath>();

/** A stroke's samples, decoded once for each stroke. */
export function samplesOf(stroke: Stroke): StrokeSamples {
  const known = decoded.get(stroke.samples);
  if (known) return known;
  const samples = decodeSamples(stroke.samples);
  decoded.set(stroke.samples, samples);
  return samples;
}

/** The shape a stroke covers, to fill in its colour, made once for each stroke. As PencilKit draws
 *  it, it's a smooth curve through the samples, swept with a round nib as wide as the ink is at
 *  each sample. */
export function outlineOf(skia: typeof Skia, stroke: Stroke): SkPath {
  const known = outlines.get(stroke.samples);
  if (known) return known;
  const outline = sweep(skia, discsAlong(stroke));
  outlines.set(stroke.samples, outline);
  return outline;
}

function discsAlong(stroke: Stroke): Disc[] {
  const { x, y, force } = samplesOf(stroke);
  const r = x.map((_, index) => inkWidth(stroke.tool, stroke.size, force?.[index]) / 2);
  const count = x.length;
  if (count === 1) return [{ x: x[0] ?? 0, y: y[0] ?? 0, r: r[0] ?? 0 }];
  const discs: Disc[] = [];
  for (let index = 0; index < count - 1; index++) {
    const length = Math.hypot(at(x, index + 1) - at(x, index), at(y, index + 1) - at(y, index));
    const thinnest = Math.max(0.1, Math.min(at(r, index), at(r, index + 1)));
    const steps = Math.min(64, Math.max(1, Math.ceil(length / (thinnest * 0.5))));
    for (let step = 0; step < steps; step++) {
      const u = step / steps;
      discs.push({ x: spline(x, index, u), y: spline(y, index, u), r: spline(r, index, u) });
    }
  }
  discs.push({ x: at(x, count - 1), y: at(y, count - 1), r: at(r, count - 1) });
  return discs;
}

function sweep(skia: typeof Skia, discs: Disc[]): SkPath {
  const builder = skia.PathBuilder.Make();
  for (const { x, y, r } of discs) builder.addCircle(x, y, r);
  for (let index = 0; index < discs.length - 1; index++) {
    const from = discs[index] as Disc;
    const to = discs[index + 1] as Disc;
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (length < 1e-6) continue;
    const nx = -(to.y - from.y) / length;
    const ny = (to.x - from.x) / length;
    const side: SkPoint[] = [
      { x: from.x + nx * from.r, y: from.y + ny * from.r },
      { x: to.x + nx * to.r, y: to.y + ny * to.r },
      { x: to.x - nx * to.r, y: to.y - ny * to.r },
      { x: from.x - nx * from.r, y: from.y - ny * from.r },
    ];
    builder.addPoly(signedArea(side) < 0 ? side.reverse() : side, true);
  }
  return builder.build();
}

function at(values: readonly number[], index: number): number {
  const last = values.length - 1;
  if (index < 0) return 2 * (values[0] ?? 0) - (values[1] ?? 0);
  if (index > last) return 2 * (values[last] ?? 0) - (values[last - 1] ?? 0);
  return values[index] ?? 0;
}

function spline(values: readonly number[], index: number, u: number): number {
  const u2 = u * u;
  const u3 = u2 * u;
  return (
    ((1 - u) ** 3 * at(values, index - 1) +
      (3 * u3 - 6 * u2 + 4) * at(values, index) +
      (-3 * u3 + 3 * u2 + 3 * u + 1) * at(values, index + 1) +
      u3 * at(values, index + 2)) /
    6
  );
}

function signedArea(points: readonly SkPoint[]): number {
  let sum = 0;
  for (const [index, point] of points.entries()) {
    const next = points[(index + 1) % points.length] as SkPoint;
    sum += point.x * next.y - next.x * point.y;
  }
  return sum / 2;
}

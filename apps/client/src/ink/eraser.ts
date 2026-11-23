import type { Stroke } from "@foyer/shared/gen/foyer/ink/v1/ink_pb";
import type { Point } from "../page/sheet-camera";
import { inkWidth } from "./ink-width";
import { samplesOf } from "./stroke-outline";

/** How far from the Pencil's tip the eraser reaches, in points of the screen. */
export const eraserReach = 8;

type Bounds = { left: number; top: number; right: number; bottom: number };

const boundsOfStroke = new WeakMap<Uint8Array, Bounds>();

/** The ids of the strokes one move of the eraser, from one point to the next, passes over: within
 *  `reach` points of the page of their ink, counting the ink's own width. */
export function strokesCrossed(
  strokes: readonly Stroke[],
  from: Point,
  to: Point,
  reach: number,
): string[] {
  return strokes.filter((stroke) => crosses(stroke, from, to, reach)).map(({ id }) => id);
}

function crosses(stroke: Stroke, from: Point, to: Point, reach: number): boolean {
  const near = reach + inkWidth(stroke.tool, stroke.size, 1) / 2;
  const bounds = boundsOf(stroke);
  if (
    Math.max(from.x, to.x) < bounds.left - near ||
    Math.min(from.x, to.x) > bounds.right + near ||
    Math.max(from.y, to.y) < bounds.top - near ||
    Math.min(from.y, to.y) > bounds.bottom + near
  ) {
    return false;
  }
  const { x, y } = samplesOf(stroke);
  const point = (index: number): Point => ({ x: x[index] ?? 0, y: y[index] ?? 0 });
  if (x.length === 1) return distanceToSegment(point(0), from, to) <= near;
  for (let index = 0; index < x.length - 1; index++) {
    if (distanceBetweenSegments(point(index), point(index + 1), from, to) <= near) return true;
  }
  return false;
}

function boundsOf(stroke: Stroke): Bounds {
  const known = boundsOfStroke.get(stroke.samples);
  if (known) return known;
  const { x, y } = samplesOf(stroke);
  const bounds = {
    left: Math.min(...x),
    top: Math.min(...y),
    right: Math.max(...x),
    bottom: Math.max(...y),
  };
  boundsOfStroke.set(stroke.samples, bounds);
  return bounds;
}

function distanceBetweenSegments(a: Point, b: Point, c: Point, d: Point): number {
  if (segmentsCross(a, b, c, d)) return 0;
  return Math.min(
    distanceToSegment(a, c, d),
    distanceToSegment(b, c, d),
    distanceToSegment(c, a, b),
    distanceToSegment(d, a, b),
  );
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const side = (p: Point, q: Point, r: Point) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const abc = side(a, b, c);
  const abd = side(a, b, d);
  const cda = side(c, d, a);
  const cdb = side(c, d, b);
  return abc * abd < 0 && cda * cdb < 0;
}

function distanceToSegment(point: Point, from: Point, to: Point): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  const along =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared),
        );
  return Math.hypot(point.x - (from.x + along * dx), point.y - (from.y + along * dy));
}

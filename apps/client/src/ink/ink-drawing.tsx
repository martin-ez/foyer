import { timestampMs } from "@bufbuild/protobuf/wkt";
import type { Stroke } from "@foyer/shared/gen/foyer/ink/v1/ink_pb";
import { Path, type Skia } from "react-native-skia";
import { outlineOf } from "./stroke-outline";

/** Strokes drawn in their colours, in a page's own points, stacked in the order the pen touched
 *  down. */
export function InkDrawing({ skia, strokes }: { skia: typeof Skia; strokes: readonly Stroke[] }) {
  return (
    <>
      {inDrawingOrder(strokes).map((stroke) => (
        <Path key={stroke.id} path={outlineOf(skia, stroke)} color={colourOf(stroke)} />
      ))}
    </>
  );
}

/** Strokes in the order the pen touched down, with strokes drawn at the same moment settled by
 *  id. */
export function inDrawingOrder(strokes: readonly Stroke[]): Stroke[] {
  const drawnAt = (stroke: Stroke) => (stroke.drawnAt ? timestampMs(stroke.drawnAt) : 0);
  return [...strokes].sort((a, b) => drawnAt(a) - drawnAt(b) || a.id.localeCompare(b.id));
}

/** A stroke's colour as a CSS colour. */
export function colourOf(stroke: Stroke): string {
  return `#${stroke.colour.toString(16).padStart(6, "0")}`;
}

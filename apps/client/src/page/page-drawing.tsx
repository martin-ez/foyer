import type { PageSize } from "@foyer/shared";
import { Line, Rect } from "react-native-skia";

/** The colour of a page's paper. */
export const paperColour = "#fffdf8";

/** A rectangle on a page, in points from its top-left corner. */
export type Box = { x: number; y: number; width: number; height: number };

/** What's printed on a page's paper, such as a calendar's grid, in the page's own points: shaded
 *  boxes, with lines over them. */
export type Ruling = {
  shaded: readonly Box[];
  lines: readonly { from: { x: number; y: number }; to: { x: number; y: number } }[];
};

const shadeColour = "#f1ece1";
const lineColour = "#cfc6b4";

/** The Skia elements of a page, in the page's own coordinates: points from its top-left corner.
 *  The same on every device, at every zoom. */
export function PageDrawing({ size, ruling }: { size: PageSize; ruling?: Ruling }) {
  return (
    <>
      <Rect x={0} y={0} width={size.width} height={size.height} color={paperColour} />
      {ruling?.shaded.map((box) => (
        <Rect key={`${box.x},${box.y}`} {...box} color={shadeColour} />
      ))}
      {ruling?.lines.map(({ from, to }) => (
        <Line
          key={`${from.x},${from.y},${to.x},${to.y}`}
          p1={from}
          p2={to}
          color={lineColour}
          strokeWidth={1.5}
          style="stroke"
        />
      ))}
    </>
  );
}

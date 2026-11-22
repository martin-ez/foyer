import type { PageSize, Ruling } from "@foyer/shared";
import type { ReactNode } from "react";

export type { Box, Ruling } from "@foyer/shared";

import { Line, Rect } from "react-native-skia";

/** The colour of a page's paper. */
export const paperColour = "#fffdf8";

const shadeColour = "#f1ece1";
const lineColour = "#cfc6b4";

/** The Skia elements of a page, in the page's own coordinates: points from its top-left corner.
 *  The same on every device, at every zoom. `children` are Skia elements drawn on the page above
 *  what's printed on it, such as its text. */
export function PageDrawing({
  size,
  ruling,
  children,
}: {
  size: PageSize;
  ruling?: Ruling;
  children?: ReactNode;
}) {
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
      {children}
    </>
  );
}

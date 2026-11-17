import type { PageSize } from "@foyer/shared";
import { Rect } from "react-native-skia";

/** The colour of a page's paper. */
export const paperColour = "#fffdf8";

/** The Skia elements of a page, in the page's own coordinates: points from its top-left corner.
 *  The same on every device, at every zoom. */
export function PageDrawing({ size }: { size: PageSize }) {
  return <Rect x={0} y={0} width={size.width} height={size.height} color={paperColour} />;
}

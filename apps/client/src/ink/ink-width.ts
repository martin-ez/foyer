import { Tool } from "@foyer/shared/gen/foyer/ink/v1/ink_pb";

/** The width a monoline is drawn at, and a pen without pressure, in points. */
export const defaultInkSize = 1.4;

const penGrowth = 0.37;

/** How wide a stroke is drawn at a sample, in points: a monoline's size, or a pen's size at no
 *  pressure, growing with `force`, from 0 to 1, as PencilKit draws it. */
export function inkWidth(tool: Tool, size: number, force = 0): number {
  if (tool !== Tool.PEN) return size;
  return lineWidthOf(pencilKitSizeFor(size) * (1 + penGrowth * force));
}

/** The point size PencilKit's tool needs to draw a line `width` points wide: PencilKit draws a
 *  point of size s as a line 2s − 4 wide. */
export function pencilKitSizeFor(width: number): number {
  return width / 2 + 2;
}

function lineWidthOf(pencilKitSize: number): number {
  return Math.max(0, 2 * pencilKitSize - 4);
}

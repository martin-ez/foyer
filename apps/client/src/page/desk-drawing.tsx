import type { PageSize } from "@foyer/shared";
import { Fill, Group, Rect, Shadow } from "react-native-skia";
import { PageDrawing, paperColour, type Ruling } from "./page-drawing";
import type { Camera } from "./sheet-camera";

/** The colour of the desk around a page. */
export const deskColour = "#e9e4da";

/** The Skia elements of a page lying on the desk, where `camera` puts it, with what's printed on
 *  it. Everything on the page is drawn in one group, so it all moves and zooms together. */
export function DeskDrawing({
  page,
  ruling,
  camera,
}: {
  page: PageSize;
  ruling?: Ruling;
  camera: Camera;
}) {
  const { x, y, scale } = camera;
  return (
    <>
      <Fill color={deskColour} />
      <Rect x={x} y={y} width={page.width * scale} height={page.height * scale} color={paperColour}>
        <Shadow dx={0} dy={2} blur={8} color="rgba(0, 0, 0, 0.18)" />
      </Rect>
      <Group transform={[{ translateX: x }, { translateY: y }, { scale }]}>
        <PageDrawing size={page} ruling={ruling} />
      </Group>
    </>
  );
}

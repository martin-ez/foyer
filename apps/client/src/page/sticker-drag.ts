import { useMemo, useRef } from "react";
import { PanResponder, type ViewProps } from "react-native";
import { usePageScale } from "./page-scale";
import type { Point } from "./sheet-camera";

/** What a sticker hears as someone drags or taps it, in points of the page. */
export type StickerGestures = {
  /** The sticker is being dragged, `by` this far from where it started. */
  dragged(by: Point): void;
  /** The sticker was let go `by` this far from where it started. */
  dropped(by: Point): void;
  /** The sticker was tapped without being dragged. */
  tapped(): void;
  /** The drag stopped without the sticker being let go, as when the system takes the touch. */
  cancelled(): void;
};

/** How far a touch can move, in screen points, and still count as a tap. */
export const tapSlop = 4;

/** Lets a finger drag or tap a sticker on a page iOS zooms. While the finger is down, the page
 *  doesn't scroll. Returns the props for the sticker's view. */
export function useStickerDrag(gestures: StickerGestures, enabled: boolean): ViewProps {
  const latest = useRef({ gestures, enabled });
  latest.current = { gestures, enabled };
  const scale = usePageScale();
  const responder = useMemo(() => {
    const onPage = (dx: number, dy: number) => ({ x: dx / scale(), y: dy / scale() });
    return PanResponder.create({
      onStartShouldSetPanResponder: () => latest.current.enabled,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, { dx, dy }) => latest.current.gestures.dragged(onPage(dx, dy)),
      onPanResponderRelease: (_, { dx, dy }) => {
        if (Math.hypot(dx, dy) < tapSlop) latest.current.gestures.tapped();
        else latest.current.gestures.dropped(onPage(dx, dy));
      },
      onPanResponderTerminate: () => latest.current.gestures.cancelled(),
    });
  }, [scale]);
  return responder.panHandlers;
}

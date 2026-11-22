import type { PageSize } from "@foyer/shared";
import { type ReactNode, useCallback, useRef, useState } from "react";
import {
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { Canvas } from "react-native-skia";
import { deskColour } from "./desk-drawing";
import { PageDrawing, type Ruling } from "./page-drawing";
import { PageScale } from "./page-scale";
import { type Point, type Size, zoomLimits } from "./sheet-camera";
import { tapSlop } from "./sticker-drag";

/** A page lying on the desk, fitted to it at first, in a view that iOS zooms and moves as one sheet,
 *  so everything on the page moves with it in every frame of a pinch. A touch that moves or zooms
 *  the page isn't a tap. */
export function PageSheet({
  size,
  ruling,
  drawn,
  label,
  onPoint,
  onTap,
  children,
}: {
  size: PageSize;
  /** What's printed on the page, such as a calendar's grid. */
  ruling?: Ruling;
  /** Skia elements drawn on the page above what's printed on it, in its own points, such as its
   *  text. */
  drawn?: ReactNode;
  label: string;
  /** Called with each touch on the page, in points from its top-left corner. */
  onPoint?: (at: Point) => void;
  /** Called when the page itself is tapped, rather than something on it, in points from its
   *  top-left corner. */
  onTap?: (at: Point) => void;
  /** Views above the page, laid out in its own points. Only those that ask for touches, such as
   *  stickers, take them. */
  children?: ReactNode;
}) {
  const [view, setView] = useState<Size | null>(null);
  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setView({ width, height });
  };
  const limits = view && zoomLimits(view, size);
  const fitted = useRef(1);
  fitted.current = limits?.smallest || 1;
  const zoomed = useRef<number | null>(null);
  const scale = useCallback(() => zoomed.current ?? fitted.current, []);
  const followZoom = ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { zoomScale } = nativeEvent;
    if (zoomScale !== undefined && zoomScale > 0) zoomed.current = zoomScale;
  };
  const sheet = { width: size.width, height: size.height };
  const touched = ({ nativeEvent }: GestureResponderEvent) => {
    const at = { x: nativeEvent.locationX, y: nativeEvent.locationY };
    if (at.x >= 0 && at.y >= 0 && at.x <= size.width && at.y <= size.height) onPoint?.(at);
  };
  const tapFrom = useRef<Point | null>(null);
  const tapped = ({ nativeEvent }: GestureResponderEvent) => {
    const from = tapFrom.current;
    tapFrom.current = null;
    if (!from || Math.hypot(nativeEvent.pageX - from.x, nativeEvent.pageY - from.y) >= tapSlop) {
      return;
    }
    onTap?.({ x: nativeEvent.locationX, y: nativeEvent.locationY });
  };

  return (
    <View style={styles.desk} onLayout={onLayout} accessibilityLabel={label}>
      {limits && limits.smallest > 0 ? (
        <ScrollView
          style={styles.desk}
          contentContainerStyle={sheet}
          minimumZoomScale={limits.smallest}
          maximumZoomScale={limits.largest}
          zoomScale={limits.smallest}
          centerContent
          bouncesZoom
          onScroll={followZoom}
          scrollEventThrottle={16}
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
        >
          <View style={[sheet, styles.paper]} onTouchStart={touched} onTouchMove={touched}>
            <View
              style={sheet}
              onStartShouldSetResponder={() => onTap !== undefined}
              onResponderGrant={({ nativeEvent }) => {
                tapFrom.current = { x: nativeEvent.pageX, y: nativeEvent.pageY };
              }}
              onResponderRelease={tapped}
              onResponderTerminate={() => {
                tapFrom.current = null;
              }}
            >
              <Canvas style={sheet}>
                <PageDrawing size={size} ruling={ruling}>
                  {drawn}
                </PageDrawing>
              </Canvas>
            </View>
            <View style={[sheet, styles.above]}>
              <PageScale value={scale}>{children}</PageScale>
            </View>
          </View>
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  desk: { flex: 1, backgroundColor: deskColour },
  paper: { boxShadow: "0 2px 8px rgba(0, 0, 0, 0.18)" },
  above: { position: "absolute", left: 0, top: 0, pointerEvents: "box-none" },
});

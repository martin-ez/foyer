import type { PageSize } from "@foyer/shared";
import { type ReactNode, useState } from "react";
import {
  type GestureResponderEvent,
  type LayoutChangeEvent,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { Canvas } from "react-native-skia";
import { deskColour } from "./desk-drawing";
import { PageDrawing } from "./page-drawing";
import { type Point, type Size, zoomLimits } from "./sheet-camera";

/** A page lying on the desk, fitted to it at first, in a view that iOS zooms and moves as one sheet,
 *  so everything on the page moves with it in every frame of a pinch. */
export function PageSheet({
  size,
  label,
  onPoint,
  children,
}: {
  size: PageSize;
  label: string;
  /** Called with each touch on the page, in points from its top-left corner. */
  onPoint?: (at: Point) => void;
  /** Views above the page, laid out in its own points, which never take touches. */
  children?: ReactNode;
}) {
  const [view, setView] = useState<Size | null>(null);
  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setView({ width, height });
  };
  const limits = view && zoomLimits(view, size);
  const sheet = { width: size.width, height: size.height };
  const touched = ({ nativeEvent }: GestureResponderEvent) => {
    const at = { x: nativeEvent.locationX, y: nativeEvent.locationY };
    if (at.x >= 0 && at.y >= 0 && at.x <= size.width && at.y <= size.height) onPoint?.(at);
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
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
        >
          <View style={[sheet, styles.paper]} onTouchStart={touched} onTouchMove={touched}>
            <Canvas style={sheet}>
              <PageDrawing size={size} />
            </Canvas>
            <View style={[sheet, styles.above]}>{children}</View>
          </View>
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  desk: { flex: 1, backgroundColor: deskColour },
  paper: { boxShadow: "0 2px 8px rgba(0, 0, 0, 0.18)" },
  above: { position: "absolute", left: 0, top: 0, pointerEvents: "none" },
});

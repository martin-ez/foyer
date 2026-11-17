import type { PageSize } from "@foyer/shared";
import { useState } from "react";
import { type LayoutChangeEvent, ScrollView, StyleSheet, View } from "react-native";
import { Canvas } from "react-native-skia";
import { deskColour } from "./desk-drawing";
import { PageDrawing } from "./page-drawing";
import { type Size, zoomLimits } from "./sheet-camera";

/** A page lying on the desk, fitted to it at first: a canvas of the page's own size inside a view
 *  that iOS zooms and moves as one sheet, so everything on the page moves with it in every frame of
 *  a pinch, the bounce included. */
export function PageSheet({ size, label }: { size: PageSize; label: string }) {
  const [view, setView] = useState<Size | null>(null);
  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setView({ width, height });
  };
  const limits = view && zoomLimits(view, size);
  const sheet = { width: size.width, height: size.height };

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
          <View style={[sheet, styles.paper]}>
            <Canvas style={sheet}>
              <PageDrawing size={size} />
            </Canvas>
          </View>
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  desk: { flex: 1, backgroundColor: deskColour },
  paper: { boxShadow: "0 2px 8px rgba(0, 0, 0, 0.18)" },
});

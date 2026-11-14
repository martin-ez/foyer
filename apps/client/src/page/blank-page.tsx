import { appName } from "@foyer/shared";
import { useState } from "react";
import { type LayoutChangeEvent, StyleSheet, View } from "react-native";
import { Canvas } from "react-native-skia";
import { BlankPageDrawing } from "./blank-page-drawing";

/** One empty page, drawn by Skia and centred on the desk. */
export function BlankPage() {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize({ width, height });
  };

  return (
    <View style={styles.fill} onLayout={onLayout} accessibilityLabel={`${appName} page`}>
      <Canvas style={styles.fill}>
        <BlankPageDrawing width={size.width} height={size.height} />
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});

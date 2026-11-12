import { appName } from "@foyer/shared";
import { useState } from "react";
import { type LayoutChangeEvent, StyleSheet, View } from "react-native";
import { Canvas, Fill, RoundedRect, Shadow } from "react-native-skia";

/** Placeholder shape (width over height) until the page size is chosen. */
const pageAspect = 3 / 4;
const margin = 24;

/** One empty page, drawn by Skia and centred on the desk. */
export function BlankPage() {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize({ width, height });
  };

  const page = fitPage(size.width - margin * 2, size.height - margin * 2);
  const x = (size.width - page.width) / 2;
  const y = (size.height - page.height) / 2;

  return (
    <View style={styles.fill} onLayout={onLayout} accessibilityLabel={`${appName} page`}>
      <Canvas style={styles.fill}>
        <Fill color="#e9e4da" />
        <RoundedRect x={x} y={y} width={page.width} height={page.height} r={6} color="#fffdf8">
          <Shadow dx={0} dy={2} blur={8} color="rgba(0, 0, 0, 0.18)" />
        </RoundedRect>
      </Canvas>
    </View>
  );
}

function fitPage(maxWidth: number, maxHeight: number) {
  if (maxWidth <= 0 || maxHeight <= 0) return { width: 0, height: 0 };
  const width = Math.min(maxWidth, maxHeight * pageAspect);
  return { width, height: width / pageAspect };
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});

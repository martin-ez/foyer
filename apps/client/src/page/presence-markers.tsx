import { useEffect, useState } from "react";
import { Animated, Easing, Platform, StyleSheet, Text } from "react-native";
import { pointInterval } from "../sync/live-lane";
import { type Marker, markerSize } from "./presence";

const useNativeDriver = Platform.OS !== "web";

/** The others on a page, each as a marker with its pointed corner on their spot, gliding to each
 *  new one. Drawn in the page's own coordinates, so a `PageSheet` holds them. */
export function PresenceMarkers({ markers }: { markers: readonly Marker[] }) {
  return markers.map((marker) => <PresenceMarker key={marker.memberId} marker={marker} />);
}

function PresenceMarker({ marker }: { marker: Marker }) {
  const { x, y } = marker.at;
  const [position] = useState(() => new Animated.ValueXY({ x, y }));
  useEffect(() => {
    const glide = Animated.timing(position, {
      toValue: { x, y },
      duration: pointInterval,
      easing: Easing.linear,
      useNativeDriver,
    });
    glide.start();
    return () => glide.stop();
  }, [position, x, y]);

  return (
    <Animated.View
      accessible
      accessibilityLabel={`${marker.name || "Someone"} is on this page`}
      style={[
        styles.marker,
        { backgroundColor: marker.colour, transform: position.getTranslateTransform() },
      ]}
    >
      <Text style={styles.initial}>{marker.initial}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  marker: {
    position: "absolute",
    left: 0,
    top: 0,
    width: markerSize,
    height: markerSize,
    borderRadius: markerSize / 2,
    borderTopLeftRadius: 0,
    borderWidth: 1.5,
    borderColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "none",
  },
  initial: { color: "#ffffff", fontSize: 13, fontWeight: "700" },
});

import { useEffect, useState } from "react";
import { StyleSheet, Text } from "react-native";
import { statusClient } from "./backend";
import { describeBackendStatus } from "./describe-backend-status";

/** A line saying whether the backend answers, checked once when it appears. */
export function BackendStatus() {
  const [line, setLine] = useState("Checking the backend…");

  useEffect(() => {
    let shown = true;
    describeBackendStatus(statusClient).then((description) => {
      if (shown) setLine(description);
    });
    return () => {
      shown = false;
    };
  }, []);

  return <Text style={styles.line}>{line}</Text>;
}

const styles = StyleSheet.create({
  line: { position: "absolute", left: 12, bottom: 8, fontSize: 12, color: "#6b6459" },
});

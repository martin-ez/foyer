import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

/** A box to tick, with the label screen readers announce, and what people read beside it. */
export function Checkbox({
  checked,
  label,
  onChange,
  children,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      aria-checked={checked}
      accessibilityLabel={label}
      hitSlop={6}
      onPress={() => onChange(!checked)}
      style={styles.row}
    >
      <CheckMark checked={checked} />
      {children}
    </Pressable>
  );
}

/** The box alone, ticked or not, for views that handle the press themselves. */
export function CheckMark({ checked }: { checked: boolean }) {
  return (
    <View style={[styles.box, checked ? styles.ticked : null]}>
      {checked ? <Text style={styles.tick}>✓</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  box: {
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
    borderColor: "#6b6459",
    borderWidth: 1.5,
    borderRadius: 3,
    overflow: "hidden",
  },
  ticked: { backgroundColor: "#6b6459" },
  tick: { color: "#fffdf8", fontSize: 11, lineHeight: 13, fontWeight: "700" },
});

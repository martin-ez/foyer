import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

/** A row of controls across the top of a view, wrapping onto more lines when it's narrow. */
export function Bar({ children }: { children: ReactNode }) {
  return <View style={styles.bar}>{children}</View>;
}

/** The bar along the top of a view: its controls, then the title of what it shows. */
export function TitleBar({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <Bar>
      {children}
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
    </Bar>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#fffdf8",
    borderBottomColor: "#d8d2c4",
    borderBottomWidth: 1,
  },
  title: { fontSize: 16, fontWeight: "600", flexGrow: 1 },
});

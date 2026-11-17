import { StyleSheet, Text, View } from "react-native";
import { TitleBar } from "../shell/bars";

/** The Notebook, which holds nothing yet. */
export function NotebookScreen() {
  return (
    <View style={styles.fill}>
      <TitleBar title="Notebook" />
      <View style={styles.empty}>
        <Text style={styles.line}>Note pages come later.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center" },
  line: { fontSize: 14, color: "#6b6459" },
});

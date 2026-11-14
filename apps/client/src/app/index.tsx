import { StyleSheet, View } from "react-native";
import { BackendStatus } from "../backend/backend-status";
import { BlankPage } from "../page/blank-page";

export default function Home() {
  return (
    <View style={styles.fill}>
      <BlankPage />
      <BackendStatus />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});

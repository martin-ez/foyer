import { Pressable, StyleSheet, Text, View } from "react-native";
import { CheckMark } from "../tasks/checkbox";
import { firstScreens, useFirstScreen } from "./first-screen";

/** A choice of what Foyer opens on when it starts on this device. */
export function FirstScreenPicker() {
  const [chosen, choose] = useFirstScreen();
  return (
    <View style={styles.picker} accessibilityRole="radiogroup" accessibilityLabel="Opens on">
      <Text style={styles.line}>Opens on, on this device</Text>
      {firstScreens.map(({ screen, name }) => (
        <Pressable
          key={screen}
          accessibilityRole="radio"
          aria-checked={screen === chosen}
          accessibilityLabel={name}
          hitSlop={4}
          onPress={() => choose(screen)}
          style={styles.choice}
        >
          <CheckMark checked={screen === chosen} />
          <Text style={styles.name}>{name}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  picker: { gap: 4 },
  choice: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { fontSize: 14 },
  line: { fontSize: 12, color: "#6b6459" },
});

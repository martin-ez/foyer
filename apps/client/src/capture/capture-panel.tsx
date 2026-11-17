import { limitItemTitle } from "@foyer/shared";
import { SpaceKind } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import { useState } from "react";
import { Button, StyleSheet, Text, TextInput, View } from "react-native";
import { useHousehold } from "../shell/household";

/** One field that adds a task to the member's Inbox with each title entered, then says which it
 *  added until the next is typed, and clears for it. Nothing asks for a space, a date or a kind. */
export function CapturePanel({ onClose }: { onClose: () => void }) {
  const { state, sync } = useHousehold();
  const [title, setTitle] = useState("");
  const [added, setAdded] = useState<string | null>(null);
  const inbox = state.spaces.find(({ kind }) => kind === SpaceKind.INBOX);
  const blocked = !inbox || sync.titleProblem(title) !== null;
  const add = () => {
    if (!inbox || blocked) return;
    sync.addTask(inbox.id, title);
    setTitle("");
    setAdded(title.trim());
  };

  return (
    <View style={styles.panel}>
      <TextInput
        style={styles.input}
        value={title}
        onChangeText={(text) => {
          setTitle(limitItemTitle(text));
          setAdded(null);
        }}
        onSubmitEditing={add}
        submitBehavior="submit"
        blurOnSubmit={false}
        autoFocus
        placeholder="Capture a task"
        accessibilityLabel="Capture"
      />
      <Button title="Add to Inbox" disabled={blocked} onPress={add} />
      <Button title="Close" onPress={onClose} />
      <Text style={styles.line} role="status" accessibilityLiveRegion="polite">
        {!inbox
          ? "Waiting for the household's spaces…"
          : added !== null
            ? `Added “${added}” to Inbox`
            : ""}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomColor: "#d8d2c4",
    borderBottomWidth: 1,
  },
  input: {
    flex: 1,
    minWidth: 160,
    borderColor: "#d8d2c4",
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  line: { fontSize: 12, color: "#6b6459" },
});

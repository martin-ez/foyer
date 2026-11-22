import type { TextBlockKind } from "@foyer/shared";
import { Button, Pressable, StyleSheet, Text, View } from "react-native";
import { Bar } from "../shell/bars";
import { blockKindNames } from "./page-text";
import type { TextEditing } from "./text-editing";

const kinds: TextBlockKind[] = [
  "paragraph",
  "heading1",
  "heading2",
  "heading3",
  "bulleted",
  "numbered",
];

/** The controls for a page's text, above it: adding text, and while a group is edited, the kind of
 *  the block the cursor is in, its nesting, bold and italic, splitting the group before that block,
 *  joining the group below onto it, and deleting it. Offline, it says text can't be changed. */
export function TextBar({
  editing,
  focusedKind,
  onSplit,
}: {
  editing: TextEditing;
  /** The kind of the block the cursor is in, if any. */
  focusedKind: TextBlockKind | null;
  /** Called to split the group before the block the cursor is in. */
  onSplit: () => void;
}) {
  if (!editing.editable) {
    return (
      <Bar>
        <Button title="Add text" disabled onPress={() => {}} />
        <Text style={styles.note}>Text can't be changed while offline.</Text>
      </Bar>
    );
  }
  if (editing.placing) {
    return (
      <Bar>
        <Text style={styles.note}>Tap the page where the text goes.</Text>
        <Button title="Cancel" onPress={editing.cancelPlacing} />
      </Bar>
    );
  }
  if (editing.groupId === null) {
    return (
      <Bar>
        <Button title="Add text" onPress={editing.startPlacing} />
      </Bar>
    );
  }
  const isList = focusedKind === "bulleted" || focusedKind === "numbered";
  return (
    <Bar>
      <View style={styles.kinds} accessibilityRole="radiogroup" accessibilityLabel="Block type">
        {kinds.map((kind) => {
          const picked = kind === focusedKind;
          return (
            <Pressable
              key={kind}
              accessibilityRole="radio"
              aria-checked={picked}
              disabled={focusedKind === null}
              onPress={() => editing.setKind(kind)}
              style={[styles.kind, picked ? styles.picked : null]}
            >
              <Text style={picked ? styles.pickedName : styles.name}>{blockKindNames[kind]}</Text>
            </Pressable>
          );
        })}
      </View>
      <Button title="Outdent" disabled={!isList} onPress={() => editing.indent(-1)} />
      <Button title="Indent" disabled={!isList} onPress={() => editing.indent(1)} />
      <Button
        title="Bold"
        disabled={focusedKind === null}
        onPress={() => editing.toggleStyle("bold")}
      />
      <Button
        title="Italic"
        disabled={focusedKind === null}
        onPress={() => editing.toggleStyle("italic")}
      />
      <Button title="Split here" disabled={!editing.canSplit} onPress={onSplit} />
      <Button title="Join the text below" disabled={!editing.canJoin} onPress={editing.joinBelow} />
      <Button title="Delete text" onPress={editing.remove} />
      <Button title="Done" onPress={editing.finish} />
    </Bar>
  );
}

const styles = StyleSheet.create({
  note: { fontSize: 14, color: "#6b6459" },
  kinds: {
    flexDirection: "row",
    flexWrap: "wrap",
    flexShrink: 1,
    maxWidth: "100%",
    borderColor: "#d8d2c4",
    borderWidth: 1,
    borderRadius: 4,
    overflow: "hidden",
  },
  kind: { paddingHorizontal: 10, paddingVertical: 6 },
  picked: { backgroundColor: "#ece6d8" },
  name: { fontSize: 13, color: "#3d3830" },
  pickedName: { fontSize: 13, color: "#3d3830", fontWeight: "600" },
});

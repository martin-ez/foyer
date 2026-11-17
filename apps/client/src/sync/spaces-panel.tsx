import { limitSpaceName } from "@foyer/shared";
import { type Space, SpaceKind } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import { useState } from "react";
import { Button, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { describeSpaceCalendar, shareReminder } from "../calendar/google-calendar";
import type { HouseholdSync, SyncState } from "./household-sync";

const kindLabels: Record<SpaceKind, string> = {
  [SpaceKind.UNSPECIFIED]: "",
  [SpaceKind.INBOX]: "Inbox",
  [SpaceKind.PERSONAL]: "Personal",
  [SpaceKind.SHARED]: "Shared",
};

/** The spaces the signed-in member `memberId` sees, with where each one's Google calendar stands,
 *  and ways to open their first page, and to create and rename them. */
export function SpacesPanel({
  state,
  sync,
  memberId,
  onOpen,
}: {
  state: SyncState;
  sync: HouseholdSync;
  memberId: string;
  onOpen: (spaceId: string) => void;
}) {
  return (
    <View style={styles.panel}>
      <Text style={styles.heading}>Spaces</Text>
      <ScrollView style={styles.list}>
        {state.spaces.map((space) => (
          <SpaceRow
            key={space.id}
            space={space}
            calendar={describeSpaceCalendar(space, memberId, state.members)}
            reminder={shareReminder(space, memberId)}
            problemWith={(name) => sync.nameProblem(name, space.id)}
            onRename={(name) => sync.renameSpace(space.id, name)}
            onOpen={() => onOpen(space.id)}
          />
        ))}
      </ScrollView>
      <NewSpace
        problemWith={(name) => sync.nameProblem(name)}
        onCreate={(kind, name) => sync.createSpace(kind, name)}
      />
      <Text style={styles.line}>
        Household: {state.members.map((member) => member.name).join(", ")}
      </Text>
    </View>
  );
}

function SpaceRow({
  space,
  calendar,
  reminder,
  problemWith,
  onRename,
  onOpen,
}: {
  space: Space;
  calendar: string | null;
  reminder: string | null;
  problemWith: (name: string) => string | null;
  onRename: (name: string) => void;
  onOpen: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const problem = draft === null ? null : problemWith(draft);
  const save = () => {
    if (draft === null || problem) return;
    if (draft.trim() !== space.name) onRename(draft);
    setDraft(null);
  };

  if (draft !== null) {
    return (
      <View>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, styles.grow]}
            value={draft}
            onChangeText={(text) => setDraft(limitSpaceName(text))}
            onSubmitEditing={save}
            accessibilityLabel={`New name for ${space.name}`}
            autoFocus
          />
          <Button title="Save" disabled={problem !== null} onPress={save} />
          <Button title="Cancel" onPress={() => setDraft(null)} />
        </View>
        {problem ? <Text style={styles.problem}>{problem}</Text> : null}
      </View>
    );
  }
  const name = space.kind === SpaceKind.INBOX ? "Inbox" : space.name;
  return (
    <View>
      <View style={styles.row}>
        <Text style={styles.grow}>{name}</Text>
        <Text style={styles.line}>{kindLabels[space.kind]}</Text>
        <Button title="Open" accessibilityLabel={`Open ${name}`} onPress={onOpen} />
        {space.kind === SpaceKind.INBOX ? null : (
          <Button
            title="Rename"
            accessibilityLabel={`Rename ${space.name}`}
            onPress={() => setDraft(space.name)}
          />
        )}
      </View>
      {calendar ? <Text style={styles.line}>{calendar}</Text> : null}
      {reminder ? <Text style={styles.line}>{reminder}</Text> : null}
    </View>
  );
}

function NewSpace({
  problemWith,
  onCreate,
}: {
  problemWith: (name: string) => string | null;
  onCreate: (kind: SpaceKind.PERSONAL | SpaceKind.SHARED, name: string) => void;
}) {
  const [name, setName] = useState("");
  const blocked = problemWith(name) !== null;
  const create = (kind: SpaceKind.PERSONAL | SpaceKind.SHARED) => {
    onCreate(kind, name);
    setName("");
  };

  return (
    <View style={styles.newSpace}>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={(text) => setName(limitSpaceName(text))}
        placeholder="New space's name"
        accessibilityLabel="New space's name"
      />
      <View style={styles.row}>
        <Button title="Create shared" disabled={blocked} onPress={() => create(SpaceKind.SHARED)} />
        <Button
          title="Create personal"
          disabled={blocked}
          onPress={() => create(SpaceKind.PERSONAL)}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: "absolute",
    top: 8,
    left: 12,
    width: 320,
    maxHeight: "80%",
    gap: 8,
    padding: 12,
    backgroundColor: "#fffdf8",
    borderColor: "#d8d2c4",
    borderWidth: 1,
  },
  heading: { fontSize: 16, fontWeight: "600" },
  line: { fontSize: 12, color: "#6b6459" },
  problem: { fontSize: 12, color: "#9a3b2e" },
  list: { flexGrow: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 2 },
  grow: { flex: 1 },
  newSpace: { gap: 4 },
  input: { borderColor: "#d8d2c4", borderWidth: 1, paddingHorizontal: 6, paddingVertical: 4 },
});

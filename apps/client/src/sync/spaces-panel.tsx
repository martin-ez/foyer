import { limitSpaceName } from "@foyer/shared";
import { type Space, SpaceKind } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import { useState } from "react";
import { Button, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { SyncStatus } from "./household-sync";
import { useHouseholdSync } from "./use-household-sync";

const statusLines: Record<SyncStatus, string> = {
  connecting: "Connecting…",
  "catching-up": "Catching up…",
  "up-to-date": "Up to date",
  offline: "Offline. Changes are sent once it's back.",
  "signed-out": "Signed out",
};

const kindLabels: Record<SpaceKind, string> = {
  [SpaceKind.UNSPECIFIED]: "",
  [SpaceKind.INBOX]: "Inbox",
  [SpaceKind.PERSONAL]: "Personal",
  [SpaceKind.SHARED]: "Shared",
};

/** The spaces the signed-in member sees, kept in sync with the household, with ways to create
 *  and rename them. Calls `onSignedOut` when the household says the session has ended. */
export function SpacesPanel({
  memberId,
  onSignedOut,
}: {
  memberId: string;
  onSignedOut: () => void;
}) {
  const { state, sync } = useHouseholdSync(memberId, onSignedOut);
  const unsaved = state.unsaved > 0 ? ` · ${state.unsaved} not saved yet` : "";

  return (
    <View style={styles.panel}>
      <Text style={styles.heading}>Spaces</Text>
      <Text style={styles.line}>
        {statusLines[state.status]}
        {unsaved}
      </Text>
      {state.problems.length > 0 ? (
        <View style={styles.problems}>
          {state.problems.map((problem) => (
            <Text key={problem} style={styles.problem}>
              {problem}
            </Text>
          ))}
          <Button title="Dismiss" onPress={() => sync.dismissProblems()} />
        </View>
      ) : null}
      <ScrollView style={styles.list}>
        {state.spaces.map((space) => (
          <SpaceRow
            key={space.id}
            space={space}
            problemWith={(name) => sync.nameProblem(name, space.id)}
            onRename={(name) => sync.renameSpace(space.id, name)}
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
  problemWith,
  onRename,
}: {
  space: Space;
  problemWith: (name: string) => string | null;
  onRename: (name: string) => void;
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
  return (
    <View style={styles.row}>
      <Text style={styles.grow}>{space.kind === SpaceKind.INBOX ? "Inbox" : space.name}</Text>
      <Text style={styles.line}>{kindLabels[space.kind]}</Text>
      {space.kind === SpaceKind.INBOX ? null : (
        <Button
          title="Rename"
          accessibilityLabel={`Rename ${space.name}`}
          onPress={() => setDraft(space.name)}
        />
      )}
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
  problems: { gap: 4 },
  problem: { fontSize: 12, color: "#9a3b2e" },
  list: { flexGrow: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 2 },
  grow: { flex: 1 },
  newSpace: { gap: 4 },
  input: { borderColor: "#d8d2c4", borderWidth: 1, paddingHorizontal: 6, paddingVertical: 4 },
});

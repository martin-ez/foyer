import { limitItemTitle } from "@foyer/shared";
import { type Item, ItemKind } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import { SpaceKind } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import { useState } from "react";
import { Button, StyleSheet, Text, TextInput, View } from "react-native";
import type { HouseholdSync, ItemsUnderDeleted, SyncState } from "../sync/household-sync";
import { itemsUnder } from "./task-lists";

/** Where a task sits among others: the task it's under, which can be opened, with a way to take it
 *  out, a way to add a task under it, and a search for another task to put it under. */
export function TaskNesting({
  task,
  state,
  sync,
  onOpenTask,
}: {
  task: Item;
  state: SyncState;
  sync: HouseholdSync;
  onOpenTask: (itemId: string) => void;
}) {
  const [newTitle, setNewTitle] = useState("");
  const [search, setSearch] = useState("");
  const parent = task.parentId ? state.items.get(task.parentId) : undefined;
  const blocked = sync.titleProblem(newTitle) !== null;
  const add = () => {
    if (blocked) return;
    sync.addTaskUnder(task.id, newTitle);
    setNewTitle("");
  };
  const excluded = new Set([task.id, task.parentId, ...itemsUnder(task.id, state.items.values())]);
  const wanted = search.trim().toLowerCase();
  const matches =
    wanted === ""
      ? []
      : [...state.items.values()]
          .filter(
            (item) =>
              item.kind === ItemKind.TASK &&
              !excluded.has(item.id) &&
              item.title.toLowerCase().includes(wanted),
          )
          .slice(0, 5);

  return (
    <View style={styles.section}>
      {parent ? (
        <View style={styles.row}>
          <Text style={styles.line}>Under “{parent.title}”</Text>
          <Button
            title="Open it"
            accessibilityLabel={`Open “${parent.title}”`}
            onPress={() => onOpenTask(parent.id)}
          />
          <Button
            title="Take it out"
            accessibilityLabel={`Take it out of “${parent.title}”`}
            onPress={() => sync.putUnder(task.id, null)}
          />
        </View>
      ) : null}
      <View style={styles.row}>
        <TextInput
          style={[styles.input, styles.grow]}
          value={newTitle}
          onChangeText={(text) => setNewTitle(limitItemTitle(text))}
          onSubmitEditing={add}
          placeholder="New task under it"
          accessibilityLabel="New task under it"
        />
        <Button title="Add under it" disabled={blocked} onPress={add} />
      </View>
      <TextInput
        style={styles.input}
        value={search}
        onChangeText={setSearch}
        placeholder="Put it under another task"
        accessibilityLabel="Put it under another task"
      />
      {matches.map((item) => {
        const elsewhere =
          item.spaceId !== task.spaceId ? ` in ${spaceName(state, item.spaceId)}` : "";
        return (
          <Button
            key={item.id}
            title={`Put under “${item.title}”${elsewhere}`}
            onPress={() => {
              sync.putUnder(task.id, item.id);
              setSearch("");
            }}
          />
        );
      })}
    </View>
  );
}

/** Deletes a task after asking. A task with items under it asks what becomes of them: deleted
 *  too, moved up to its own parent, or moved to the top of its space. */
export function DeleteTask({
  task,
  state,
  sync,
  onDeleted,
}: {
  task: Item;
  state: SyncState;
  sync: HouseholdSync;
  onDeleted: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const under = [...state.items.values()].filter(({ parentId }) => parentId === task.id).length;
  const parent = task.parentId ? state.items.get(task.parentId) : undefined;
  const remove = (what: ItemsUnderDeleted) => {
    sync.deleteTask(task.id, what);
    onDeleted();
  };
  if (!asking) return <Button title="Delete task" onPress={() => setAsking(true)} />;

  return (
    <View style={styles.row}>
      {under === 0 ? (
        <>
          <Text style={styles.line}>Delete this task and its stickers?</Text>
          <Button title="Delete" onPress={() => remove("delete")} />
        </>
      ) : (
        <>
          <Text style={styles.line}>
            Delete this task? It has {under === 1 ? "an item" : `${under} items`} under it.
          </Text>
          <Button title="Delete them too" onPress={() => remove("delete")} />
          {parent ? (
            <Button title={`Move them up to “${parent.title}”`} onPress={() => remove("move-up")} />
          ) : null}
          <Button
            title={`Move them to the top of ${spaceName(state, task.spaceId)}`}
            onPress={() => remove("to-top")}
          />
        </>
      )}
      <Button title="Keep it" onPress={() => setAsking(false)} />
    </View>
  );
}

function spaceName(state: SyncState, spaceId: string): string {
  const space = state.spaces.find(({ id }) => id === spaceId);
  if (!space) return "its space";
  return space.kind === SpaceKind.INBOX ? "the Inbox" : space.name;
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  line: { fontSize: 12, color: "#6b6459" },
  grow: { flex: 1, minWidth: 120 },
  input: { borderColor: "#d8d2c4", borderWidth: 1, paddingHorizontal: 6, paddingVertical: 4 },
});

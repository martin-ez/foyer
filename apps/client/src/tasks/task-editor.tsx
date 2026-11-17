import { isIsoDate, limitItemDescription, limitItemTitle } from "@foyer/shared";
import type { Item } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import { SpaceKind } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import { useState } from "react";
import { Button, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { HouseholdSync, SyncState } from "../sync/household-sync";
import { Checkbox } from "./checkbox";

/** A task's title, description and date to edit and save, with a checkbox to tick it, and ways to
 *  move it to another space the member sees, delete it after asking, and show it on its space's
 *  page. */
export function TaskEditor({
  task,
  done,
  state,
  sync,
  onShowOnPage,
  onClose,
}: {
  task: Item;
  done: boolean;
  state: SyncState;
  sync: HouseholdSync;
  /** Opens the page of the space the task is in, numbered from 1. */
  onShowOnPage: (spaceId: string, pageNumber: number) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [date, setDate] = useState(task.date);
  const [deleting, setDeleting] = useState(false);
  const problem =
    sync.titleProblem(title) ??
    (date !== "" && !isIsoDate(date) ? "A date is a day, as in 2026-11-17." : null);
  const changed =
    title.trim() !== task.title || description !== task.description || date !== task.date;
  const save = () => {
    if (problem) return;
    if (title.trim() !== task.title) sync.setTitle(task.id, title);
    if (description !== task.description) sync.setDescription(task.id, description);
    if (date !== task.date) sync.setDate(task.id, date);
  };
  const others = state.spaces.filter(({ id }) => id !== task.spaceId);

  return (
    <View style={styles.panel} accessibilityLabel={`Task: ${task.title}`}>
      <ScrollView contentContainerStyle={styles.form}>
        <Checkbox
          checked={done}
          label="Done"
          onChange={(ticked) => (ticked ? sync.tickTask(task.id) : sync.untickTask(task.id))}
        >
          <Text style={styles.line}>Done</Text>
        </Checkbox>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={(text) => setTitle(limitItemTitle(text))}
          accessibilityLabel="Title"
        />
        <TextInput
          style={[styles.input, styles.description]}
          value={description}
          onChangeText={(text) => setDescription(limitItemDescription(text))}
          placeholder="Description"
          accessibilityLabel="Description"
          multiline
        />
        <TextInput
          style={styles.input}
          value={date}
          onChangeText={setDate}
          placeholder="Date, as in 2026-11-17"
          accessibilityLabel="Date"
        />
        {problem ? <Text style={styles.problem}>{problem}</Text> : null}
        <View style={styles.row}>
          <Button title="Save" disabled={!changed || problem !== null} onPress={save} />
          <Button title="Close" onPress={onClose} />
        </View>
        <Button
          title="Show on its page"
          onPress={() => {
            const sticker = [...state.stickers.values()].find(
              ({ itemId, pageId }) =>
                itemId === task.id && pageId.startsWith(`space:${task.spaceId}:`),
            );
            const number = Number(sticker?.pageId.split(":").at(-1) ?? 1);
            onShowOnPage(task.spaceId, number);
          }}
        />
        <Text style={styles.line}>Move to</Text>
        <View style={styles.row}>
          {others.map((space) => {
            const name = space.kind === SpaceKind.INBOX ? "Inbox" : space.name;
            return (
              <Button
                key={space.id}
                title={name}
                accessibilityLabel={`Move to ${name}`}
                onPress={() => sync.moveTask(task.id, space.id)}
              />
            );
          })}
        </View>
        {deleting ? (
          <View style={styles.row}>
            <Text style={styles.line}>Delete this task and its stickers?</Text>
            <Button
              title="Delete"
              onPress={() => {
                sync.deleteTask(task.id);
                onClose();
              }}
            />
            <Button title="Keep it" onPress={() => setDeleting(false)} />
          </View>
        ) : (
          <Button title="Delete task" onPress={() => setDeleting(true)} />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    maxHeight: "45%",
    backgroundColor: "#fffdf8",
    borderBottomColor: "#d8d2c4",
    borderBottomWidth: 1,
  },
  form: { gap: 8, padding: 12 },
  input: { borderColor: "#d8d2c4", borderWidth: 1, paddingHorizontal: 6, paddingVertical: 4 },
  description: { minHeight: 80, textAlignVertical: "top" },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  line: { fontSize: 12, color: "#6b6459" },
  problem: { fontSize: 12, color: "#9a3b2e" },
});

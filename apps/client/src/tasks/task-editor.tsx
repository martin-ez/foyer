import { isIsoDate, limitItemDescription, limitItemTitle } from "@foyer/shared";
import type { Item } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import { SpaceKind } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import { useState } from "react";
import { Button, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { localToday } from "../page/calendar-date";
import type { HouseholdSync, SyncState } from "../sync/household-sync";
import { Checkbox } from "./checkbox";
import { RepeatPicker } from "./repeat-picker";
import { firstDateOf, type RepeatChoice, repeatProblem } from "./repeats";
import { changedFields, shownFields, shownRepeat, type TaskEdits } from "./task-edits";

/** A task's fields and how it repeats, to edit and save without undoing changes made elsewhere,
 *  with ways to tick it, untick occurrences already done, move it, delete it after asking and show
 *  it on its space's page. Choosing how it repeats moves its date to the rule's first day. */
type TaskFieldsAsText = Pick<TaskEdits, "title" | "description" | "date">;

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
  const [edits, setEdits] = useState<TaskEdits>({});
  const [deleting, setDeleting] = useState(false);
  const { title, description, date } = shownFields(task, edits);
  const repeat = shownRepeat(task, edits);
  const changes = changedFields(task, edits);
  const today = localToday();
  const datedOrToday = isIsoDate(date) ? date : today;
  const problem =
    sync.titleProblem(title) ??
    (date !== "" && !isIsoDate(date) ? "A date is a day, as in 2026-11-17." : null) ??
    repeatProblem(repeat, date, today);
  const edit = (field: keyof TaskFieldsAsText, value: string) =>
    setEdits((before) => ({ ...before, [field]: value }));
  const chooseRepeat = (choice: RepeatChoice) =>
    setEdits((before) => {
      const shown = before.date ?? task.date;
      const first = firstDateOf(choice, isIsoDate(shown) ? shown : "", today);
      return { ...before, repeat: choice, ...(first && first !== shown ? { date: first } : {}) };
    });
  const save = () => {
    if (problem) return;
    const { rule, from } = changes.repeat ?? {};
    if (changes.title !== undefined) sync.setTitle(task.id, changes.title);
    if (changes.description !== undefined) sync.setDescription(task.id, changes.description);
    if (changes.repeat && !rule) sync.setRepeat(task.id, null, "schedule");
    if (changes.date !== undefined) sync.setDate(task.id, changes.date);
    if (rule && from) sync.setRepeat(task.id, rule, from);
    setEdits({});
  };
  const doneBefore = [...state.completions.values()]
    .filter(({ itemId, occurrence }) => itemId === task.id && occurrence !== "")
    .sort((a, b) => (a.occurrence < b.occurrence ? 1 : a.occurrence > b.occurrence ? -1 : 0))
    .slice(0, 5);
  const nameOf = (memberId: string) =>
    state.members.find(({ id }) => id === memberId)?.name ?? "someone";
  const others = state.spaces.filter(({ id }) => id !== task.spaceId);

  return (
    <View style={styles.panel} accessibilityLabel={`Task: ${task.title}`}>
      <ScrollView contentContainerStyle={styles.form}>
        <Checkbox
          checked={done}
          label="Done"
          onChange={(ticked) => (ticked ? sync.tickTask(task.id) : sync.untickTask(task.id))}
        >
          <Text style={styles.line}>{task.repeat ? `Done for ${task.date}` : "Done"}</Text>
        </Checkbox>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={(text) => edit("title", limitItemTitle(text))}
          accessibilityLabel="Title"
        />
        <TextInput
          style={[styles.input, styles.description]}
          value={description}
          onChangeText={(text) => edit("description", limitItemDescription(text))}
          placeholder="Description"
          accessibilityLabel="Description"
          multiline
        />
        <TextInput
          style={styles.input}
          value={date}
          onChangeText={(text) => edit("date", text)}
          placeholder="Date, as in 2026-11-17"
          accessibilityLabel="Date"
        />
        <RepeatPicker choice={repeat} date={datedOrToday} onChange={chooseRepeat} />
        {problem ? <Text style={styles.problem}>{problem}</Text> : null}
        <View style={styles.row}>
          <Button
            title="Save"
            disabled={Object.keys(changes).length === 0 || problem !== null}
            onPress={save}
          />
          <Button title="Close" onPress={onClose} />
        </View>
        {doneBefore.length > 0 ? (
          <View style={styles.history} accessibilityRole="list" accessibilityLabel="Done before">
            <Text style={styles.line}>Done before</Text>
            {doneBefore.map(({ id, occurrence, doneBy }) => (
              <View key={id} style={styles.row}>
                <Text style={styles.line}>
                  {occurrence}, ticked by {nameOf(doneBy)}
                </Text>
                <Button
                  title="Untick"
                  accessibilityLabel={`Untick ${occurrence}`}
                  onPress={() => sync.untickTask(task.id, occurrence)}
                />
              </View>
            ))}
          </View>
        ) : null}
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
  history: { gap: 4 },
  problem: { fontSize: 12, color: "#9a3b2e" },
});

import { limitItemTitle } from "@foyer/shared";
import { type Item, ItemKind } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import { CalendarState, SpaceKind } from "@foyer/shared/gen/foyer/space/v1/space_pb";
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
  const blocked = sync.titleProblem(newTitle) !== null;
  const add = () => {
    if (blocked) return;
    sync.addTaskUnder(task.id, newTitle);
    setNewTitle("");
  };

  return (
    <View style={styles.section}>
      <ParentOf item={task} state={state} sync={sync} onOpenTask={onOpenTask} />
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
      <PutUnderTask item={task} state={state} sync={sync} label="Put it under another task" />
    </View>
  );
}

/** Where an event sits among tasks: the task it's under, which can be opened, with a way to take
 *  it out, and a search for a task to put it under, in its own space or one with a Google
 *  calendar, where an event can go. */
/** Whether an event is an occurrence of a repeating series, which moves to another space only with
 *  its series, in Google Calendar. */
export function repeats(event: Item): boolean {
  return event.seriesId !== "";
}

export function EventNesting({
  event,
  state,
  sync,
  onOpenTask,
}: {
  event: Item;
  state: SyncState;
  sync: HouseholdSync;
  onOpenTask: (itemId: string) => void;
}) {
  const canGoIn = (spaceId: string) =>
    spaceId === event.spaceId ||
    (!repeats(event) &&
      state.spaces.some(
        ({ id, calendarState }) => id === spaceId && calendarState !== CalendarState.NONE,
      ));

  return (
    <View style={styles.section}>
      <ParentOf item={event} state={state} sync={sync} onOpenTask={onOpenTask} />
      <PutUnderTask
        item={event}
        state={state}
        sync={sync}
        label="Put it under a task"
        canGoIn={canGoIn}
      />
    </View>
  );
}

function ParentOf({
  item,
  state,
  sync,
  onOpenTask,
}: {
  item: Item;
  state: SyncState;
  sync: HouseholdSync;
  onOpenTask: (itemId: string) => void;
}) {
  const parent = item.parentId ? state.items.get(item.parentId) : undefined;
  if (!parent) return null;
  return (
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
        onPress={() => sync.putUnder(item.id, null)}
      />
    </View>
  );
}

function PutUnderTask({
  item,
  state,
  sync,
  label,
  canGoIn = () => true,
}: {
  item: Item;
  state: SyncState;
  sync: HouseholdSync;
  label: string;
  canGoIn?: (spaceId: string) => boolean;
}) {
  const [search, setSearch] = useState("");
  const excluded = new Set([item.id, item.parentId, ...itemsUnder(item.id, state.items.values())]);
  const wanted = search.trim().toLowerCase();
  const matches =
    wanted === ""
      ? []
      : [...state.items.values()]
          .filter(
            (task) =>
              task.kind === ItemKind.TASK &&
              !excluded.has(task.id) &&
              state.spaces.some(({ id }) => id === task.spaceId) &&
              canGoIn(task.spaceId) &&
              task.title.toLowerCase().includes(wanted),
          )
          .slice(0, 5);

  return (
    <>
      <TextInput
        style={styles.input}
        value={search}
        onChangeText={setSearch}
        placeholder={label}
        accessibilityLabel={label}
      />
      {matches.map((task) => {
        const elsewhere =
          task.spaceId !== item.spaceId ? ` in ${spaceName(state, task.spaceId)}` : "";
        return (
          <Button
            key={task.id}
            title={`Put under “${task.title}”${elsewhere}`}
            onPress={() => {
              sync.putUnder(item.id, task.id);
              setSearch("");
            }}
          />
        );
      })}
    </>
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

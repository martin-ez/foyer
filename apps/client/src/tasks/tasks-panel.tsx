import { type Item, ItemKind } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import { type Space, SpaceKind } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { describeEventTime, timeOf } from "../calendar/events";
import { localToday } from "../page/calendar-date";
import type { SyncState } from "../sync/household-sync";
import { Checkbox } from "./checkbox";
import { doneTasks, spaceTree, todayList } from "./task-lists";

/** The member's tasks, and the events under them, as lists: the Inbox, Today, then each other space,
 *  or only one space's, or Today, when `only` says so. Tasks can be ticked, and tapping a title
 *  opens it. Done tasks are left out unless `showDone` is on, and always from Today. */
export function TasksPanel({
  state,
  only,
  showDone,
  onShowDone,
  onOpenTask,
  onTick,
}: {
  state: SyncState;
  only?: { spaceId: string } | "today";
  showDone: boolean;
  onShowDone: (showDone: boolean) => void;
  onOpenTask: (itemId: string) => void;
  /** Called when a task's checkbox is tapped, with whether the task should now be done. */
  onTick: (itemId: string, done: boolean) => void;
}) {
  const items = [...state.items.values()];
  const stickers = [...state.stickers.values()];
  const done = doneTasks(state.items, state.completions.values());
  const spaces =
    only === undefined
      ? state.spaces
      : only === "today"
        ? []
        : state.spaces.filter(({ id }) => id === only.spaceId);
  const today = todayList(localToday(), state.spaces, items, stickers, done);
  const listOf = (spaceId: string) =>
    spaceTree(spaceId, items, stickers).filter(({ item }) => showDone || !done.has(item.id));
  const [inbox, ...others] = spaces;
  const list = { done, onOpenTask, onTick };

  return (
    <View style={styles.panel}>
      <ScrollView>
        {only === "today" ? null : (
          <View style={styles.list}>
            <Checkbox checked={showDone} label="Show done" onChange={onShowDone}>
              <Text style={styles.line}>Show done</Text>
            </Checkbox>
          </View>
        )}
        {inbox ? <TaskList heading={nameOf(inbox)} tasks={listOf(inbox.id)} {...list} /> : null}
        {only === undefined || only === "today" ? (
          <TaskList heading="Today" tasks={today.map((item) => ({ item, depth: 0 }))} {...list} />
        ) : null}
        {others.map((space) => (
          <TaskList key={space.id} heading={nameOf(space)} tasks={listOf(space.id)} {...list} />
        ))}
      </ScrollView>
    </View>
  );
}

/** A list of tasks and events, named by its heading, each indented by its depth, with what it says
 *  when it's `empty`. Tasks can be ticked, and tapping a title opens it. */
export function TaskList({
  heading,
  tasks,
  empty = "No tasks",
  done,
  onOpenTask,
  onTick,
}: {
  heading: string;
  tasks: { item: Item; depth: number }[];
  empty?: string;
  done: ReadonlySet<string>;
  onOpenTask: (itemId: string) => void;
  onTick: (itemId: string, done: boolean) => void;
}) {
  return (
    <View style={styles.list} accessibilityRole="list" accessibilityLabel={heading}>
      <Text style={styles.heading} accessibilityRole="header">
        {heading}
      </Text>
      {tasks.length === 0 ? <Text style={styles.line}>{empty}</Text> : null}
      {tasks.map(({ item: task, depth }) =>
        task.kind === ItemKind.EVENT ? (
          <EventRow key={task.id} event={task} depth={depth} onOpen={onOpenTask} />
        ) : (
          <View key={task.id} style={[styles.row, { paddingLeft: depth * 16 }]}>
            <Checkbox
              checked={done.has(task.id)}
              label={`Done: ${task.title}`}
              onChange={(ticked) => onTick(task.id, ticked)}
            />
            <Text
              style={[styles.task, done.has(task.id) ? styles.done : null]}
              accessibilityRole="button"
              onPress={() => onOpenTask(task.id)}
            >
              {task.title}
              {task.date ? <Text style={styles.line}> · {task.date}</Text> : null}
              {task.repeat ? <Text style={styles.line}>, repeats</Text> : null}
            </Text>
          </View>
        ),
      )}
    </View>
  );
}

function EventRow({
  event,
  depth,
  onOpen,
}: {
  event: Item;
  depth: number;
  onOpen: (itemId: string) => void;
}) {
  const time = timeOf(event);
  return (
    <View style={[styles.row, { paddingLeft: depth * 16 }]}>
      <Text
        style={styles.task}
        accessibilityRole="button"
        accessibilityLabel={`Event: ${event.title}`}
        onPress={() => onOpen(event.id)}
      >
        {event.title}
        {time ? <Text style={styles.line}> · {describeEventTime(time)}</Text> : null}
      </Text>
    </View>
  );
}

function nameOf(space: Space): string {
  return space.kind === SpaceKind.INBOX ? "Inbox" : space.name;
}

const styles = StyleSheet.create({
  panel: {
    position: "absolute",
    top: 8,
    right: 12,
    width: 320,
    maxHeight: "80%",
    padding: 12,
    backgroundColor: "#fffdf8",
    borderColor: "#d8d2c4",
    borderWidth: 1,
  },
  list: { gap: 4, marginBottom: 12 },
  heading: { fontSize: 15, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  task: { flex: 1, fontSize: 14, paddingVertical: 4 },
  done: { color: "#8f887a", textDecorationLine: "line-through" },
  line: { fontSize: 12, color: "#6b6459" },
});

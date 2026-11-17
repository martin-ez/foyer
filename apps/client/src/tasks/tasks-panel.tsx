import type { Item } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import { type Space, SpaceKind } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { localToday } from "../page/calendar-date";
import type { SyncState } from "../sync/household-sync";
import { spaceList, todayList } from "./task-lists";

/** The member's tasks as lists: the Inbox, Today, then each other space they see, or one space's
 *  list alone when `only` names it. Tapping a task opens it. */
export function TasksPanel({
  state,
  only,
  onOpenTask,
}: {
  state: SyncState;
  only?: string;
  onOpenTask: (itemId: string) => void;
}) {
  const items = [...state.items.values()];
  const stickers = [...state.stickers.values()];
  const spaces = only === undefined ? state.spaces : state.spaces.filter(({ id }) => id === only);
  const today = todayList(localToday(), state.spaces, items, stickers);
  const [inbox, ...others] = spaces;

  return (
    <View style={styles.panel}>
      <ScrollView>
        {inbox ? (
          <TaskList
            heading={nameOf(inbox)}
            tasks={spaceList(inbox.id, items, stickers)}
            onOpenTask={onOpenTask}
          />
        ) : null}
        {only === undefined ? (
          <TaskList heading="Today" tasks={today} onOpenTask={onOpenTask} />
        ) : null}
        {others.map((space) => (
          <TaskList
            key={space.id}
            heading={nameOf(space)}
            tasks={spaceList(space.id, items, stickers)}
            onOpenTask={onOpenTask}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function TaskList({
  heading,
  tasks,
  onOpenTask,
}: {
  heading: string;
  tasks: Item[];
  onOpenTask: (itemId: string) => void;
}) {
  return (
    <View style={styles.list} accessibilityRole="list" accessibilityLabel={heading}>
      <Text style={styles.heading} accessibilityRole="header">
        {heading}
      </Text>
      {tasks.length === 0 ? <Text style={styles.line}>No tasks</Text> : null}
      {tasks.map((task) => (
        <Text
          key={task.id}
          style={styles.task}
          accessibilityRole="button"
          onPress={() => onOpenTask(task.id)}
        >
          {task.title}
          {task.date ? <Text style={styles.line}> · {task.date}</Text> : null}
        </Text>
      ))}
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
  task: { fontSize: 14, paddingVertical: 4 },
  line: { fontSize: 12, color: "#6b6459" },
});

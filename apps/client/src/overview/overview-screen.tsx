import { type Item, ItemKind } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { todayEvents } from "../calendar/events";
import { EventEditor, spacesWithCalendar } from "../calendar/events-panel";
import { recentNotes } from "../notebook/notes";
import { describeDay, localToday } from "../page/calendar-date";
import { TitleBar } from "../shell/bars";
import { useHousehold } from "../shell/household";
import { TaskEditor } from "../tasks/task-editor";
import { doneTasks, todayList } from "../tasks/task-lists";
import { TaskList } from "../tasks/tasks-panel";
import { useTick } from "../tasks/ticking";

const notesShown = 5;

/** Today on one screen: its events, the tasks for it, and the notes written most recently, in
 *  spaces that aren't archived. Tasks can be ticked, and tapping a task or an event opens it above
 *  the lists. */
export function OverviewScreen() {
  const { state, sync } = useHousehold();
  const tick = useTick();
  const [openId, setOpenId] = useState<string | null>(null);
  const today = localToday();
  const listed = new Set(state.spaces.map(({ id }) => id));
  const items = [...state.items.values()].filter(({ spaceId }) => listed.has(spaceId));
  const done = doneTasks(state.items, state.completions.values());
  const events = todayEvents(items);
  const tasks = todayList(today, state.spaces, items, state.stickers.values(), done);
  const notes = recentNotes(items, notesShown);
  const open = openId === null ? undefined : state.items.get(openId);
  const asList = (shown: Item[]) => shown.map((item) => ({ item, depth: 0 }));
  const lists = { done, onOpenTask: setOpenId, onTick: tick };

  return (
    <View style={styles.fill}>
      <TitleBar title={`Today, ${describeDay(today)}`} />
      {open?.kind === ItemKind.TASK ? (
        <TaskEditor
          key={open.id}
          task={open}
          done={done.has(open.id)}
          state={state}
          sync={sync}
          onOpenTask={setOpenId}
          onClose={() => setOpenId(null)}
        />
      ) : open?.kind === ItemKind.EVENT ? (
        <EventEditor
          key={open.id}
          event={open}
          spaces={spacesWithCalendar(state.spaces)}
          onOpenTask={setOpenId}
          onClose={() => setOpenId(null)}
        />
      ) : null}
      <ScrollView contentContainerStyle={styles.lists}>
        <TaskList heading="Events" tasks={asList(events)} empty="No events today" {...lists} />
        <TaskList heading="Tasks" tasks={asList(tasks)} empty="Nothing to do today" {...lists} />
        <View style={styles.notes} accessibilityRole="list" accessibilityLabel="Recent notes">
          <Text style={styles.heading} accessibilityRole="header">
            Recent notes
          </Text>
          {notes.length === 0 ? <Text style={styles.line}>No notes yet</Text> : null}
          {notes.map((note) => (
            <Text key={note.id} style={styles.note}>
              {note.title}
            </Text>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  lists: { padding: 12, maxWidth: 560 },
  notes: { gap: 4, marginBottom: 12 },
  heading: { fontSize: 15, fontWeight: "600" },
  note: { fontSize: 14, paddingVertical: 4 },
  line: { fontSize: 12, color: "#6b6459" },
});

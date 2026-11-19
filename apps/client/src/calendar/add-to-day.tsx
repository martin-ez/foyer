import { limitItemTitle, timeOfDay } from "@foyer/shared";
import { ItemKind } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import { CalendarState, type Space, SpaceKind } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import { useEffect, useState } from "react";
import {
  Button,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { describeDay, describeTime } from "../page/calendar-date";
import type { HouseholdSync, SpotOnDay, SyncState } from "../sync/household-sync";
import { Checkbox } from "../tasks/checkbox";
import { doneTasks } from "../tasks/task-lists";
import { timeFromDraft } from "./events";
import { keepLastSpace, readLastSpace } from "./last-space";

type Adding = "task" | "event";

/** What tapping an empty spot in a day offers: a new task or event on that day, at the time a day
 *  page's timeline shows there, in a space picked as last time on this device, or one of the
 *  member's open tasks without a date. Its sticker goes where they tapped. */
export function AddToDay({
  date,
  spot,
  state,
  sync,
  onClose,
}: {
  date: string;
  spot: SpotOnDay;
  state: SyncState;
  sync: HouseholdSync;
  onClose: () => void;
}) {
  const { height } = useWindowDimensions();
  const [adding, setAdding] = useState<Adding>("task");
  const [title, setTitle] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [allDay, setAllDay] = useState(false);
  const tapped = spot.time ?? null;
  const [times, setTimes] = useState(() =>
    tapped === null
      ? { startTime: "09:00", endTime: "10:00" }
      : { startTime: timeOfDay(tapped), endTime: timeOfDay(Math.min(tapped + 60, 23 * 60 + 59)) },
  );
  const where = `${describeDay(date)}${tapped === null ? "" : ` at ${describeTime(tapped)}`}`;
  const [last, setLast] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    readLastSpace().then((spaceId) => {
      if (current) setLast(spaceId);
    });
    return () => {
      current = false;
    };
  }, []);

  const spaces = adding === "event" ? state.spaces.filter(hasCalendar) : state.spaces;
  const spaceId =
    [picked, last].find((id) => spaces.some((space) => space.id === id)) ?? spaces[0]?.id ?? null;
  const time = allDay
    ? ({ allDay: true, startsOn: date, endsOn: date } as const)
    : timeFromDraft({ allDay: false, startsOn: date, endsOn: date, ...times });
  const problem =
    sync.titleProblem(title) ??
    ("problem" in time ? time.problem : null) ??
    (spaceId === null ? "Events go in spaces with a Google calendar." : null);
  const done = doneTasks(state.items, state.completions.values());
  const undated = [...state.items.values()].filter(
    (item) => item.kind === ItemKind.TASK && item.date === "" && !done.has(item.id),
  );

  const add = () => {
    if (problem || spaceId === null || "problem" in time) return;
    void keepLastSpace(spaceId);
    if (adding === "task") sync.addTask(spaceId, title, { date, spot });
    else sync.addEvent(spaceId, { title, description: "", time }, spot);
    onClose();
  };

  return (
    <View
      style={[styles.panel, { maxHeight: height * 0.45 }]}
      accessibilityLabel={`Add to ${where}`}
    >
      <ScrollView contentContainerStyle={styles.form}>
        <Text style={styles.heading}>Add to {where}</Text>
        <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel="Add a">
          {(["task", "event"] as const).map((kind) => (
            <Checkbox
              key={kind}
              checked={adding === kind}
              label={kind === "task" ? "New task" : "New event"}
              onChange={() => setAdding(kind)}
            >
              <Text style={styles.line}>{kind === "task" ? "Task" : "Event"}</Text>
            </Checkbox>
          ))}
        </View>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={(text) => setTitle(limitItemTitle(text))}
          onSubmitEditing={add}
          placeholder="Title"
          accessibilityLabel="Title"
        />
        {adding === "event" ? (
          <View style={styles.row}>
            <Checkbox checked={allDay} label="All day" onChange={setAllDay}>
              <Text style={styles.line}>All day</Text>
            </Checkbox>
            {allDay ? null : (
              <>
                <TextInput
                  style={styles.input}
                  value={times.startTime}
                  onChangeText={(startTime) => setTimes({ ...times, startTime })}
                  placeholder="Starts at, as in 19:00"
                  accessibilityLabel="Starts at"
                />
                <TextInput
                  style={styles.input}
                  value={times.endTime}
                  onChangeText={(endTime) => setTimes({ ...times, endTime })}
                  placeholder="Ends at, as in 20:00"
                  accessibilityLabel="Ends at"
                />
              </>
            )}
          </View>
        ) : null}
        <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel="Space">
          {spaces.map((space) => (
            <Checkbox
              key={space.id}
              checked={space.id === spaceId}
              label={`In ${nameOf(space)}`}
              onChange={() => setPicked(space.id)}
            >
              <Text style={styles.line}>{nameOf(space)}</Text>
            </Checkbox>
          ))}
        </View>
        {problem && title !== "" ? <Text style={styles.problem}>{problem}</Text> : null}
        <View style={styles.row}>
          <Button
            title={adding === "task" ? "Add task" : "Add event"}
            disabled={problem !== null}
            onPress={add}
          />
          <Button title="Close" onPress={onClose} />
        </View>
        {undated.length > 0 ? (
          <>
            <Text style={styles.line}>Or give an open task without a date this day:</Text>
            <View accessibilityRole="list" accessibilityLabel="Open tasks without a date">
              {undated.map((task) => (
                <Pressable
                  key={task.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Put “${task.title}” on this day`}
                  onPress={() => {
                    sync.setDate(task.id, date, spot);
                    onClose();
                  }}
                  style={styles.task}
                >
                  <Text style={styles.title}>{task.title}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function hasCalendar(space: Space): boolean {
  return space.calendarState !== CalendarState.NONE;
}

function nameOf(space: Space): string {
  return space.kind === SpaceKind.INBOX ? "Inbox" : space.name;
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: "#fffdf8",
    borderBottomColor: "#d8d2c4",
    borderBottomWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  form: { gap: 8 },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  heading: { fontSize: 14, fontWeight: "600" },
  line: { fontSize: 12, color: "#6b6459" },
  title: { fontSize: 14, color: "#3d3830" },
  task: { paddingVertical: 4 },
  input: { borderColor: "#d8d2c4", borderWidth: 1, paddingHorizontal: 6, paddingVertical: 4 },
  problem: { fontSize: 12, color: "#9a3b2e" },
});

import { minutesOf } from "@foyer/shared";
import { type Item, ItemKind } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import type { Space } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import { Button, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { describeEventTime, timeOf } from "../calendar/events";
import { describeDay, describeTime } from "../page/calendar-date";

/** A task or an event in an archived space, which can only be looked at until its space is
 *  restored: its title, when it happens, its description, and whether a task is done. */
export function ArchivedItem({
  item,
  space,
  done = false,
  onClose,
}: {
  item: Item;
  space: Space;
  done?: boolean;
  onClose: () => void;
}) {
  const { height } = useWindowDimensions();
  const event = item.kind === ItemKind.EVENT;
  const when = whenOf(item);

  return (
    <View
      style={[styles.panel, { maxHeight: height * 0.45 }]}
      accessibilityLabel={`${event ? "Event" : "Task"}: ${item.title}`}
    >
      <ScrollView contentContainerStyle={styles.form}>
        <Text style={styles.title}>{item.title}</Text>
        {when ? <Text style={styles.line}>{when}</Text> : null}
        {!event && done ? <Text style={styles.line}>Done</Text> : null}
        {item.description ? <Text style={styles.description}>{item.description}</Text> : null}
        <Text style={styles.line}>
          In {space.name}, which is archived. Restore it to change this {event ? "event" : "task"}.
        </Text>
        <View style={styles.row}>
          <Button title="Close" onPress={onClose} />
        </View>
      </ScrollView>
    </View>
  );
}

function whenOf(item: Item): string | null {
  const time = timeOf(item);
  if (time) return describeEventTime(time);
  if (item.date === "") return null;
  const at = item.time === "" ? "" : `, at ${describeTime(minutesOf(item.time))}`;
  const repeats = item.repeat ? ", repeats" : "";
  return `${describeDay(item.date)}${at}${repeats}`;
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: "#fffdf8",
    borderBottomColor: "#d8d2c4",
    borderBottomWidth: 1,
  },
  form: { gap: 8, padding: 12 },
  title: { fontSize: 16, color: "#2b2620" },
  description: { fontSize: 14, color: "#3d3830" },
  line: { fontSize: 12, color: "#6b6459" },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
});

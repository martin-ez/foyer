import type { Box, CalendarLayout } from "@foyer/shared";
import { minutesOf } from "@foyer/shared";
import { StyleSheet, Text, View } from "react-native";
import { describeDay, describeTime, weekdayOf } from "../page/calendar-date";
import { useStickerDrag } from "../page/sticker-drag";

/** What a calendar page prints in words, as views laid out in its points: the weekdays' names,
 *  and each day's number, which opens the day's page when tapped. Today's is marked. A day's page
 *  prints the hours beside its timeline instead, and names the strip above it. */
export function CalendarLabels({
  layout,
  today,
  onOpenDay,
}: {
  layout: CalendarLayout;
  today: string;
  onOpenDay: (date: string) => void;
}) {
  const named = layout.weekdays.length === 0;
  const strip = layout.timeline ? layout.days[0]?.stickers : undefined;
  return (
    <>
      {layout.weekdays.map(({ date, box }) => (
        <View key={date} style={[styles.label, styles.weekday, at(box)]}>
          <Text style={styles.weekdayName}>{weekdayOf(date)}</Text>
        </View>
      ))}
      {layout.days.map(({ date, label }) =>
        label ? (
          <DayLabel
            key={date}
            date={date}
            box={label}
            named={named}
            today={date === today}
            onOpen={() => onOpenDay(date)}
          />
        ) : null,
      )}
      {strip ? (
        <View
          style={[
            styles.label,
            styles.strip,
            at({ ...strip, x: strip.x + strip.width - stripLabelWidth, width: stripLabelWidth }),
            { height: 20 },
          ]}
        >
          <Text style={styles.hourName}>No time</Text>
        </View>
      ) : null}
      {layout.timeline?.hours.map(({ time, label }) => (
        <View key={time} style={[styles.label, styles.hour, at(label)]}>
          <Text style={styles.hourName}>{describeTime(minutesOf(time))}</Text>
        </View>
      ))}
    </>
  );
}

function DayLabel({
  date,
  box,
  named,
  today,
  onOpen,
}: {
  date: string;
  box: Box;
  named: boolean;
  today: boolean;
  onOpen: () => void;
}) {
  const press = useStickerDrag(
    { dragged: () => {}, dropped: () => {}, tapped: onOpen, cancelled: () => {} },
    true,
  );
  return (
    <View
      {...press}
      accessible
      accessibilityRole="button"
      accessibilityLabel={`Open ${describeDay(date)}`}
      style={[styles.label, styles.day, at(box)]}
    >
      {named ? <Text style={styles.weekdayName}>{weekdayOf(date)}</Text> : null}
      <Text style={[styles.number, today ? styles.today : null]}>{Number(date.slice(8))}</Text>
    </View>
  );
}

const stripLabelWidth = 120;

function at(box: Box) {
  return { left: box.x, top: box.y, width: box.width, height: box.height };
}

const ink = "#3d3830";

const styles = StyleSheet.create({
  label: { position: "absolute" },
  weekday: { justifyContent: "center", paddingHorizontal: 10, pointerEvents: "none" },
  day: { paddingHorizontal: 10, paddingTop: 6, alignItems: "flex-start", pointerEvents: "auto" },
  weekdayName: { fontSize: 18, color: "#6b6459" },
  hour: { justifyContent: "center", alignItems: "flex-end", pointerEvents: "none" },
  strip: { alignItems: "flex-end", paddingTop: 4, paddingRight: 6, pointerEvents: "none" },
  hourName: { fontSize: 10, color: "#6b6459" },
  number: { fontSize: 22, color: ink, minWidth: 30, textAlign: "center", borderRadius: 15 },
  today: { backgroundColor: ink, color: "#fffdf8", fontWeight: "700", overflow: "hidden" },
});

import { useState } from "react";
import { Button, Pressable, StyleSheet, Text, View } from "react-native";
import { localToday } from "../page/calendar-date";
import { describePage, sizeOf } from "../page/open-page";
import { PageView } from "../page/page-view";
import { TitleBar } from "../shell/bars";
import { useHousehold } from "../shell/household";
import { CalendarLabels } from "./calendar-labels";
import { monthLayout, weekLayout } from "./calendar-layout";
import { type CalendarSpan, type CalendarView, calendarPage, stepCalendar } from "./calendar-view";

const spans: { span: CalendarSpan; name: string }[] = [
  { span: "day", name: "Day" },
  { span: "week", name: "Week" },
  { span: "month", name: "Month" },
];

/** The household's calendar, open on today's day page, with ways to move to the previous or next
 *  page, back to today, and between month, week and day pages, as in Google Calendar. Tapping a
 *  day on a month or week page opens the day's page. */
export function CalendarScreen() {
  const { state } = useHousehold();
  const [view, setView] = useState<CalendarView>(() => ({ span: "day", date: localToday() }));
  const page = calendarPage(view);
  const size = sizeOf(page, state.pages);
  const layout =
    page.kind === "month"
      ? monthLayout(page.month, size)
      : page.kind === "week"
        ? weekLayout(page.monday, size)
        : null;

  return (
    <View style={styles.fill}>
      <TitleBar
        title={describePage(page, state)}
        after={<SpanPicker span={view.span} onPick={(span) => setView({ ...view, span })} />}
      >
        <Button title="Today" onPress={() => setView({ ...view, date: localToday() })} />
        <Button title={`Previous ${view.span}`} onPress={() => setView(stepCalendar(view, -1))} />
        <Button title={`Next ${view.span}`} onPress={() => setView(stepCalendar(view, 1))} />
      </TitleBar>
      <PageView page={page} ruling={layout?.ruling}>
        {layout ? (
          <CalendarLabels
            layout={layout}
            today={localToday()}
            onOpenDay={(date) => setView({ span: "day", date })}
          />
        ) : null}
      </PageView>
    </View>
  );
}

function SpanPicker({
  span,
  onPick,
}: {
  span: CalendarSpan;
  onPick: (span: CalendarSpan) => void;
}) {
  return (
    <View style={styles.picker} accessibilityRole="radiogroup" accessibilityLabel="Calendar view">
      {spans.map((choice) => {
        const picked = choice.span === span;
        return (
          <Pressable
            key={choice.span}
            accessibilityRole="radio"
            aria-checked={picked}
            onPress={() => onPick(choice.span)}
            style={[styles.choice, picked ? styles.picked : null]}
          >
            <Text style={[styles.choiceName, picked ? styles.pickedName : null]}>
              {choice.name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  picker: {
    flexDirection: "row",
    borderColor: "#d8d2c4",
    borderWidth: 1,
    borderRadius: 4,
    overflow: "hidden",
  },
  choice: { paddingHorizontal: 12, paddingVertical: 6 },
  picked: { backgroundColor: "#ece6d8" },
  choiceName: { fontSize: 14, color: "#3d3830" },
  pickedName: { fontWeight: "600" },
});

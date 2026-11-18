import { calendarLayout, dayAt, keepInDay } from "@foyer/shared";
import { ItemKind } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import { useState } from "react";
import { Button, Pressable, StyleSheet, Text, View } from "react-native";
import { describeDay, localToday } from "../page/calendar-date";
import { describePage, pageIdOf, sizeOf } from "../page/open-page";
import { PageView } from "../page/page-view";
import type { Point } from "../page/sheet-camera";
import { TitleBar } from "../shell/bars";
import { useHousehold } from "../shell/household";
import type { SpotOnDay } from "../sync/household-sync";
import { TaskEditor } from "../tasks/task-editor";
import { doneTasks } from "../tasks/task-lists";
import { AddToDay } from "./add-to-day";
import { CalendarLabels } from "./calendar-labels";
import { type CalendarSpan, type CalendarView, calendarPage, stepCalendar } from "./calendar-view";
import { EventsPanel } from "./events-panel";
import { ConnectGooglePrompt } from "./google-calendar-views";

const spans: { span: CalendarSpan; name: string }[] = [
  { span: "day", name: "Day" },
  { span: "week", name: "Week" },
  { span: "month", name: "Month" },
];

type Moving = { stickerId: string; at: Point; date: string };

/** The household's calendar, open on today's day page, with dated tasks and events as stickers on
 *  their days. Tapping an empty spot in a day adds something there, and dropping a sticker on
 *  another day asks first. Above the page, the upcoming events, or the item a tapped sticker shows. */
export function CalendarScreen() {
  const { state, sync } = useHousehold();
  const [view, setView] = useState<CalendarView>(() => ({ span: "day", date: localToday() }));
  const [opened, setOpened] = useState<string | "new" | null>(null);
  const [adding, setAdding] = useState<{ date: string; spot: SpotOnDay } | null>(null);
  const [moving, setMoving] = useState<Moving | null>(null);
  const page = calendarPage(view);
  const pageId = pageIdOf(page);
  const size = sizeOf(page, state.pages);
  const layout = calendarLayout(pageId, size);
  const openedItem = opened === null || opened === "new" ? undefined : state.items.get(opened);
  const open = (itemId: string | "new" | null) => {
    setAdding(null);
    setOpened(itemId);
  };
  const tapDay = (at: Point) => {
    const date = dayAt(pageId, size, at);
    if (date === null) return;
    setOpened(null);
    setAdding({ date, spot: { pageId, at: keepInDay(pageId, size, date, at) } });
  };

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
      <ConnectGooglePrompt />
      {openedItem?.kind === ItemKind.TASK ? (
        <TaskEditor
          key={openedItem.id}
          task={openedItem}
          done={doneTasks(state.items, state.completions.values()).has(openedItem.id)}
          state={state}
          sync={sync}
          onShowOnPage={() => open(null)}
          onOpenTask={open}
          onClose={() => open(null)}
        />
      ) : adding ? (
        <AddToDay
          key={`${adding.date} ${adding.spot.at.x} ${adding.spot.at.y}`}
          date={adding.date}
          spot={adding.spot}
          state={state}
          sync={sync}
          onClose={() => setAdding(null)}
        />
      ) : (
        <EventsPanel open={openedItem || opened === "new" ? opened : null} onOpen={open} />
      )}
      <View style={styles.fill}>
        <PageView
          page={page}
          ruling={layout?.ruling}
          onOpenItem={open}
          onTapPage={tapDay}
          onDropOnDay={(sticker, at, date) => setMoving({ stickerId: sticker.id, at, date })}
        >
          {layout ? (
            <CalendarLabels
              layout={layout}
              today={localToday()}
              onOpenDay={(date) => setView({ span: "day", date })}
            />
          ) : null}
        </PageView>
        {moving ? (
          <AskToChangeDate
            date={moving.date}
            onAnswer={(yes) => {
              if (yes) sync.moveToDay(moving.stickerId, moving.at, moving.date);
              setMoving(null);
            }}
          />
        ) : null}
      </View>
    </View>
  );
}

function AskToChangeDate({ date, onAnswer }: { date: string; onAnswer: (yes: boolean) => void }) {
  return (
    <View style={styles.cover}>
      <View style={styles.dialog} role="dialog" aria-label="Change the date?">
        <Text style={styles.question}>Did you mean to change the date to {describeDay(date)}?</Text>
        <View style={styles.row}>
          <Button title="Change the date" onPress={() => onAnswer(true)} />
          <Button title="Put it back" onPress={() => onAnswer(false)} />
        </View>
      </View>
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
  cover: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(43, 38, 32, 0.3)",
  },
  dialog: {
    maxWidth: 420,
    margin: 16,
    padding: 16,
    gap: 12,
    backgroundColor: "#fffdf8",
    borderColor: "#d8d2c4",
    borderWidth: 1,
  },
  question: { fontSize: 14, color: "#2b2620" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});

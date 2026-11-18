import { createContext, type ReactNode, use, useState } from "react";
import { Button, StyleSheet, Text, View } from "react-native";
import { useHousehold } from "../shell/household";
import { doneTasks, openTasksUnder } from "./task-lists";

type Tick = (itemId: string, done: boolean, occurrence?: string) => void;

const TickContext = createContext<Tick | null>(null);

/** Lets the views inside it tick and untick tasks with `useTick`. Ticking a task with open tasks
 *  under it first asks whether to tick them too, or only the task itself. */
export function TickingProvider({ children }: { children: ReactNode }) {
  const { sync } = useHousehold();
  const [asking, setAsking] = useState<{ itemId: string; under: string[] } | null>(null);
  const tick: Tick = (itemId, done, occurrence) => {
    if (!done) {
      sync.untickTask(itemId, occurrence);
      return;
    }
    const { items, completions } = sync.getState();
    const under = openTasksUnder(itemId, items, doneTasks(items, completions.values()));
    if (under.length === 0) sync.tickTask(itemId);
    else setAsking({ itemId, under: under.map(({ id }) => id) });
  };
  const title = asking ? (sync.getState().items.get(asking.itemId)?.title ?? "this task") : "";
  const count = asking?.under.length ?? 0;
  const answer = (ticking: string[]) => {
    if (ticking.length > 0) sync.tickTasks(ticking);
    setAsking(null);
  };

  return (
    <TickContext value={tick}>
      <View style={styles.fill}>
        {children}
        {asking ? (
          <View style={styles.cover}>
            <View style={styles.dialog} role="dialog" aria-label="Tick the tasks under it?">
              <Text style={styles.question}>
                “{title}” has {count === 1 ? "an open task" : `${count} open tasks`} under it. Tick{" "}
                {count === 1 ? "it" : "them"} too?
              </Text>
              <View style={styles.row}>
                <Button
                  title={count === 1 ? "Tick it too" : "Tick them too"}
                  onPress={() => answer([asking.itemId, ...asking.under])}
                />
                <Button title="Only this task" onPress={() => answer([asking.itemId])} />
                <Button title="Cancel" onPress={() => answer([])} />
              </View>
            </View>
          </View>
        ) : null}
      </View>
    </TickContext>
  );
}

/** Ticks a task when `done`, asking first about open tasks under it, or unticks it: the
 *  occurrence given, or its current one. Needs a `TickingProvider` around the calling component. */
export function useTick(): Tick {
  const tick = use(TickContext);
  if (!tick) throw new Error("useTick needs a TickingProvider around it.");
  return tick;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
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

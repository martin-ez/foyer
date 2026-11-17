import { limitItemTitle } from "@foyer/shared";
import { SpaceKind } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import { useState } from "react";
import { Button, StyleSheet, Text, TextInput, View } from "react-native";
import { describePage, type OpenPage } from "../page/open-page";
import { PageView } from "../page/page-view";
import { newestSpacePage } from "../page/sticker-layout";
import { Bar, TitleBar } from "../shell/bars";
import { useHousehold } from "../shell/household";
import type { HouseholdSync } from "../sync/household-sync";
import { SpacesPanel } from "../sync/spaces-panel";
import { TaskEditor } from "./task-editor";
import { doneTasks } from "./task-lists";
import { TasksPanel } from "./tasks-panel";
import { useTick } from "./ticking";

type SpacePage = { spaceId: string; number: number };

/** The member's spaces and their tasks: a space's page, opening on the Inbox's newest, with ways to
 *  move between its pages and add tasks, to open, tick and edit a task above its body page, and to
 *  show the spaces and the task lists. */
export function TasksScreen() {
  const { state, sync } = useHousehold();
  const [chosen, setChosen] = useState<SpacePage | null>(null);
  const [panel, setPanel] = useState<"spaces" | "lists" | "list" | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const inbox = state.spaces.find(({ kind }) => kind === SpaceKind.INBOX);
  const space =
    chosen ??
    (inbox ? { spaceId: inbox.id, number: newestSpacePage(inbox.id, state.pages) } : null);
  const openTask = openTaskId === null ? undefined : state.items.get(openTaskId);
  const toggle = (which: typeof panel) => {
    setOpenTaskId(null);
    setPanel(panel === which ? null : which);
  };
  const tick = useTick();

  if (!space) {
    return (
      <View style={styles.fill}>
        <TitleBar title="Tasks" />
        <View style={styles.empty}>
          <Text style={styles.line}>Waiting for the household's spaces…</Text>
        </View>
      </View>
    );
  }
  const shown: OpenPage = openTask
    ? { kind: "item", itemId: openTask.id }
    : { kind: "space", ...space };

  return (
    <View style={styles.fill}>
      <TitleBar title={describePage(shown, state)}>
        <Button
          title={panel === "spaces" ? "Hide spaces" : "Spaces"}
          onPress={() => toggle("spaces")}
        />
        <Button
          title={panel === "lists" ? "Hide all lists" : "All lists"}
          onPress={() => toggle("lists")}
        />
      </TitleBar>
      {openTask ? (
        <TaskEditor
          key={openTask.id}
          task={openTask}
          done={doneTasks(state.items, state.completions.values()).has(openTask.id)}
          state={state}
          sync={sync}
          onShowOnPage={(spaceId, number) => {
            setChosen({ spaceId, number });
            setOpenTaskId(null);
          }}
          onOpenTask={setOpenTaskId}
          onClose={() => setOpenTaskId(null)}
        />
      ) : (
        <SpacePageBar
          page={space}
          newest={newestSpacePage(space.spaceId, state.pages)}
          sync={sync}
          showingList={panel === "list"}
          onToggleList={() => toggle("list")}
          onOpen={setChosen}
        />
      )}
      <View style={styles.fill}>
        <PageView page={shown} onOpenTask={setOpenTaskId} />
        {openTask ? null : panel === "spaces" ? (
          <SpacesPanel
            state={state}
            sync={sync}
            onOpen={(spaceId) => {
              setChosen({ spaceId, number: newestSpacePage(spaceId, state.pages) });
              setPanel(null);
            }}
          />
        ) : panel === "lists" || panel === "list" ? (
          <TasksPanel
            state={state}
            only={panel === "list" ? space.spaceId : undefined}
            showDone={showDone}
            onShowDone={setShowDone}
            onOpenTask={setOpenTaskId}
            onTick={tick}
          />
        ) : null}
      </View>
    </View>
  );
}

function SpacePageBar({
  page,
  newest,
  sync,
  showingList,
  onToggleList,
  onOpen,
}: {
  page: SpacePage;
  newest: number;
  sync: HouseholdSync;
  showingList: boolean;
  onToggleList: () => void;
  onOpen: (page: SpacePage) => void;
}) {
  const [title, setTitle] = useState("");
  const blocked = sync.titleProblem(title) !== null;
  const open = (number: number) => onOpen({ spaceId: page.spaceId, number });
  const add = () => {
    if (blocked) return;
    const { pageNumber } = sync.addTask(page.spaceId, title);
    setTitle("");
    open(pageNumber);
  };

  return (
    <Bar>
      <Button
        title="Previous page"
        disabled={page.number <= 1}
        onPress={() => open(page.number - 1)}
      />
      <Button
        title="Next page"
        disabled={page.number >= newest}
        onPress={() => open(page.number + 1)}
      />
      <Button title={showingList ? "Hide list" : "List"} onPress={onToggleList} />
      <TextInput
        style={[styles.input, styles.grow]}
        value={title}
        onChangeText={(text) => setTitle(limitItemTitle(text))}
        onSubmitEditing={add}
        placeholder="New task"
        accessibilityLabel="New task"
      />
      <Button title="Add task" disabled={blocked} onPress={add} />
    </Bar>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center" },
  line: { fontSize: 14, color: "#6b6459" },
  grow: { flex: 1, minWidth: 120 },
  input: { borderColor: "#d8d2c4", borderWidth: 1, paddingHorizontal: 6, paddingVertical: 4 },
});

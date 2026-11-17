import { limitItemTitle } from "@foyer/shared";
import type { Member } from "@foyer/shared/gen/foyer/member/v1/member_pb";
import { useState, useSyncExternalStore } from "react";
import { Button, StyleSheet, Text, TextInput, View } from "react-native";
import { BackendStatus } from "../backend/backend-status";
import { SignedInAs } from "../session/session-screens";
import type { HouseholdSync, SyncState, SyncStatus } from "../sync/household-sync";
import { SpacesPanel } from "../sync/spaces-panel";
import { useHouseholdSync } from "../sync/use-household-sync";
import { useLivePage } from "../sync/use-live-page";
import { describeSticker } from "./describe-sticker";
import { describePage, pageIdOf, sizeOf } from "./open-page";
import { PageSheet } from "./page-sheet";
import { PageStickers } from "./page-stickers";
import { markersOn } from "./presence";
import { PresenceMarkers } from "./presence-markers";
import { newestSpacePage, stickersOn } from "./sticker-layout";
import { useOpenPage } from "./use-open-page";

const statusLines: Record<SyncStatus, string> = {
  connecting: "Connecting…",
  "catching-up": "Catching up…",
  "up-to-date": "Up to date",
  offline: "Offline. Changes are sent once it's back.",
  "signed-out": "Signed out",
};

/** What the signed-in member sees: the open page, starting as today's, kept in sync with the
 *  household, with its stickers and others' markers, ways to move between pages, and to add tasks
 *  to a space. Calls `onSignedOut` when the household says the session has ended. */
export function PagesScreen({
  member,
  onSignOut,
  onSignedOut,
}: {
  member: Member;
  onSignOut: () => void;
  onSignedOut: () => void;
}) {
  const { state, sync } = useHouseholdSync(member.id, onSignedOut);
  const pages = useOpenPage();
  const pageId = pageIdOf(pages.page);
  useLivePage(sync.live, pageId);
  const live = useSyncExternalStore(sync.live.subscribe, sync.live.getState);
  const markers = live.pageId === pageId ? markersOn(live.here, state.members) : [];
  const [showingSpaces, setShowingSpaces] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const label = describePage(pages.page, state.spaces);
  const unsaved = state.unsaved > 0 ? ` · ${state.unsaved} not saved yet` : "";
  const size = sizeOf(pages.page, state.pages);
  const stickers = stickersOn(pageId, state.stickers.values());
  const selectedSticker = stickers.find(({ id }) => id === selected);
  const space = pages.page.kind === "space" ? pages.page : null;

  return (
    <View style={styles.fill}>
      <View style={styles.bar}>
        <Button title="Previous day" onPress={pages.previousDay} />
        <Button title="Today" onPress={pages.today} />
        <Button title="Next day" onPress={pages.nextDay} />
        <Button
          title={showingSpaces ? "Hide spaces" : "Spaces"}
          onPress={() => setShowingSpaces(!showingSpaces)}
        />
        <Text style={styles.title} accessibilityRole="header">
          {label}
        </Text>
        <Text style={styles.line}>
          {statusLines[state.status]}
          {unsaved}
        </Text>
        <SignedInAs member={member} onSignOut={onSignOut} />
      </View>
      {space ? (
        <SpacePageBar
          spaceId={space.spaceId}
          number={space.number}
          newest={newestSpacePage(space.spaceId, state.pages)}
          sync={sync}
          onOpen={(number) => pages.openSpace(space.spaceId, number)}
        />
      ) : null}
      {selectedSticker ? (
        <View style={styles.bar}>
          <Text style={styles.grow}>
            Selected: {describeSticker(selectedSticker, state.items.get(selectedSticker.itemId))}
          </Text>
          <Button
            title="Remove from page"
            onPress={() => {
              sync.removeSticker(selectedSticker.id);
              setSelected(null);
            }}
          />
          <Button title="Done" onPress={() => setSelected(null)} />
        </View>
      ) : null}
      <Problems state={state} sync={sync} />
      <View style={styles.fill}>
        <PageSheet
          key={pageId}
          size={size}
          label={label}
          onPoint={({ x, y }) => sync.live.point(x, y)}
        >
          <PageStickers
            stickers={stickers}
            items={state.items}
            page={size}
            selected={selected}
            onSelect={(stickerId) => setSelected(stickerId === selected ? null : stickerId)}
            onMove={(stickerId, { x, y }) => sync.moveSticker(stickerId, x, y)}
          />
          <PresenceMarkers markers={markers} />
        </PageSheet>
        {showingSpaces ? (
          <SpacesPanel
            state={state}
            sync={sync}
            onOpen={(spaceId) => {
              pages.openSpace(spaceId, newestSpacePage(spaceId, state.pages));
              setShowingSpaces(false);
            }}
          />
        ) : null}
        <BackendStatus />
      </View>
    </View>
  );
}

/** Ways to move between a space's pages, up to its newest, and to add a task to the space. */
function SpacePageBar({
  spaceId,
  number,
  newest,
  sync,
  onOpen,
}: {
  spaceId: string;
  number: number;
  newest: number;
  sync: HouseholdSync;
  onOpen: (number: number) => void;
}) {
  const [title, setTitle] = useState("");
  const blocked = sync.titleProblem(title) !== null;
  const add = () => {
    if (blocked) return;
    const { pageNumber } = sync.addTask(spaceId, title);
    setTitle("");
    onOpen(pageNumber);
  };

  return (
    <View style={styles.bar}>
      <Button title="Previous page" disabled={number <= 1} onPress={() => onOpen(number - 1)} />
      <Button title="Next page" disabled={number >= newest} onPress={() => onOpen(number + 1)} />
      <TextInput
        style={[styles.input, styles.grow]}
        value={title}
        onChangeText={(text) => setTitle(limitItemTitle(text))}
        onSubmitEditing={add}
        placeholder="New task"
        accessibilityLabel="New task"
      />
      <Button title="Add task" disabled={blocked} onPress={add} />
    </View>
  );
}

/** The changes the household refused, which the device undid, and a way to dismiss them. */
function Problems({ state, sync }: { state: SyncState; sync: HouseholdSync }) {
  if (state.problems.length === 0) return null;
  return (
    <View style={styles.bar}>
      <View style={styles.grow}>
        {state.problems.map((problem) => (
          <Text key={problem} style={styles.problem}>
            {problem}
          </Text>
        ))}
      </View>
      <Button title="Dismiss" onPress={() => sync.dismissProblems()} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  bar: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#fffdf8",
    borderBottomColor: "#d8d2c4",
    borderBottomWidth: 1,
  },
  title: { fontSize: 16, fontWeight: "600", flexGrow: 1 },
  line: { fontSize: 12, color: "#6b6459" },
  grow: { flex: 1, minWidth: 120 },
  input: { borderColor: "#d8d2c4", borderWidth: 1, paddingHorizontal: 6, paddingVertical: 4 },
  problem: { fontSize: 12, color: "#9a3b2e" },
});

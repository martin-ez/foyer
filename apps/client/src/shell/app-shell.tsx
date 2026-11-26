import { TabList, TabSlot, Tabs, TabTrigger, type TabTriggerSlotProps } from "expo-router/ui";
import { useState } from "react";
import { Button, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BackendStatus } from "../backend/backend-status";
import { GoogleCalendarEntry } from "../calendar/google-calendar-views";
import { CapturePanel } from "../capture/capture-panel";
import { ShortcutsPanel } from "../capture/shortcuts-panel";
import { SignedInAs } from "../session/session-screens";
import type { SyncStatus } from "../sync/household-sync";
import { useFirstScreen } from "./first-screen";
import { FirstScreenPicker } from "./first-screen-picker";
import { useHousehold } from "./household";
import { ThrowWhenAsked } from "./throw-when-asked";
import { ViewBoundary } from "./view-boundary";

const sideBarFrom = 600;

const statusLines: Record<SyncStatus, string> = {
  connecting: "Connecting…",
  "catching-up": "Catching up…",
  "up-to-date": "Up to date",
  offline: "Offline. Changes are sent once it's back.",
  "signed-out": "Signed out",
  "another-member": "Someone else signed in. Opening Foyer as them…",
};

/** The frame around Foyer's views: a bar to move between them, along the bottom of narrow windows
 *  and the side of wider ones, with Capture, the sync status and an account menu, beside the open
 *  view and anything sync couldn't do. The Overview is in the bar only while it's the first screen. */
export function AppShell() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [accountShown, setAccountShown] = useState(false);
  const [captureShown, setCaptureShown] = useState(false);
  const [firstScreen] = useFirstScreen();
  const side = width >= sideBarFrom;
  const bar = (
    <TabList style={side ? styles.sideBar : styles.bottomBar} accessibilityRole="tablist">
      <TabTrigger name="overview" href="/overview" asChild>
        <Destination label="Overview" hidden={firstScreen !== "overview"} />
      </TabTrigger>
      <TabTrigger name="calendar" href="/calendar" asChild>
        <Destination label="Calendar" />
      </TabTrigger>
      <TabTrigger name="notebook" href="/notebook" asChild>
        <Destination label="Notebook" />
      </TabTrigger>
      <TabTrigger name="tasks" href="/tasks" asChild>
        <Destination label="Tasks" />
      </TabTrigger>
      <Button title="Capture" onPress={() => setCaptureShown(!captureShown)} />
      <View style={side ? styles.sideEnd : styles.bottomEnd}>
        <SyncLine />
        <Button
          title={accountShown ? "Hide account" : "Account"}
          onPress={() => setAccountShown(!accountShown)}
        />
      </View>
    </TabList>
  );

  return (
    <Tabs
      options={{ backBehavior: "history" }}
      style={[
        side ? styles.row : styles.column,
        {
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
      ]}
    >
      {side ? bar : null}
      <View style={styles.fill}>
        {captureShown ? <CapturePanel onClose={() => setCaptureShown(false)} /> : null}
        <Problems />
        <ViewBoundary>
          <TabSlot />
          {ThrowWhenAsked ? <ThrowWhenAsked /> : null}
        </ViewBoundary>
        {accountShown ? <AccountPanel alongSide={side} /> : null}
      </View>
      {side ? null : bar}
    </Tabs>
  );
}

function Destination({
  label,
  hidden = false,
  isFocused,
  ...props
}: Omit<TabTriggerSlotProps, "ref"> & { label: string; hidden?: boolean }) {
  if (hidden && !isFocused) return null;
  return (
    <Pressable
      {...props}
      accessibilityRole="tab"
      aria-selected={isFocused}
      style={[styles.destination, isFocused ? styles.focused : null]}
    >
      <Text style={[styles.label, isFocused ? styles.focusedLabel : null]}>{label}</Text>
    </Pressable>
  );
}

function SyncLine() {
  const { state } = useHousehold();
  const unsaved = state.unsaved > 0 ? ` · ${state.unsaved} not saved yet` : "";
  return (
    <Text style={styles.line}>
      {statusLines[state.status]}
      {unsaved}
    </Text>
  );
}

function AccountPanel({ alongSide }: { alongSide: boolean }) {
  const { member, state, signOut } = useHousehold();
  const [shortcutsShown, setShortcutsShown] = useState(false);
  return (
    <View style={[styles.panel, alongSide ? styles.panelLeft : styles.panelRight]}>
      <SignedInAs member={member} unsaved={state.unsaved} onSignOut={signOut} />
      <GoogleCalendarEntry />
      <BackendStatus />
      <FirstScreenPicker />
      <Button
        title={shortcutsShown ? "Hide Shortcuts" : "Shortcuts"}
        onPress={() => setShortcutsShown(!shortcutsShown)}
      />
      {shortcutsShown ? <ShortcutsPanel /> : null}
    </View>
  );
}

function Problems() {
  const { state, sync } = useHousehold();
  if (state.problems.length === 0) return null;
  return (
    <View style={styles.problems}>
      <View style={styles.fill}>
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

const paper = "#fffdf8";
const rule = "#d8d2c4";

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flex: 1, flexDirection: "row", backgroundColor: paper },
  column: { flex: 1, flexDirection: "column", backgroundColor: paper },
  sideBar: {
    width: 132,
    flexDirection: "column",
    justifyContent: "flex-start",
    gap: 4,
    padding: 8,
    borderRightColor: rule,
    borderRightWidth: 1,
  },
  bottomBar: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-start",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderTopColor: rule,
    borderTopWidth: 1,
  },
  sideEnd: { marginTop: "auto", gap: 8 },
  bottomEnd: { marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 8 },
  destination: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 4 },
  focused: { backgroundColor: "#ece6d8" },
  label: { fontSize: 15, color: "#3d3830" },
  focusedLabel: { fontWeight: "600" },
  line: { fontSize: 12, color: "#6b6459" },
  panel: {
    position: "absolute",
    bottom: 8,
    gap: 8,
    padding: 12,
    backgroundColor: paper,
    borderColor: rule,
    borderWidth: 1,
  },
  panelLeft: { left: 12 },
  panelRight: { right: 12 },
  problems: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomColor: rule,
    borderBottomWidth: 1,
  },
  problem: { fontSize: 12, color: "#9a3b2e" },
});

import type { Member } from "@foyer/shared/gen/foyer/member/v1/member_pb";
import { useState } from "react";
import { Button, StyleSheet, Text, View } from "react-native";
import { BackendStatus } from "../backend/backend-status";
import { SignedInAs } from "../session/session-screens";
import type { SyncStatus } from "../sync/household-sync";
import { SpacesPanel } from "../sync/spaces-panel";
import { useHouseholdSync } from "../sync/use-household-sync";
import { describePage, pageIdOf, sizeOf } from "./open-page";
import { PageSheet } from "./page-sheet";
import { useOpenPage } from "./use-open-page";

const statusLines: Record<SyncStatus, string> = {
  connecting: "Connecting…",
  "catching-up": "Catching up…",
  "up-to-date": "Up to date",
  offline: "Offline. Changes are sent once it's back.",
  "signed-out": "Signed out",
};

/** What the signed-in member sees: the open page, kept in sync with the household, which starts as
 *  today's, with ways to move between days and to open each space's first page. Calls
 *  `onSignedOut` when the household says the session has ended. */
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
  const [showingSpaces, setShowingSpaces] = useState(false);
  const label = describePage(pages.page, state.spaces);
  const unsaved = state.unsaved > 0 ? ` · ${state.unsaved} not saved yet` : "";

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
      <View style={styles.fill}>
        <PageSheet
          key={pageIdOf(pages.page)}
          size={sizeOf(pages.page, state.pages)}
          label={label}
        />
        {showingSpaces ? (
          <SpacesPanel
            state={state}
            sync={sync}
            onOpen={(spaceId) => {
              pages.openSpace(spaceId);
              setShowingSpaces(false);
            }}
          />
        ) : null}
        <BackendStatus />
      </View>
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
});

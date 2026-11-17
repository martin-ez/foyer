import { ConnectError } from "@connectrpc/connect";
import {
  type GoogleConnection,
  GoogleConnectionState,
} from "@foyer/shared/gen/foyer/calendar/v1/calendar_pb";
import { createContext, type ReactNode, use, useEffect, useState } from "react";
import { Button, StyleSheet, Text, View } from "react-native";
import { calendarClient } from "../backend/backend";
import { useHousehold } from "../shell/household";
import { connectGoogleCalendar, problemFromConnecting } from "./connect-google";
import { describeConnection } from "./google-calendar";

/** The member's connection to Google Calendar, and ways to change it. */
type GoogleCalendar = {
  connection: GoogleConnection | null;
  /** Why connecting or disconnecting just didn't work, in a sentence. */
  problem?: string;
  busy: boolean;
  connect: () => void;
  disconnect: () => void;
  dismissProblem: () => void;
};

const GoogleCalendarContext = createContext<GoogleCalendar | null>(null);

/** Shares the member's connection to Google Calendar, and why connecting just didn't work, with
 *  every view inside it, which reads them with `useGoogleCalendar`. Needs a `HouseholdProvider`. */
export function GoogleCalendarProvider({ children }: { children: ReactNode }) {
  const { state } = useHousehold();
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const returned = problemFromConnecting();
    if (returned) setProblem(returned);
  }, []);

  const attempt = async (what: string, action: () => Promise<string | undefined>) => {
    setBusy(true);
    setProblem(undefined);
    try {
      setProblem(await action());
    } catch (error) {
      setProblem(`Couldn't ${what}: ${ConnectError.from(error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const calendar: GoogleCalendar = {
    connection: state.googleConnection,
    problem,
    busy,
    connect: () => attempt("connect Google Calendar", () => connectGoogleCalendar(calendarClient)),
    disconnect: () =>
      attempt("disconnect Google Calendar", async () => {
        await calendarClient.disconnect({});
        return undefined;
      }),
    dismissProblem: () => setProblem(undefined),
  };
  return <GoogleCalendarContext value={calendar}>{children}</GoogleCalendarContext>;
}

/** The Google Calendar of the `GoogleCalendarProvider` around the calling component. */
export function useGoogleCalendar(): GoogleCalendar {
  const calendar = use(GoogleCalendarContext);
  if (!calendar) throw new Error("useGoogleCalendar needs a GoogleCalendarProvider around it.");
  return calendar;
}

/** The account menu's entry for Google Calendar: where the member's connection stands, with ways to
 *  connect, reconnect or disconnect. Disconnecting asks first. */
export function GoogleCalendarEntry() {
  const { connection, problem, busy, connect, disconnect } = useGoogleCalendar();
  const [confirming, setConfirming] = useState(false);
  const needsReconnecting = connection?.state === GoogleConnectionState.NEEDS_RECONNECTING;

  return (
    <View style={styles.entry}>
      <Text style={styles.line}>Google Calendar: {describeConnection(connection)}</Text>
      {problem ? <Text style={styles.problem}>{problem}</Text> : null}
      {confirming ? (
        <View style={styles.entry}>
          <Text style={styles.line}>
            The calendars in your Google account pause until you connect again. They stay in Google.
          </Text>
          <View style={styles.row}>
            <Button
              title="Disconnect"
              onPress={() => {
                setConfirming(false);
                disconnect();
              }}
            />
            <Button title="Stay connected" onPress={() => setConfirming(false)} />
          </View>
        </View>
      ) : (
        <View style={styles.row}>
          {connection && !needsReconnecting ? null : (
            <Button
              title={needsReconnecting ? "Reconnect Google Calendar" : "Connect Google Calendar"}
              disabled={busy}
              onPress={connect}
            />
          )}
          {connection ? (
            <Button
              title="Disconnect Google Calendar"
              disabled={busy}
              onPress={() => setConfirming(true)}
            />
          ) : null}
        </View>
      )}
    </View>
  );
}

/** Asks the member to connect Google Calendar, or to reconnect it when Google stopped accepting
 *  Foyer's access, and says why connecting just didn't work. Shows nothing once they're
 *  connected. */
export function ConnectGooglePrompt() {
  const { connection, problem, busy, connect, dismissProblem } = useGoogleCalendar();
  const connected = connection?.state === GoogleConnectionState.CONNECTED;
  if (connected && !problem) return null;
  const needsReconnecting = connection?.state === GoogleConnectionState.NEEDS_RECONNECTING;

  return (
    <View style={styles.prompt}>
      <View style={styles.grow}>
        {connected ? null : (
          <Text style={styles.line}>
            {needsReconnecting
              ? "Google stopped accepting Foyer's access. Reconnect to resume the calendars in your Google account."
              : "Connect Google Calendar to keep a Google calendar for each of your spaces."}
          </Text>
        )}
        {problem ? <Text style={styles.problem}>{problem}</Text> : null}
      </View>
      {connected ? (
        <Button title="Dismiss" onPress={dismissProblem} />
      ) : (
        <Button
          title={needsReconnecting ? "Reconnect Google Calendar" : "Connect Google Calendar"}
          disabled={busy}
          onPress={connect}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  entry: { gap: 4, maxWidth: 320 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  grow: { flex: 1, gap: 4 },
  line: { fontSize: 12, color: "#6b6459" },
  problem: { fontSize: 12, color: "#9a3b2e" },
  prompt: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomColor: "#d8d2c4",
    borderBottomWidth: 1,
  },
});

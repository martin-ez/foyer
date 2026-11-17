import { ConnectError } from "@connectrpc/connect";
import type { GetKeyResponse } from "@foyer/shared/gen/foyer/capture/v1/capture_pb";
import { useEffect, useState } from "react";
import { Button, StyleSheet, Text, View } from "react-native";
import { captureAddress, captureClient } from "../backend/backend";
import { describeCaptureKey } from "./capture-key";
import { copyText } from "./copy-text";

/** Sets up capturing from an iOS Shortcut: the address it sends captures to, and the member's
 *  capture key, which they make, replace or remove here. A new key is shown once, to copy. */
export function ShortcutsPanel() {
  const [key, setKey] = useState<GetKeyResponse | null>(null);
  const [made, setMade] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let shown = true;
    captureClient.getKey({}).then(
      (got) => shown && setKey(got),
      (error) => shown && setProblem(`Couldn't check your capture key: ${messageOf(error)}`),
    );
    return () => {
      shown = false;
    };
  }, []);

  const run = async (doing: string, call: () => Promise<void>) => {
    setBusy(true);
    setProblem(null);
    try {
      await call();
    } catch (error) {
      setProblem(`Couldn't ${doing}: ${messageOf(error)}`);
    } finally {
      setBusy(false);
    }
  };
  const make = () =>
    run("make a capture key", async () => {
      setMade((await captureClient.makeKey({})).key);
      setKey(await captureClient.getKey({}));
    });
  const remove = () =>
    run("remove your capture key", async () => {
      await captureClient.removeKey({});
      setMade(null);
      setKey(await captureClient.getKey({}));
    });
  const copy = (what: string, text: string) => run(`copy the ${what}`, () => copyText(text));

  return (
    <View style={styles.panel}>
      <Text style={styles.heading} role="heading">
        Shortcuts
      </Text>
      <Text style={styles.line}>
        An iOS Shortcut can add tasks to your Inbox, with a capture key, by sending them to:
      </Text>
      <Text style={styles.value} selectable aria-label="Capture address">
        {captureAddress}
      </Text>
      <Button title="Copy address" onPress={() => copy("address", captureAddress)} />
      {made ? (
        <>
          <Text style={styles.line}>Your new capture key. Copy it now: it isn't shown again.</Text>
          <Text style={styles.value} selectable aria-label="Capture key">
            {made}
          </Text>
          <Button title="Copy key" onPress={() => copy("key", made)} />
        </>
      ) : null}
      <Text style={styles.line}>
        {key ? describeCaptureKey(key) : "Checking your capture key…"}
      </Text>
      <View style={styles.row}>
        <Button
          title={key?.exists ? "Replace key" : "Make key"}
          disabled={!key || busy}
          onPress={make}
        />
        {key?.exists ? <Button title="Remove key" disabled={busy} onPress={remove} /> : null}
      </View>
      {problem ? <Text style={styles.problem}>{problem}</Text> : null}
    </View>
  );
}

function messageOf(error: unknown): string {
  return ConnectError.from(error).rawMessage;
}

const styles = StyleSheet.create({
  panel: { gap: 6, maxWidth: 360 },
  heading: { fontSize: 14, fontWeight: "600" },
  row: { flexDirection: "row", gap: 8 },
  line: { fontSize: 12, color: "#6b6459" },
  value: { fontSize: 12, fontFamily: "monospace" },
  problem: { fontSize: 12, color: "#9a3b2e" },
});

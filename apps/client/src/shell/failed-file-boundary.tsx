import { usePathname } from "expo-router";
import { Component, type ReactNode, useEffect, useState } from "react";
import { Button, StyleSheet, Text, View } from "react-native";
import {
  checkFailedFile,
  type FailedFileCheck,
  fileThatFailedToLoad,
  reloadApp,
  reloadForFile,
} from "./app-files";
import { useHousehold } from "./household";

/** Shows its children, or, when the open view's file didn't load, as after a deploy replaced it,
 *  reloads the app once nothing is left unsaved, or says why the view can't open. Opening another
 *  view tries again. Any other error passes through. */
export function FailedFileBoundary({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return <Boundary openedAt={pathname}>{children}</Boundary>;
}

type BoundaryProps = { openedAt: string; children: ReactNode };
type BoundaryState = { openedAt: string; failed: { error: unknown } | null };

class Boundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { openedAt: this.props.openedAt, failed: null };

  static getDerivedStateFromError(error: unknown): Partial<BoundaryState> {
    return { failed: { error } };
  }

  static getDerivedStateFromProps(
    props: BoundaryProps,
    state: BoundaryState,
  ): Partial<BoundaryState> | null {
    return props.openedAt === state.openedAt ? null : { openedAt: props.openedAt, failed: null };
  }

  override render() {
    const { failed } = this.state;
    if (!failed) return this.props.children;
    const file = fileThatFailedToLoad(failed.error);
    if (!file) throw failed.error;
    return <FailedFile file={file} />;
  }
}

function FailedFile({ file }: { file: string }) {
  const { state } = useHousehold();
  const [check, setCheck] = useState<FailedFileCheck | null>(null);

  useEffect(() => {
    let shown = true;
    checkFailedFile(file).then((result) => {
      if (shown) setCheck(result);
    });
    return () => {
      shown = false;
    };
  }, [file]);

  useEffect(() => {
    if (check === "reload" && state.unsaved === 0 && !reloadForFile(file)) setCheck("missing");
  }, [check, state.unsaved, file]);

  switch (check) {
    case null:
      return <Message line="Opening…" />;
    case "reload":
      return (
        <Message
          line={
            state.unsaved > 0
              ? "Foyer has been updated. It reloads once your changes are saved."
              : "Foyer has been updated. Reloading…"
          }
        />
      );
    case "offline":
      return (
        <Message
          line="This view can't open while offline. Reload once you're back online."
          reload
        />
      );
    case "missing":
      return <Message line="This view can't open: one of its files is missing." reload />;
  }
}

function Message({ line, reload = false }: { line: string; reload?: boolean }) {
  return (
    <View style={styles.message}>
      <Text style={styles.line}>{line}</Text>
      {reload ? <Button title="Reload" onPress={reloadApp} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  message: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  line: { fontSize: 15, color: "#3d3830", textAlign: "center" },
});

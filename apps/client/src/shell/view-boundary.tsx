import { usePathname } from "expo-router";
import { Component, type ReactNode, useEffect, useState } from "react";
import { Button, StyleSheet, Text, View } from "react-native";
import {
  canReloadApp,
  checkFailedFile,
  type FailedFileCheck,
  fileThatFailedToLoad,
  reloadApp,
  reloadForFile,
} from "./app-files";
import { useHousehold } from "./household";

/** Shows the open view, or, when drawing it fails, a message in its place that keeps the frame and
 *  the household's connection, so unsaved changes are still sent. Reloading waits until nothing is
 *  unsaved, as it does for a view whose file a deploy replaced. Opening another view tries again. */
export function ViewBoundary({ children }: { children: ReactNode }) {
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

  private readonly tryAgain = () => this.setState({ failed: null });

  override render() {
    const { failed } = this.state;
    if (!failed) return this.props.children;
    const file = fileThatFailedToLoad(failed.error);
    return file ? <FailedFile file={file} /> : <FailedView onTryAgain={this.tryAgain} />;
  }
}

function FailedView({ onTryAgain }: { onTryAgain: () => void }) {
  const { state } = useHousehold();
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    if (reloading && state.unsaved === 0) reloadApp();
  }, [reloading, state.unsaved]);

  if (reloading) {
    return (
      <Message
        line={state.unsaved > 0 ? "Foyer reloads once your changes are saved." : "Reloading Foyer…"}
      />
    );
  }
  const action = canReloadApp
    ? { title: "Reload", onPress: () => setReloading(true) }
    : { title: "Try again", onPress: onTryAgain };
  return <Message line="This view couldn't be shown." action={action} />;
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
          action={reloadAtOnce}
        />
      );
    case "missing":
      return (
        <Message line="This view can't open: one of its files is missing." action={reloadAtOnce} />
      );
  }
}

type Action = { title: string; onPress: () => void };

const reloadAtOnce: Action = { title: "Reload", onPress: reloadApp };

function Message({ line, action }: { line: string; action?: Action }) {
  return (
    <View style={styles.message}>
      <Text style={styles.line}>{line}</Text>
      {action ? <Button title={action.title} onPress={action.onPress} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  message: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  line: { fontSize: 15, color: "#3d3830", textAlign: "center" },
});

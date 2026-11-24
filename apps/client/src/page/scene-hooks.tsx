import { readStrokeFixture, redrawnAt } from "@foyer/shared";
import { strokeFixtures } from "@foyer/shared/stroke-fixtures";
import { useEffect, useMemo, useRef } from "react";
import { Platform, StyleSheet, Text } from "react-native";
import { handleDevLink } from "../shell/dev-links";
import { useHousehold } from "../shell/household";
import { setTestHooks } from "../shell/test-hooks";
import type { OpenPage } from "./open-page";
import { pageIdOf } from "./open-page";
import { sceneOf } from "./scene";

/** Lets checks read the open page and add stroke fixtures to it, in development builds only: in
 *  the web app as `window.foyerTest.scene()` and `addStrokes(fixture)`, and on the iPad through
 *  `foyer://dev/add-strokes?fixture=<name>` and an element with the test id `scene`, which holds
 *  `scene()` as JSON. */
export function SceneHooks({ page }: { page: OpenPage }) {
  const { state, sync } = useHousehold();
  const { pages, items, stickers, strokes } = state;
  const scene = useMemo(
    () => sceneOf(page, { pages, items, stickers, strokes }),
    [page, pages, items, stickers, strokes],
  );
  const shown = useRef(page);
  shown.current = page;
  const pageId = pageIdOf(page);

  useEffect(() => {
    const addStrokes = (fixture: unknown) => {
      const added = readStrokeFixture(fixture);
      const at = redrawnAt(added, Date.now());
      return added.map((stroke, index) =>
        sync.addStroke(pageId, { ...stroke, drawnAt: at[index] ?? stroke.drawnAt }),
      );
    };
    const scene = () => sceneOf(shown.current, sync.getState());
    const unset = setTestHooks({ scene, addStrokes });
    const unhandle = handleDevLink("add-strokes", (params) => {
      const name = params.get("fixture") ?? "";
      const fixture = strokeFixtures[name];
      if (fixture) addStrokes(fixture);
      else console.error(`There's no stroke fixture named "${name}".`);
    });
    return () => {
      unset();
      unhandle();
    };
  }, [sync, pageId]);

  if (Platform.OS === "web") return null;
  return (
    <Text testID="scene" numberOfLines={1} style={styles.scene}>
      {JSON.stringify(scene)}
    </Text>
  );
}

const styles = StyleSheet.create({
  scene: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 2,
    fontSize: 1,
    color: "transparent",
    pointerEvents: "none",
  },
});

import { Input, type Stroke, Tool } from "@foyer/shared/gen/foyer/ink/v1/ink_pb";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import {
  type EraserMoved,
  isSimulator,
  PencilView,
  type PencilViewHandle,
  type StrokeDrawn,
} from "../../modules/foyer-ink";
import type { Point } from "../page/sheet-camera";
import type { HouseholdSync } from "../sync/household-sync";
import { eraserReach, strokesCrossed } from "./eraser";
import { defaultInkSize } from "./ink-width";
import { inkColours, type PencilChoice, usePencilChoice } from "./pencil-choice";
import { samplesInPieces } from "./stroke-pieces";

/** The Apple Pencil's view over a page. It adds what the pen writes, and erases the strokes the
 *  eraser passes over, hiding them with `onErasing` until it lifts. */
export function PagePencil({
  pageId,
  strokes,
  sync,
  onErasing,
}: {
  pageId: string;
  strokes: readonly Stroke[];
  sync: HouseholdSync;
  onErasing: (strokeIds: ReadonlySet<string>) => void;
}) {
  const pencil = useRef<PencilViewHandle>(null);
  const [choice] = usePencilChoice();
  const [drawnUpTo, setDrawnUpTo] = useState(0);
  useEffect(() => {
    if (drawnUpTo > 0) pencil.current?.strokeDrawn(drawnUpTo);
  }, [drawnUpTo]);
  const pass = useRef<{ erased: Set<string>; at: Point } | null>(null);

  const add = ({ nativeEvent: drawn }: { nativeEvent: StrokeDrawn }) => {
    for (const samples of samplesInPieces(drawn)) {
      sync.addStroke(pageId, {
        drawnAt: drawn.drawnAt,
        input: drawn.input === "pencil" ? Input.PENCIL : Input.FINGER,
        tool: drawn.tool === "monoline" ? Tool.MONOLINE : Tool.PEN,
        colour: drawn.colour,
        size: drawn.size,
        samples,
      });
    }
    setDrawnUpTo(drawn.handoff);
  };

  const erase = ({ nativeEvent: { phase, x, y, zoom } }: { nativeEvent: EraserMoved }) => {
    const at = { x, y };
    if (phase === "start") pass.current = { erased: new Set(), at };
    const current = pass.current;
    if (!current) return;
    const left = strokes.filter(({ id }) => !current.erased.has(id));
    for (const id of strokesCrossed(left, current.at, at, eraserReach / zoom)) {
      current.erased.add(id);
    }
    current.at = at;
    if (phase === "end") {
      sync.eraseStrokes([...current.erased]);
      pass.current = null;
      onErasing(new Set());
    } else {
      onErasing(new Set(current.erased));
    }
  };

  return (
    <PencilView
      ref={pencil}
      style={styles.fill}
      tool={choice.tool}
      colour={choice.colour}
      size={defaultInkSize}
      mouseDraws={choice.mouseDraws}
      onStrokeDrawn={add}
      onErase={erase}
    />
  );
}

/** The Pencil's tools: a pen, a line of even width or the eraser, and the ink's colour. In the
 *  simulator, also a switch to draw with the mouse instead of the Pencil. */
export function InkBar() {
  const [choice, choose] = usePencilChoice();
  const tools: { tool: PencilChoice["tool"]; label: string }[] = [
    { tool: "pen", label: "Pen" },
    { tool: "monoline", label: "Even line" },
    { tool: "eraser", label: "Eraser" },
  ];
  return (
    <View style={styles.bar}>
      {tools.map(({ tool, label }) => (
        <Pressable
          key={tool}
          accessibilityRole="button"
          accessibilityState={{ selected: choice.tool === tool }}
          onPress={() => choose({ tool })}
          style={[styles.tool, choice.tool === tool && styles.chosen]}
        >
          <Text>{label}</Text>
        </Pressable>
      ))}
      {inkColours.map(({ name, colour }) => (
        <Pressable
          key={name}
          accessibilityRole="button"
          accessibilityLabel={`${name} ink`}
          accessibilityState={{ selected: choice.colour === colour && choice.tool !== "eraser" }}
          onPress={() => choose({ colour, tool: choice.tool === "eraser" ? "pen" : choice.tool })}
          style={[
            styles.swatch,
            { backgroundColor: `#${colour.toString(16).padStart(6, "0")}` },
            choice.colour === colour && styles.chosenSwatch,
          ]}
        />
      ))}
      {isSimulator ? (
        <View style={styles.mouse}>
          <Text accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            Draw with the mouse
          </Text>
          <Switch
            accessibilityLabel="Draw with the mouse"
            value={choice.mouseDraws}
            onValueChange={(mouseDraws) => choose({ mouseDraws })}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0, pointerEvents: "box-none" },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  tool: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4 },
  chosen: { backgroundColor: "#e9e4da" },
  swatch: { width: 22, height: 22, borderRadius: 11 },
  chosenSwatch: { borderWidth: 2, borderColor: "#e9e4da" },
  mouse: { flexDirection: "row", alignItems: "center", gap: 6, marginLeft: "auto" },
});

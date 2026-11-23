import { requireNativeModule, requireNativeView } from "expo";
import type { ComponentType, Ref } from "react";
import type { StyleProp, ViewStyle } from "react-native";

/** What the Pencil does: writes with a pen whose width follows pressure, a line of even width, or
 *  erases whole strokes. */
export type PencilTool = "pen" | "monoline" | "eraser";

/** A stroke PencilKit drew, in the page's points, sent when the pen lifts. The Pencil's force,
 *  from 0 to 1, and tilt, in radians, are empty for a stroke drawn with the mouse. */
export type StrokeDrawn = {
  handoff: number;
  drawnAt: number;
  input: "pencil" | "finger";
  tool: "pen" | "monoline";
  colour: number;
  size: number;
  x: number[];
  y: number[];
  time: number[];
  force: number[];
  altitude: number[];
  azimuth: number[];
};

/** Where the eraser is, in the page's points, as it touches down, moves and lifts, and how many
 *  screen points one page point takes. */
export type EraserMoved = { phase: "start" | "move" | "end"; x: number; y: number; zoom: number };

/** Calls on the Pencil's view. */
export type PencilViewHandle = {
  /** Says Skia drew every stroke up to hand-off `handoff`, so PencilKit can let go of them. */
  strokeDrawn(handoff: number): Promise<void>;
};

/** The Pencil's view, laid over a page in its own points, inside the view that zooms the page. It
 *  takes only the Pencil's touches. */
export const PencilView: ComponentType<{
  ref?: Ref<PencilViewHandle>;
  tool: PencilTool;
  colour: number;
  size: number;
  mouseDraws?: boolean;
  onStrokeDrawn?: (event: { nativeEvent: StrokeDrawn }) => void;
  onErase?: (event: { nativeEvent: EraserMoved }) => void;
  style?: StyleProp<ViewStyle>;
}> = requireNativeView("FoyerInk");

/** Whether the app runs in the iPad simulator, where the mouse can draw instead of the Pencil. */
export const isSimulator: boolean = requireNativeModule<{ isSimulator: boolean }>(
  "FoyerInk",
).isSimulator;

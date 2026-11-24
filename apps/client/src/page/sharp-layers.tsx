import type { ReactNode } from "react";
import { Group } from "react-native-skia";

/** Where a page rests on the screen: the part of it shown, in points from its top-left corner,
 *  and how many screen points one point of the page takes. */
export type Rest = { x: number; y: number; width: number; height: number; zoom: number };

/** The page drawn again over the part of it a rest shows, at the zoom of that rest. */
export type SharpLayer = { key: number; rest: Rest; drawn: boolean };

/** The sharp layers over a page, the newest last, and the part of the page where only the drawn
 *  layer shows the ink, so that the page's softer ink doesn't show around its strokes. */
export type SharpLayers = {
  rest: Rest | null;
  layers: readonly SharpLayer[];
  inkHiddenIn: Rest | null;
  nextKey: number;
};

export const noSharpLayers: SharpLayers = { rest: null, layers: [], inkHiddenIn: null, nextKey: 1 };

/** Whether a page resting at `rest` shows more detail than its own canvas holds, which has as
 *  many pixels for each point of the page as the screen has for each of its points. */
export function needsSharpLayer(rest: Rest): boolean {
  return rest.zoom > 1.001;
}

/** The page came to rest: a new layer goes on top, unless the rest needs none, and layers not
 *  drawn yet go. Without a new layer, the ink shows everywhere again, and `cleared` removes the
 *  layers once it does. */
export function restedAt(sharp: SharpLayers, rest: Rest): SharpLayers {
  const layers = sharp.layers.filter(({ drawn }) => drawn);
  if (!needsSharpLayer(rest)) return { ...sharp, rest, layers, inkHiddenIn: null };
  const layer = { key: sharp.nextKey, rest, drawn: false };
  return { ...sharp, rest, layers: [...layers, layer], nextKey: sharp.nextKey + 1 };
}

/** The layer `key` is drawn: the layers under it go, and the page's ink hides where it lies. */
export function layerDrawn(sharp: SharpLayers, key: number): SharpLayers {
  const index = sharp.layers.findIndex((layer) => layer.key === key);
  const layer = sharp.layers[index];
  if (!layer || !sharp.rest || !needsSharpLayer(sharp.rest)) return sharp;
  const layers = [{ ...layer, drawn: true }, ...sharp.layers.slice(index + 1)];
  return { ...sharp, layers, inkHiddenIn: layer.rest };
}

/** The page shows its ink everywhere again after a rest that needs no layer: the layers go. */
export function cleared(sharp: SharpLayers): SharpLayers {
  if (!sharp.rest || needsSharpLayer(sharp.rest) || sharp.layers.length === 0) return sharp;
  return { ...sharp, layers: [] };
}

/** Skia elements in a page's own points, drawn as a sharp layer at `rest` draws them: in screen
 *  points from the top-left corner of the part of the page shown. */
export function SharpDrawing({ rest, children }: { rest: Rest; children?: ReactNode }) {
  const { x, y, zoom } = rest;
  return (
    <Group transform={[{ translateX: -x * zoom }, { translateY: -y * zoom }, { scale: zoom }]}>
      {children}
    </Group>
  );
}

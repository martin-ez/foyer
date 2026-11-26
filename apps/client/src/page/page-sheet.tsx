import type { PageSize } from "@foyer/shared";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import { Canvas, Group } from "react-native-skia";
import { type PageRest, SharpZoomView } from "../../modules/foyer-ink";
import { handleDevLink } from "../shell/dev-links";
import { deskColour } from "./desk-drawing";
import { PageDrawing, type Ruling } from "./page-drawing";
import { PageScale } from "./page-scale";
import {
  cleared,
  layerDrawn,
  needsSharpLayer,
  noSharpLayers,
  type Rest,
  restedAt,
  SharpDrawing,
  type SharpLayer,
} from "./sharp-layers";
import { type PagePart, type Point, partShown, type Size, zoomLimits } from "./sheet-camera";
import { tapSlop } from "./sticker-drag";

/** A page lying on the desk, fitted to it at first, in a view that iOS zooms and moves as one sheet,
 *  so everything on the page moves with it in every frame of a pinch, drawn again sharp once it
 *  rests. A touch that moves or zooms the page isn't a tap. */
export function PageSheet({
  size,
  ruling,
  drawn,
  label,
  onPoint,
  onTap,
  children,
  ink,
  pencil,
}: {
  size: PageSize;
  /** What's printed on the page, such as a calendar's grid. */
  ruling?: Ruling;
  /** Skia elements drawn on the page above what's printed on it, in its own points, such as its
   *  text. */
  drawn?: ReactNode;
  label: string;
  /** Called with each touch on the page, in points from its top-left corner. */
  onPoint?: (at: Point) => void;
  /** Called when the page itself is tapped, rather than something on it, in points from its
   *  top-left corner. */
  onTap?: (at: Point) => void;
  /** Views above the page, laid out in its own points. Only those that ask for touches, such as
   *  stickers, take them. */
  children?: ReactNode;
  /** Skia elements drawn above everything else on the page, in its own points, such as its ink. */
  ink?: ReactNode;
  /** A view over the whole page, laid out in its own points, that takes the Apple Pencil. */
  pencil?: ReactNode;
}) {
  const [view, setView] = useState<Size | null>(null);
  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setView({ width, height });
  };
  const limits = view && zoomLimits(view, size);
  const scroll = useRef<ScrollViewInstance>(null);
  const shownView = useRef(view);
  shownView.current = view;
  useEffect(() => {
    if (!__DEV__) return;
    return handleDevLink("zoom", (params) =>
      zoomWhenAsked(scroll.current, shownView.current, params),
    );
  }, []);
  // iOS ignores a zoom set before the sheet has a size, as the first `zoomScale` would be, so the
  // sheet is fitted once it's laid out, and again whenever the desk's size changes the fit.
  const fit = limits?.smallest ?? 0;
  useEffect(() => {
    const shown = shownView.current;
    if (!(fit > 0) || !shown) return;
    const middle = { x: size.width / 2, y: size.height / 2 };
    zoomTo(scroll.current, partShown(shown, fit, middle), false);
  }, [fit, size.width, size.height]);
  const fitted = useRef(1);
  fitted.current = fit || 1;
  const zoomed = useRef<number | null>(null);
  const scale = useCallback(() => zoomed.current ?? fitted.current, []);
  const followZoom = ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { zoomScale } = nativeEvent;
    if (zoomScale !== undefined && zoomScale > 0) zoomed.current = zoomScale;
  };
  const sheet = { width: size.width, height: size.height };
  const [sharp, setSharp] = useState(noSharpLayers);
  const rested = useCallback(({ nativeEvent }: { nativeEvent: PageRest }) => {
    setSharp((before) => restedAt(before, nativeEvent));
  }, []);
  const drawnLayer = useCallback((key: number) => {
    setSharp((before) => layerDrawn(before, key));
  }, []);
  useEffect(() => {
    if (!sharp.rest || needsSharpLayer(sharp.rest) || sharp.layers.length === 0) return;
    return afterPresenting(() => setSharp(cleared));
  }, [sharp]);
  const page = useMemo(
    () => (
      <PageDrawing size={size} ruling={ruling}>
        {drawn}
      </PageDrawing>
    ),
    [size, ruling, drawn],
  );
  const hidden = sharp.inkHiddenIn;
  const softInk = useMemo(() => {
    if (!hidden) return ink;
    const { x, y, width, height } = hidden;
    return (
      <Group clip={{ x, y, width, height }} invertClip>
        {ink}
      </Group>
    );
  }, [ink, hidden]);
  const touched = ({ nativeEvent }: GestureResponderEvent) => {
    const at = { x: nativeEvent.locationX, y: nativeEvent.locationY };
    if (at.x >= 0 && at.y >= 0 && at.x <= size.width && at.y <= size.height) onPoint?.(at);
  };
  const tapFrom = useRef<Point | null>(null);
  const tapped = ({ nativeEvent }: GestureResponderEvent) => {
    const from = tapFrom.current;
    tapFrom.current = null;
    if (!from || Math.hypot(nativeEvent.pageX - from.x, nativeEvent.pageY - from.y) >= tapSlop) {
      return;
    }
    onTap?.({ x: nativeEvent.locationX, y: nativeEvent.locationY });
  };

  return (
    <View style={styles.desk} onLayout={onLayout} accessibilityLabel={label}>
      {limits && limits.smallest > 0 ? (
        <ScrollView
          ref={scroll}
          style={styles.desk}
          contentContainerStyle={sheet}
          minimumZoomScale={limits.smallest}
          maximumZoomScale={limits.largest}
          centerContent
          bouncesZoom
          onScroll={followZoom}
          scrollEventThrottle={16}
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
        >
          <View style={[sheet, styles.paper]} onTouchStart={touched} onTouchMove={touched}>
            <View
              style={sheet}
              onStartShouldSetResponder={() => onTap !== undefined}
              onResponderGrant={({ nativeEvent }) => {
                tapFrom.current = { x: nativeEvent.pageX, y: nativeEvent.pageY };
              }}
              onResponderRelease={tapped}
              onResponderTerminate={() => {
                tapFrom.current = null;
              }}
            >
              <Canvas style={sheet}>{page}</Canvas>
            </View>
            {sharp.layers.map((layer) => (
              <SharpCanvas key={layer.key} layer={layer} onDrawn={drawnLayer}>
                {page}
              </SharpCanvas>
            ))}
            <View style={[sheet, styles.above]}>
              <PageScale value={scale}>{children}</PageScale>
            </View>
            {ink ? <Canvas style={[sheet, styles.over]}>{softInk}</Canvas> : null}
            {ink
              ? sharp.layers.map((layer) => (
                  <SharpCanvas key={layer.key} layer={layer}>
                    {ink}
                  </SharpCanvas>
                ))
              : null}
            <SharpZoomView style={[sheet, styles.over]} onRest={rested} />
            {pencil ? <View style={[sheet, styles.over]}>{pencil}</View> : null}
          </View>
        </ScrollView>
      ) : null}
      {__DEV__ && sharp.rest ? <RestForChecks page={size} rest={sharp.rest} /> : null}
    </View>
  );
}

/** Where the page last came to rest, for the iPad's checks to read as JSON from the element
 *  `page-rest`: the part of the page shown, in its points, the zoom, and the page's size. */
function RestForChecks({ page, rest }: { page: PageSize; rest: Rest }) {
  const read = { ...rest, page: { width: page.width, height: page.height } };
  return (
    <Text testID="page-rest" numberOfLines={1} style={styles.forChecks}>
      {JSON.stringify(read)}
    </Text>
  );
}

function SharpCanvas({
  layer: { key, rest, drawn },
  onDrawn,
  children,
}: {
  layer: SharpLayer;
  onDrawn?: (key: number) => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (drawn || !onDrawn) return;
    return afterPresenting(() => onDrawn(key));
  }, [key, drawn, onDrawn]);
  const style = useMemo(() => placementOf(rest), [rest]);
  const drawing = useMemo(
    () => <SharpDrawing rest={rest}>{children}</SharpDrawing>,
    [rest, children],
  );
  return <Canvas style={style}>{drawing}</Canvas>;
}

function placementOf({ x, y, width, height, zoom }: Rest): ViewStyle {
  return {
    position: "absolute",
    left: 0,
    top: 0,
    width: width * zoom,
    height: height * zoom,
    pointerEvents: "none",
    transformOrigin: [0, 0, 0],
    transform: [{ translateX: x }, { translateY: y }, { scale: 1 / zoom }],
  };
}

function afterPresenting(then: () => void): () => void {
  const timer = setTimeout(then, presentedAfter);
  return () => clearTimeout(timer);
}

const presentedAfter = 150;

function zoomWhenAsked(
  scroll: ScrollViewInstance | null,
  view: Size | null,
  params: URLSearchParams,
) {
  const read = (name: string) => (params.has(name) ? Number(params.get(name)) : Number.NaN);
  const [scale, x, y] = [read("scale"), read("x"), read("y")];
  if (!scroll || !view || !(scale > 0) || !Number.isFinite(x) || !Number.isFinite(y)) {
    console.error(`Zooming needs a scale, an x and a y, but got "${params}".`);
    return;
  }
  zoomTo(scroll, partShown(view, scale, { x, y }), params.get("animated") === "1");
}

function zoomTo(scroll: ScrollViewInstance | null, part: PagePart, animated: boolean) {
  scroll?.scrollResponderZoomTo({ ...part, animated }, animated);
}

const styles = StyleSheet.create({
  desk: { flex: 1, backgroundColor: deskColour },
  paper: { boxShadow: "0 2px 8px rgba(0, 0, 0, 0.18)" },
  above: { position: "absolute", left: 0, top: 0, pointerEvents: "box-none" },
  over: { position: "absolute", left: 0, top: 0, pointerEvents: "box-none" },
  forChecks: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: 2,
    fontSize: 1,
    color: "transparent",
    pointerEvents: "none",
  },
});

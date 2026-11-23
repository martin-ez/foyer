import type { PageSize } from "@foyer/shared";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { type LayoutChangeEvent, StyleSheet, View } from "react-native";
import { Canvas } from "react-native-skia";
import { DeskDrawing } from "./desk-drawing";
import type { Ruling } from "./page-drawing";
import { PageScale } from "./page-scale";
import {
  type Camera,
  fittedCamera,
  type Point,
  panCamera,
  pointOnPage,
  resizeCamera,
  type Size,
  zoomCamera,
} from "./sheet-camera";
import { tapSlop } from "./sticker-drag";

/** A page lying on the desk, drawn by Skia in a canvas the size of the view. Pinching, or scrolling
 *  with ctrl held, zooms it; dragging or scrolling moves it. It opens fitted to the desk. A click
 *  that doesn't move is a tap. */
export function PageSheet({
  size,
  ruling,
  drawn,
  label,
  onPoint,
  onTap,
  children,
  ink,
}: {
  size: PageSize;
  /** What's printed on the page, such as a calendar's grid. */
  ruling?: Ruling;
  /** Skia elements drawn on the page above what's printed on it, in its own points, such as its
   *  text. */
  drawn?: ReactNode;
  label: string;
  /** Called as the pointer moves over the page, in points from its top-left corner. */
  onPoint?: (at: Point) => void;
  /** Called when the page itself is clicked or tapped, rather than something on it, in points from
   *  its top-left corner. */
  onTap?: (at: Point) => void;
  /** Views above the page, laid out in its own points. Only those that ask for the pointer, such
   *  as stickers, take it. */
  children?: ReactNode;
  /** Skia elements drawn on the page above its text, in its own points, such as its ink. */
  ink?: ReactNode;
  /** The Apple Pencil's view, which the web app doesn't have. */
  pencil?: ReactNode;
}) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const keepHost = useCallback((view: unknown) => setHost(view as HTMLElement | null), []);
  const page = useRef(size);
  page.current = size;
  const pointing = useRef<((at: Point) => void) | undefined>(undefined);
  const tapping = useRef<((at: Point) => void) | undefined>(undefined);
  const [desk, setDesk] = useState<{ view: Size; camera: Camera }>({
    view: { width: 0, height: 0 },
    camera: { x: 0, y: 0, scale: 0 },
  });

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setDesk(({ view, camera }) => ({
      view: { width, height },
      camera: resizeCamera(camera, view, { width, height }, page.current),
    }));
  };

  useEffect(() => {
    if (!host) return;
    return followGestures(host, {
      zoom: (factor, focus, pan) =>
        setDesk(({ view, camera }) => ({
          view,
          camera: zoomCamera(camera, view, page.current, factor, focus, pan),
        })),
      pan: (by) =>
        setDesk(({ view, camera }) => ({
          view,
          camera: panCamera(camera, view, page.current, by),
        })),
      point: (at) => pointing.current?.(at),
      tap: (at) => tapping.current?.(at),
    });
  }, [host]);

  const camera = desk.camera.scale > 0 ? desk.camera : fittedCamera(desk.view, size);
  const shown = useRef(camera);
  shown.current = camera;
  const scale = useCallback(() => shown.current.scale || 1, []);
  const onThePage = (at: Point, then?: (onPage: Point) => void) => {
    const onPage = pointOnPage(camera, at);
    const { width, height } = page.current;
    if (onPage.x >= 0 && onPage.y >= 0 && onPage.x <= width && onPage.y <= height) {
      then?.(onPage);
    }
  };
  pointing.current = (at) => onThePage(at, onPoint);
  tapping.current = (at) => onThePage(at, onTap);
  return (
    <View ref={keepHost} style={styles.desk} onLayout={onLayout} accessibilityLabel={label}>
      <Canvas style={styles.fill}>
        <DeskDrawing page={size} ruling={ruling} camera={camera}>
          {drawn}
          {ink}
        </DeskDrawing>
      </Canvas>
      <View
        style={[
          styles.above,
          {
            width: size.width,
            height: size.height,
            transform: [
              { translateX: camera.x },
              { translateY: camera.y },
              { scale: camera.scale },
            ],
          },
        ]}
      >
        <PageScale value={scale}>{children}</PageScale>
      </View>
    </View>
  );
}

type Gestures = {
  zoom(factor: number, focus: Point, pan: Point): void;
  pan(by: Point): void;
  point(at: Point): void;
  tap(at: Point): void;
};

type SafariTrackpadPinch = Event & { scale: number; clientX: number; clientY: number };

const still: Point = { x: 0, y: 0 };

function followGestures(element: HTMLElement, gestures: Gestures): () => void {
  const pointers = new Map<number, Point>();
  let tapFrom: { pointerId: number; at: Point } | null = null;
  let gestureScale = 1;
  const at = (event: { clientX: number; clientY: number }): Point => {
    const box = element.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  const listeners: [string, (event: never) => void, AddEventListenerOptions?][] = [
    [
      "pointerdown",
      (event: PointerEvent) => {
        element.setPointerCapture(event.pointerId);
        tapFrom =
          pointers.size === 0 && event.button === 0
            ? { pointerId: event.pointerId, at: at(event) }
            : null;
        pointers.set(event.pointerId, at(event));
      },
    ],
    [
      "pointermove",
      (event: PointerEvent) => {
        gestures.point(at(event));
        const before = pointers.get(event.pointerId);
        if (!before) return;
        const now = at(event);
        const other = [...pointers].find(([id]) => id !== event.pointerId)?.[1];
        pointers.set(event.pointerId, now);
        if (!other) {
          gestures.pan({ x: now.x - before.x, y: now.y - before.y });
          return;
        }
        const apart = distance(before, other);
        if (apart === 0) return;
        const from = midpoint(before, other);
        const to = midpoint(now, other);
        gestures.zoom(distance(now, other) / apart, from, { x: to.x - from.x, y: to.y - from.y });
      },
    ],
    [
      "pointerup",
      (event: PointerEvent) => {
        pointers.delete(event.pointerId);
        const from = tapFrom;
        if (from?.pointerId !== event.pointerId) return;
        tapFrom = null;
        if (distance(from.at, at(event)) < tapSlop) gestures.tap(at(event));
      },
    ],
    [
      "pointercancel",
      (event: PointerEvent) => {
        pointers.delete(event.pointerId);
        tapFrom = null;
      },
    ],
    [
      "wheel",
      (event: WheelEvent) => {
        event.preventDefault();
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1;
        const delta = { x: event.deltaX * unit, y: event.deltaY * unit };
        if (event.ctrlKey) gestures.zoom(2 ** (-delta.y / 200), at(event), still);
        else gestures.pan({ x: -delta.x, y: -delta.y });
      },
      { passive: false },
    ],
    [
      "gesturestart",
      (event: SafariTrackpadPinch) => {
        event.preventDefault();
        gestureScale = 1;
      },
    ],
    [
      "gesturechange",
      (event: SafariTrackpadPinch) => {
        event.preventDefault();
        if (pointers.size > 0) return;
        gestures.zoom(event.scale / gestureScale, at(event), still);
        gestureScale = event.scale;
      },
    ],
  ];

  element.style.touchAction = "none";
  element.style.userSelect = "none";
  for (const [type, listener, options] of listeners) {
    element.addEventListener(type, listener as EventListener, options);
  }
  return () => {
    for (const [type, listener, options] of listeners) {
      element.removeEventListener(type, listener as EventListener, options);
    }
  };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  desk: { flex: 1, overflow: "hidden" },
  above: {
    position: "absolute",
    left: 0,
    top: 0,
    transformOrigin: "0 0",
    pointerEvents: "box-none",
  },
});

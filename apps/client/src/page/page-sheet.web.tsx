import type { PageSize } from "@foyer/shared";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { type LayoutChangeEvent, StyleSheet, View } from "react-native";
import { Canvas } from "react-native-skia";
import { DeskDrawing } from "./desk-drawing";
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

/** A page lying on the desk, drawn by Skia in a canvas the size of the view. Pinching, or scrolling
 *  with ctrl held, zooms it; dragging or scrolling moves it. It opens fitted to the desk. */
export function PageSheet({
  size,
  label,
  onPoint,
  children,
}: {
  size: PageSize;
  label: string;
  /** Called as the pointer moves over the page, in points from its top-left corner. */
  onPoint?: (at: Point) => void;
  /** Views above the page, laid out in its own points, which never take the pointer. */
  children?: ReactNode;
}) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const keepHost = useCallback((view: unknown) => setHost(view as HTMLElement | null), []);
  const page = useRef(size);
  page.current = size;
  const pointing = useRef<((at: Point) => void) | undefined>(undefined);
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
    });
  }, [host]);

  const camera = desk.camera.scale > 0 ? desk.camera : fittedCamera(desk.view, size);
  pointing.current = (at) => {
    const onPage = pointOnPage(camera, at);
    const { width, height } = page.current;
    if (onPage.x >= 0 && onPage.y >= 0 && onPage.x <= width && onPage.y <= height) {
      onPoint?.(onPage);
    }
  };
  return (
    <View ref={keepHost} style={styles.desk} onLayout={onLayout} accessibilityLabel={label}>
      <Canvas style={styles.fill}>
        <DeskDrawing page={size} camera={camera} />
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
        {children}
      </View>
    </View>
  );
}

type Gestures = {
  zoom(factor: number, focus: Point, pan: Point): void;
  pan(by: Point): void;
  point(at: Point): void;
};

type SafariTrackpadPinch = Event & { scale: number; clientX: number; clientY: number };

const still: Point = { x: 0, y: 0 };

function followGestures(element: HTMLElement, gestures: Gestures): () => void {
  const pointers = new Map<number, Point>();
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
    ["pointerup", (event: PointerEvent) => pointers.delete(event.pointerId)],
    ["pointercancel", (event: PointerEvent) => pointers.delete(event.pointerId)],
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
    pointerEvents: "none",
  },
});

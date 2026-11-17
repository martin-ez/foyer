import { useCallback, useEffect, useRef, useState } from "react";
import type { View, ViewProps } from "react-native";
import { usePageScale } from "./page-scale";
import type { StickerGestures } from "./sticker-drag";

export type { StickerGestures } from "./sticker-drag";

/** How far a pointer can move, in screen pixels, and still count as a tap. */
export const tapSlop = 4;

/** Lets a pointer drag or tap a sticker on a page drawn on the web. The page under it doesn't move
 *  while the sticker is held. Returns the props for the sticker's view. */
export function useStickerDrag(
  gestures: StickerGestures,
  enabled: boolean,
): ViewProps & { ref: (view: View | null) => void } {
  const latest = useRef(gestures);
  latest.current = gestures;
  const scale = usePageScale();
  const [element, setElement] = useState<HTMLElement | null>(null);
  const ref = useCallback((view: View | null) => setElement(view as HTMLElement | null), []);

  useEffect(() => {
    if (!element || !enabled) return;
    let held: { pointerId: number; x: number; y: number } | null = null;
    const moved = (event: PointerEvent) => {
      const by = { x: event.clientX - (held?.x ?? 0), y: event.clientY - (held?.y ?? 0) };
      return { screen: Math.hypot(by.x, by.y), page: { x: by.x / scale(), y: by.y / scale() } };
    };
    const isHeld = (event: PointerEvent) => held !== null && event.pointerId === held.pointerId;

    const listeners: [string, (event: PointerEvent) => void][] = [
      [
        "pointerdown",
        (event) => {
          if (event.button !== 0 || held) return;
          event.stopPropagation();
          element.setPointerCapture(event.pointerId);
          held = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
        },
      ],
      [
        "pointermove",
        (event) => {
          if (isHeld(event)) latest.current.dragged(moved(event).page);
        },
      ],
      [
        "pointerup",
        (event) => {
          if (!isHeld(event)) return;
          const { screen, page } = moved(event);
          held = null;
          if (screen < tapSlop) latest.current.tapped();
          else latest.current.dropped(page);
        },
      ],
      [
        "pointercancel",
        (event) => {
          if (!isHeld(event)) return;
          held = null;
          latest.current.cancelled();
        },
      ],
    ];
    for (const [type, listener] of listeners) {
      element.addEventListener(type, listener as EventListener);
    }
    return () => {
      for (const [type, listener] of listeners) {
        element.removeEventListener(type, listener as EventListener);
      }
    };
  }, [element, enabled, scale]);

  return { ref };
}

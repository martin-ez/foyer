import { useCallback, useEffect, useState } from "react";
import type { View } from "react-native";

/** Keeps pointers pressed on a view from reaching the page under it, which would otherwise take
 *  them to move the page, so that someone can put the cursor in text and select it. */
export function useKeepPointer(): { ref: (view: View | null) => void } {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const ref = useCallback((view: View | null) => setElement(view as HTMLElement | null), []);
  useEffect(() => {
    if (!element) return;
    const keep = (event: Event) => event.stopPropagation();
    element.addEventListener("pointerdown", keep);
    return () => element.removeEventListener("pointerdown", keep);
  }, [element]);
  return { ref };
}

import type { Stroke } from "@foyer/shared/gen/foyer/ink/v1/ink_pb";
import { useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";
import type { HouseholdSync } from "../sync/household-sync";

/** The ink on a page. On the iPad, the device follows the page's ink while the page is shown, and
 *  the strokes the eraser is passing over are hidden until it lifts. */
export function usePageInk(
  pageId: string,
  strokes: ReadonlyMap<string, Stroke>,
  sync: HouseholdSync,
): {
  onPage: Stroke[];
  shown: Stroke[];
  setErasing: (strokeIds: ReadonlySet<string>) => void;
} {
  useEffect(() => {
    if (Platform.OS === "ios") sync.followInk(pageId);
  }, [sync, pageId]);
  const [erasing, setErasing] = useState<ReadonlySet<string>>(new Set());
  const onPage = useMemo(
    () => [...strokes.values()].filter((stroke) => stroke.pageId === pageId),
    [strokes, pageId],
  );
  const shown = useMemo(() => onPage.filter(({ id }) => !erasing.has(id)), [onPage, erasing]);
  return { onPage, shown, setErasing };
}

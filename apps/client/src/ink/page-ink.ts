import type { Stroke } from "@foyer/shared/gen/foyer/ink/v1/ink_pb";
import { useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";
import type { HouseholdSync } from "../sync/household-sync";

/** On the iPad, follows a page's ink while the page is shown, which also counts it as opened. */
export function useFollowInk(pageId: string, sync: HouseholdSync): void {
  useEffect(() => {
    if (Platform.OS === "ios") sync.followInk(pageId);
  }, [sync, pageId]);
}

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
  useFollowInk(pageId, sync);
  const [erasing, setErasing] = useState<ReadonlySet<string>>(new Set());
  const onPage = useMemo(
    () => [...strokes.values()].filter((stroke) => stroke.pageId === pageId),
    [strokes, pageId],
  );
  const shown = useMemo(() => onPage.filter(({ id }) => !erasing.has(id)), [onPage, erasing]);
  return { onPage, shown, setErasing };
}

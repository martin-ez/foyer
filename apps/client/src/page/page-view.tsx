import { useIsFocused } from "expo-router";
import { useSyncExternalStore } from "react";
import { useHousehold } from "../shell/household";
import { useLivePage } from "../sync/use-live-page";
import { doneTasks } from "../tasks/task-lists";
import { describePage, type OpenPage, pageIdOf, sizeOf } from "./open-page";
import { PageSheet } from "./page-sheet";
import { PageStickers } from "./page-stickers";
import { markersOn } from "./presence";
import { PresenceMarkers } from "./presence-markers";
import { stickersOn } from "./sticker-layout";

type PageViewProps = { page: OpenPage; onOpenTask?: (itemId: string) => void };

/** A page as everyone on it sees it: its stickers, which can be moved, ticked and tapped to open
 *  their task, and where others on it are pointing. It's drawn, and this device is on the page,
 *  only while its screen is the one in front. */
export function PageView(props: PageViewProps) {
  return useIsFocused() ? <ShownPage {...props} /> : null;
}

function ShownPage({ page, onOpenTask }: PageViewProps) {
  const { state, sync } = useHousehold();
  const pageId = pageIdOf(page);
  useLivePage(sync.live, pageId);
  const live = useSyncExternalStore(sync.live.subscribe, sync.live.getState);
  const markers = live.pageId === pageId ? markersOn(live.here, state.members) : [];
  const size = sizeOf(page, state.pages);
  const select = (stickerId: string) => {
    const itemId = state.stickers.get(stickerId)?.itemId;
    if (itemId !== undefined) onOpenTask?.(itemId);
  };

  return (
    <PageSheet
      key={pageId}
      size={size}
      label={describePage(page, state)}
      onPoint={({ x, y }) => sync.live.point(x, y)}
    >
      <PageStickers
        stickers={stickersOn(pageId, state.stickers.values())}
        items={state.items}
        done={doneTasks(state.completions.values())}
        page={size}
        onSelect={select}
        onMove={(stickerId, { x, y }) => sync.moveSticker(stickerId, x, y)}
        onTick={(itemId, ticked) => (ticked ? sync.tickTask(itemId) : sync.untickTask(itemId))}
      />
      <PresenceMarkers markers={markers} />
    </PageSheet>
  );
}

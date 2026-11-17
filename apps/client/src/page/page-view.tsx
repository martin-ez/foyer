import { useIsFocused } from "expo-router";
import { type ReactNode, useSyncExternalStore } from "react";
import { useHousehold } from "../shell/household";
import { useLivePage } from "../sync/use-live-page";
import { doneTasks } from "../tasks/task-lists";
import { useTick } from "../tasks/ticking";
import { describePage, type OpenPage, pageIdOf, sizeOf } from "./open-page";
import type { Ruling } from "./page-drawing";
import { PageSheet } from "./page-sheet";
import { PageStickers } from "./page-stickers";
import { markersOn } from "./presence";
import { PresenceMarkers } from "./presence-markers";
import { stickersOn } from "./sticker-layout";

type PageViewProps = {
  page: OpenPage;
  /** What's printed on the page, such as a calendar's grid. */
  ruling?: Ruling;
  onOpenTask?: (itemId: string) => void;
  /** Views printed on the page under its stickers, laid out in its own points. */
  children?: ReactNode;
};

/** A page as everyone on it sees it: what's printed on it, its stickers, which can be moved,
 *  ticked and tapped to open their task, and where others on it are pointing. It's drawn, and this
 *  device is on the page, only while its screen is the one in front. */
export function PageView(props: PageViewProps) {
  return useIsFocused() ? <ShownPage {...props} /> : null;
}

function ShownPage({ page, ruling, onOpenTask, children }: PageViewProps) {
  const { state, sync } = useHousehold();
  const tick = useTick();
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
      ruling={ruling}
      label={describePage(page, state)}
      onPoint={({ x, y }) => sync.live.point(x, y)}
    >
      {children}
      <PageStickers
        stickers={stickersOn(pageId, state.stickers.values())}
        items={state.items}
        done={doneTasks(state.items, state.completions.values())}
        page={size}
        onSelect={select}
        onMove={(stickerId, { x, y }) => sync.moveSticker(stickerId, x, y)}
        onTick={tick}
      />
      <PresenceMarkers markers={markers} />
    </PageSheet>
  );
}

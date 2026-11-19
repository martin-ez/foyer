import { dayAt, dropOnDayPage, heightOfTime, keepInDay, timelineOf } from "@foyer/shared";
import { ItemKind } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import type { Sticker } from "@foyer/shared/gen/foyer/sticker/v1/sticker_pb";
import { useIsFocused } from "expo-router";
import { type ReactNode, useSyncExternalStore } from "react";
import { timeOf } from "../calendar/events";
import { useHousehold } from "../shell/household";
import { useLivePage } from "../sync/use-live-page";
import { isStickerDone } from "../tasks/task-lists";
import { useTick } from "../tasks/ticking";
import { minutesIntoLocalDay } from "./calendar-date";
import { describePage, type OpenPage, pageIdOf, sizeOf } from "./open-page";
import type { Ruling } from "./page-drawing";
import { PageSheet } from "./page-sheet";
import { PageStickers } from "./page-stickers";
import { markersOn } from "./presence";
import { PresenceMarkers } from "./presence-markers";
import type { Point } from "./sheet-camera";
import { stickerSize, stickersOn } from "./sticker-layout";

type PageViewProps = {
  page: OpenPage;
  /** What's printed on the page, such as a calendar's grid. */
  ruling?: Ruling;
  /** Called with the item of a sticker that's tapped. */
  onOpenItem?: (itemId: string) => void;
  /** Called when the page itself is tapped, rather than something on it, in its own points. */
  onTapPage?: (at: Point) => void;
  /** Called when a sticker on a calendar page that's on its item's day is dropped on another day
   *  of the page, with its new top-left corner. Without it, the sticker goes back. */
  onDropOnDay?: (sticker: Sticker, at: Point, date: string) => void;
  /** Views printed on the page under its stickers, laid out in its own points. */
  children?: ReactNode;
};

/** A page as everyone on it sees it: what's printed on it, its stickers, which can be moved, ticked
 *  and tapped, and where others on it are pointing, with a day page's events at their times here.
 *  It's drawn, and this device is on the page, only while its screen is the one in front. */
export function PageView(props: PageViewProps) {
  return useIsFocused() ? <ShownPage {...props} /> : null;
}

function ShownPage({ page, ruling, onOpenItem, onTapPage, onDropOnDay, children }: PageViewProps) {
  const { state, sync } = useHousehold();
  const tick = useTick();
  const pageId = pageIdOf(page);
  useLivePage(sync.live, pageId);
  const live = useSyncExternalStore(sync.live.subscribe, sync.live.getState);
  const markers = live.pageId === pageId ? markersOn(live.here, state.members) : [];
  const size = sizeOf(page, state.pages);
  const timeline = timelineOf(pageId, size);
  const completions = [...state.completions.values()];
  const startAndEnd = (sticker: Sticker) => {
    const item = state.items.get(sticker.itemId);
    const time = timeline && item ? timeOf(item) : null;
    if (!timeline || !time || time.allDay) return null;
    const height = (at: number) =>
      heightOfTime(timeline, minutesIntoLocalDay(at, sticker.occurrence));
    return { start: height(time.startsAt), end: height(time.endsAt), left: timeline.left };
  };
  const placeOf = (sticker: Sticker): Point => {
    const drawn = startAndEnd(sticker);
    return drawn ? { x: Math.max(sticker.x, drawn.left), y: drawn.start } : sticker;
  };
  const reachOf = (sticker: Sticker) => {
    const drawn = startAndEnd(sticker);
    return drawn ? drawn.end - drawn.start : null;
  };
  const select = (stickerId: string) => {
    const itemId = state.stickers.get(stickerId)?.itemId;
    if (itemId !== undefined) onOpenItem?.(itemId);
  };
  const move = (stickerId: string, to: Point) => {
    const sticker = state.stickers.get(stickerId);
    if (!sticker) return;
    if (sticker.occurrence === "") {
      sync.moveSticker(stickerId, to.x, to.y);
      return;
    }
    const { width, height } = stickerSize(sticker.kind, pageId);
    const date = dayAt(pageId, size, { x: to.x + width / 2, y: to.y + height / 2 });
    if (date === null) return;
    const at = keepInDay(pageId, size, date, to);
    const onTimeline = date === sticker.occurrence ? dropOnDayPage(pageId, size, at) : null;
    if (onTimeline) sync.moveOnDayPage(stickerId, onTimeline.at, onTimeline.time);
    else if (date === sticker.occurrence) sync.moveSticker(stickerId, at.x, at.y);
    else if (onItsDay(sticker)) onDropOnDay?.(sticker, at, date);
  };
  const onItsDay = (sticker: Sticker) => {
    const item = state.items.get(sticker.itemId);
    return item?.kind === ItemKind.EVENT || item?.date === sticker.occurrence;
  };
  const tickSticker = (sticker: Sticker, done: boolean) => {
    const item = state.items.get(sticker.itemId);
    const onDay = item?.repeat && sticker.occurrence !== "" ? sticker.occurrence : undefined;
    tick(sticker.itemId, done, done ? undefined : onDay);
  };

  return (
    <PageSheet
      key={pageId}
      size={size}
      ruling={ruling}
      label={describePage(page, state)}
      onPoint={({ x, y }) => sync.live.point(x, y)}
      onTap={onTapPage}
    >
      {children}
      <PageStickers
        pageId={pageId}
        stickers={stickersOn(pageId, state.stickers.values())}
        items={state.items}
        isDone={(sticker) => isStickerDone(sticker, state.items.get(sticker.itemId), completions)}
        page={size}
        placeOf={placeOf}
        reachOf={reachOf}
        onSelect={select}
        onMove={move}
        onTick={tickSticker}
      />
      <PresenceMarkers markers={markers} />
    </PageSheet>
  );
}

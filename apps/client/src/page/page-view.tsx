import { dayAt, dropOnDayPage, heightOfTime, keepInDay, timelineOf } from "@foyer/shared";
import { ItemKind } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import type { Sticker } from "@foyer/shared/gen/foyer/sticker/v1/sticker_pb";
import type { TextBlock, TextGroup } from "@foyer/shared/gen/foyer/text/v1/text_pb";
import { useIsFocused } from "expo-router";
import { type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { StyleSheet, View } from "react-native";
import { Skia } from "react-native-skia";
import { timeOf } from "../calendar/events";
import { useHousehold } from "../shell/household";
import { useLivePage } from "../sync/use-live-page";
import { isStickerDone } from "../tasks/task-lists";
import { useTick } from "../tasks/ticking";
import { PageText } from "../text/page-text";
import { TextBar } from "../text/text-bar";
import { TextDrawing } from "../text/text-drawing";
import { useTextEditing } from "../text/text-editing";
import { useTextFonts } from "../text/text-fonts";
import { blocksIn, groupsOn } from "../text/text-groups";
import { disposeGroup, hasEmoji, type LaidOutGroup, layOutGroup } from "../text/text-layout";
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

/** A page as everyone on it sees it: what's printed on it, its text, which can be added, edited and
 *  moved while connected, its stickers, which can be moved, ticked and tapped, and where others on
 *  it are pointing, with a day page's events at their times here. It's drawn, and this device is
 *  on the page, only while its screen is the one in front. */
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
  const text = useLaidOutText(pageId, state.textGroups, state.textBlocks);
  const editing = useTextEditing(pageId, size, state, sync);
  const [moving, setMoving] = useState<{ groupId: string; by: Point } | null>(null);
  const editedBlocks = editing.groupId ? blocksIn(editing.groupId, state.textBlocks) : [];
  const focusedBlock = editedBlocks.find(({ id }) => id === editing.focusedBlockId);
  const split = () => {
    const edited = text.find(({ group }) => group.id === editing.groupId);
    const top = edited?.blocks.find(({ id }) => id === editing.focusedBlockId)?.top ?? 0;
    if (!edited) return;
    const y = Math.min(edited.group.y + top + 24, size.height - 12);
    editing.split({ x: edited.group.x, y });
  };
  const tapPage = (at: Point) => {
    if (editing.placing) editing.place(at);
    else if (editing.groupId !== null) editing.finish();
    else onTapPage?.(at);
  };
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
    <View style={styles.fill}>
      <TextBar
        editing={editing}
        focusedKind={focusedBlock ? editing.typedOf(focusedBlock).kind : null}
        onSplit={split}
      />
      <PageSheet
        key={pageId}
        size={size}
        ruling={ruling}
        drawn={
          <TextDrawing
            groups={text.filter(({ group }) => group.id !== editing.groupId)}
            page={size}
            moved={moving}
          />
        }
        label={describePage(page, state)}
        onPoint={({ x, y }) => sync.live.point(x, y)}
        onTap={tapPage}
      >
        {children}
        <PageText
          groups={text}
          blocks={editedBlocks}
          page={size}
          editing={editing}
          onDragging={setMoving}
        />
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
    </View>
  );
}

/** The text groups on a page, laid out once the fonts have loaded, bottom first. Paragraphs laid
 *  out for earlier versions of the text are let go once they're no longer drawn. */
function useLaidOutText(
  pageId: string,
  groups: ReadonlyMap<string, TextGroup>,
  blocks: ReadonlyMap<string, TextBlock>,
): LaidOutGroup[] {
  const onPage = groupsOn(pageId, groups);
  const needsEmoji = onPage.some(({ id }) =>
    blocksIn(id, blocks).some(({ markdown }) => hasEmoji(markdown)),
  );
  const fonts = useTextFonts(needsEmoji);
  const laidOut = useMemo(() => {
    if (!fonts) return [];
    return groupsOn(pageId, groups).map((group) =>
      layOutGroup(Skia, fonts, group, blocksIn(group.id, blocks)),
    );
  }, [fonts, pageId, groups, blocks]);
  const drawn = useRef<LaidOutGroup[]>([]);
  const mounted = useRef(false);
  useEffect(() => {
    const before = drawn.current;
    drawn.current = laidOut;
    if (before !== laidOut) for (const group of before) disposeGroup(group);
  }, [laidOut]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      setTimeout(() => {
        if (mounted.current) return;
        for (const group of drawn.current) disposeGroup(group);
        drawn.current = [];
      }, 0);
    };
  }, []);
  return laidOut;
}

const styles = StyleSheet.create({ fill: { flex: 1 } });

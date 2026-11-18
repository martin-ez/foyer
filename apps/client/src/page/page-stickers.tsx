import type { PageSize } from "@foyer/shared";
import type { Item } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import { type Sticker, StickerKind } from "@foyer/shared/gen/foyer/sticker/v1/sticker_pb";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { CheckMark } from "../tasks/checkbox";
import { describeSticker } from "./describe-sticker";
import type { Point } from "./sheet-camera";
import { useStickerDrag } from "./sticker-drag";
import { keepOnPage, stickerSize } from "./sticker-layout";

/** The stickers on a page, stacked bottom first, in its own points, for a `PageSheet` to hold. One
 *  whose item the member sees can be dragged and tapped, and a task's can be ticked; one whose item
 *  they can't see is drawn hidden, in its spot and shape, and stays put. An event's shows its
 *  title. */
export function PageStickers({
  pageId,
  stickers,
  items,
  isDone,
  page,
  onSelect,
  onMove,
  onTick,
}: {
  pageId: string;
  stickers: readonly Sticker[];
  items: ReadonlyMap<string, Item>;
  /** Whether the task a sticker shows is done, on its day on a calendar page. */
  isDone: (sticker: Sticker) => boolean;
  page: PageSize;
  /** Called when a sticker is tapped. */
  onSelect: (stickerId: string) => void;
  /** Called when a sticker is let go somewhere else, with its new top-left corner. */
  onMove: (stickerId: string, to: Point) => void;
  /** Called when a task's checkbox is tapped, with whether its task should now be done. */
  onTick: (sticker: Sticker, done: boolean) => void;
}) {
  return stickers.map((sticker) => {
    const done = isDone(sticker);
    return (
      <StickerView
        key={sticker.id}
        sticker={sticker}
        item={items.get(sticker.itemId)}
        done={done}
        size={stickerSize(sticker.kind, pageId)}
        page={page}
        onSelect={() => onSelect(sticker.id)}
        onMove={(to) => onMove(sticker.id, to)}
        onTick={() => onTick(sticker, !done)}
      />
    );
  });
}

function StickerView({
  sticker,
  item,
  done,
  size,
  page,
  onSelect,
  onMove,
  onTick,
}: {
  sticker: Sticker;
  item: Item | undefined;
  done: boolean;
  size: PageSize;
  page: PageSize;
  onSelect: () => void;
  onMove: (to: Point) => void;
  onTick: () => void;
}) {
  const [dragged, setDragged] = useState<Point | null>(null);
  const to = (by: Point) => keepOnPage({ x: sticker.x + by.x, y: sticker.y + by.y }, size, page);
  const drag = useStickerDrag(
    {
      dragged: setDragged,
      dropped: (by) => {
        setDragged(null);
        onMove(to(by));
      },
      tapped: () => {
        setDragged(null);
        onSelect();
      },
      cancelled: () => setDragged(null),
    },
    item !== undefined,
  );
  const at = dragged ? to(dragged) : { x: sticker.x, y: sticker.y };
  const task = sticker.kind === StickerKind.TASK;
  const event = sticker.kind === StickerKind.EVENT;
  const lines = size.height < 40 ? 1 : 2;
  const look = !item
    ? task || event
      ? styles.hidden
      : styles.outline
    : task
      ? styles.task
      : event
        ? styles.event
        : styles.outline;

  return (
    <>
      <View
        {...drag}
        accessible
        accessibilityRole="button"
        accessibilityLabel={describeSticker(sticker, item)}
        accessibilityState={{ disabled: item === undefined }}
        style={[
          styles.sticker,
          { left: at.x, top: at.y, width: size.width, height: size.height },
          task ? styles.roomForCheckbox : null,
          look,
          dragged ? styles.lifted : null,
        ]}
      >
        {task && item ? (
          <View style={styles.words}>
            <Text
              style={[styles.title, done ? styles.done : null]}
              numberOfLines={item.repeat ? 1 : lines}
            >
              {item.title}
            </Text>
            {item.repeat && lines > 1 ? (
              <Text style={styles.next}>Repeats, next on {item.date}</Text>
            ) : null}
          </View>
        ) : null}
        {event && item ? (
          <View style={styles.words}>
            <Text style={styles.title} numberOfLines={lines}>
              {item.title}
            </Text>
          </View>
        ) : null}
      </View>
      {task && item ? (
        <StickerCheckbox
          title={item.title}
          done={done}
          at={{ x: at.x, y: at.y + (size.height - checkboxSize) / 2 }}
          lifted={dragged !== null}
          onTick={onTick}
        />
      ) : null}
    </>
  );
}

const checkboxSize = 32;

function StickerCheckbox({
  title,
  done,
  at,
  lifted,
  onTick,
}: {
  title: string;
  done: boolean;
  at: Point;
  lifted: boolean;
  onTick: () => void;
}) {
  const press = useStickerDrag(
    { dragged: () => {}, dropped: () => {}, tapped: onTick, cancelled: () => {} },
    true,
  );
  return (
    <View
      {...press}
      accessible
      accessibilityRole="checkbox"
      accessibilityLabel={`Done: ${title}`}
      aria-checked={done}
      style={[styles.checkbox, { left: at.x, top: at.y }, lifted ? styles.aboveLifted : null]}
    >
      <CheckMark checked={done} />
    </View>
  );
}

const styles = StyleSheet.create({
  sticker: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 10,
    paddingRight: 10,
    borderRadius: 4,
    pointerEvents: "auto",
  },
  roomForCheckbox: { paddingLeft: checkboxSize },
  event: {
    backgroundColor: "#dcebf7",
    borderColor: "#8fb3d1",
    borderWidth: 1,
    boxShadow: "0 1px 3px rgba(0, 0, 0, 0.18)",
  },
  task: {
    backgroundColor: "#fff6c9",
    borderColor: "#d9c77a",
    borderWidth: 1,
    boxShadow: "0 1px 3px rgba(0, 0, 0, 0.18)",
  },
  hidden: { backgroundColor: "#d9d6cf", borderColor: "#bdb8ad", borderWidth: 1 },
  outline: { borderColor: "#8f887a", borderWidth: 1, borderStyle: "dashed" },
  lifted: { zIndex: 1, boxShadow: "0 4px 10px rgba(0, 0, 0, 0.25)" },
  aboveLifted: { zIndex: 2 },
  checkbox: {
    position: "absolute",
    width: checkboxSize,
    height: checkboxSize,
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "auto",
  },
  words: { flex: 1 },
  title: { fontSize: 13, color: "#2b2620" },
  next: { fontSize: 11, color: "#6b6459" },
  done: { color: "#8f887a", textDecorationLine: "line-through" },
});

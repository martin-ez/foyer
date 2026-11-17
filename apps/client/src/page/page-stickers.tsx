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
 *  they can't see is drawn hidden, in its spot and shape, and stays put. */
export function PageStickers({
  stickers,
  items,
  done,
  page,
  onSelect,
  onMove,
  onTick,
}: {
  stickers: readonly Sticker[];
  items: ReadonlyMap<string, Item>;
  /** The ids of the tasks that are done. */
  done: ReadonlySet<string>;
  page: PageSize;
  /** Called when a sticker is tapped. */
  onSelect: (stickerId: string) => void;
  /** Called when a sticker is let go somewhere else, with its new top-left corner. */
  onMove: (stickerId: string, to: Point) => void;
  /** Called when a task's checkbox is tapped, with whether the task should now be done. */
  onTick: (itemId: string, done: boolean) => void;
}) {
  return stickers.map((sticker) => (
    <StickerView
      key={sticker.id}
      sticker={sticker}
      item={items.get(sticker.itemId)}
      done={done.has(sticker.itemId)}
      page={page}
      onSelect={() => onSelect(sticker.id)}
      onMove={(to) => onMove(sticker.id, to)}
      onTick={() => onTick(sticker.itemId, !done.has(sticker.itemId))}
    />
  ));
}

function StickerView({
  sticker,
  item,
  done,
  page,
  onSelect,
  onMove,
  onTick,
}: {
  sticker: Sticker;
  item: Item | undefined;
  done: boolean;
  page: PageSize;
  onSelect: () => void;
  onMove: (to: Point) => void;
  onTick: () => void;
}) {
  const size = stickerSize(sticker.kind);
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
          !task ? styles.outline : item ? styles.task : styles.hidden,
          dragged ? styles.lifted : null,
        ]}
      >
        {task && item ? (
          <View style={styles.words}>
            <Text
              style={[styles.title, done ? styles.done : null]}
              numberOfLines={item.repeat ? 1 : 2}
            >
              {item.title}
            </Text>
            {item.repeat ? <Text style={styles.next}>Repeats, next on {item.date}</Text> : null}
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
    paddingLeft: checkboxSize,
    paddingRight: 10,
    borderRadius: 4,
    pointerEvents: "auto",
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

import type { PageSize } from "@foyer/shared";
import type { Item } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import { type Sticker, StickerKind } from "@foyer/shared/gen/foyer/sticker/v1/sticker_pb";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { describeSticker } from "./describe-sticker";
import type { Point } from "./sheet-camera";
import { useStickerDrag } from "./sticker-drag";
import { keepOnPage, stickerSize } from "./sticker-layout";

/** The stickers on a page, stacked bottom first, in its own points, for a `PageSheet` to hold. One
 *  whose item the member sees can be dragged and tapped; one whose item they can't see is drawn
 *  hidden, in its spot and shape, and stays put. */
export function PageStickers({
  stickers,
  items,
  page,
  selected,
  onSelect,
  onMove,
}: {
  stickers: readonly Sticker[];
  items: ReadonlyMap<string, Item>;
  page: PageSize;
  /** The selected sticker's id, if any. */
  selected: string | null;
  /** Called when a sticker is tapped. */
  onSelect: (stickerId: string) => void;
  /** Called when a sticker is let go somewhere else, with its new top-left corner. */
  onMove: (stickerId: string, to: Point) => void;
}) {
  return stickers.map((sticker) => (
    <StickerView
      key={sticker.id}
      sticker={sticker}
      item={items.get(sticker.itemId)}
      page={page}
      selected={sticker.id === selected}
      onSelect={() => onSelect(sticker.id)}
      onMove={(to) => onMove(sticker.id, to)}
    />
  ));
}

function StickerView({
  sticker,
  item,
  page,
  selected,
  onSelect,
  onMove,
}: {
  sticker: Sticker;
  item: Item | undefined;
  page: PageSize;
  selected: boolean;
  onSelect: () => void;
  onMove: (to: Point) => void;
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
    <View
      {...drag}
      accessible
      accessibilityRole="button"
      accessibilityLabel={describeSticker(sticker, item)}
      accessibilityState={{ selected, disabled: item === undefined }}
      style={[
        styles.sticker,
        { left: at.x, top: at.y, width: size.width, height: size.height },
        !task ? styles.outline : item ? styles.task : styles.hidden,
        selected ? styles.selected : null,
        dragged ? styles.lifted : null,
      ]}
    >
      {task && item ? (
        <>
          <View style={styles.checkbox} />
          <Text style={styles.title} numberOfLines={2}>
            {item.title}
          </Text>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sticker: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
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
  selected: { borderColor: "#2f6fb5", borderWidth: 2 },
  lifted: { zIndex: 1, boxShadow: "0 4px 10px rgba(0, 0, 0, 0.25)" },
  checkbox: { width: 16, height: 16, borderColor: "#6b6459", borderWidth: 1.5, borderRadius: 3 },
  title: { flex: 1, fontSize: 13, color: "#2b2620" },
});

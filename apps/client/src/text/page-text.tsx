import type { PageSize, TextBlockKind } from "@foyer/shared";
import type { TextBlock } from "@foyer/shared/gen/foyer/text/v1/text_pb";
import { type ComponentRef, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { paperColour } from "../page/page-drawing";
import type { Point } from "../page/sheet-camera";
import { useStickerDrag } from "../page/sticker-drag";
import { useKeepPointer } from "./keep-pointer";
import type { TextEditing } from "./text-editing";
import { listMarkers } from "./text-groups";
import { blockLooks, indentStep, type LaidOutGroup, markerWidth, textColour } from "./text-layout";
import type { TypedBlock } from "./typed-text";

/** What each kind of block is called, as the editor's inputs are labelled. */
export const blockKindNames: Record<TextBlockKind, string> = {
  paragraph: "Text",
  heading1: "Heading 1",
  heading2: "Heading 2",
  heading3: "Heading 3",
  bulleted: "Bulleted item",
  numbered: "Numbered item",
};

/** The views over a page's text, in its own points, for a `PageSheet` to hold: one over each group,
 *  which a screen reader reads and which can be tapped to edit it or dragged to move it, and the
 *  editor over the group being edited. Skia draws the text itself. */
export function PageText({
  groups,
  blocks,
  page,
  editing,
  onDragging,
}: {
  groups: readonly LaidOutGroup[];
  /** The blocks of the group being edited, in their order. */
  blocks: readonly TextBlock[];
  page: PageSize;
  editing: TextEditing;
  /** Called as a group is dragged, with how far, and with null once it's let go. */
  onDragging: (moving: { groupId: string; by: Point } | null) => void;
}) {
  const edited = groups.find(({ group }) => group.id === editing.groupId);
  return (
    <>
      {groups
        .filter(({ group }) => group.id !== editing.groupId)
        .map((laidOut) => (
          <TextTarget
            key={laidOut.group.id}
            laidOut={laidOut}
            page={page}
            editing={editing}
            onDragging={onDragging}
          />
        ))}
      {edited ? (
        <TextEditor laidOut={edited} blocks={blocks} page={page} editing={editing} />
      ) : null}
    </>
  );
}

function TextTarget({
  laidOut,
  page,
  editing,
  onDragging,
}: {
  laidOut: LaidOutGroup;
  page: PageSize;
  editing: TextEditing;
  onDragging: (moving: { groupId: string; by: Point } | null) => void;
}) {
  const { group, height, text } = laidOut;
  const to = (by: Point): Point => ({
    x: Math.max(0, Math.min(group.x + by.x, page.width - Math.min(group.width, page.width))),
    y: Math.max(0, Math.min(group.y + by.y, page.height - 12)),
  });
  const drag = useStickerDrag(
    {
      dragged: (by) => {
        const at = to(by);
        onDragging({ groupId: group.id, by: { x: at.x - group.x, y: at.y - group.y } });
      },
      dropped: (by) => {
        onDragging(null);
        editing.move(group.id, to(by));
      },
      tapped: () => {
        onDragging(null);
        editing.edit(group.id);
      },
      cancelled: () => onDragging(null),
    },
    editing.editable,
  );
  const cut = group.y + height > page.height;
  return (
    <View
      {...drag}
      accessible
      accessibilityRole="button"
      accessibilityLabel={cut ? `${text} (cut off at the bottom of the page)` : text}
      accessibilityHint="Edits this text"
      aria-disabled={!editing.editable}
      style={[
        styles.target,
        {
          left: group.x,
          top: group.y,
          width: group.width,
          height: Math.max(Math.min(height, page.height - group.y), 4),
        },
      ]}
    />
  );
}

function TextEditor({
  laidOut,
  blocks,
  page,
  editing,
}: {
  laidOut: LaidOutGroup;
  blocks: readonly TextBlock[];
  page: PageSize;
  editing: TextEditing;
}) {
  const { group } = laidOut;
  const [widening, setWidening] = useState<number | null>(null);
  const keep = useKeepPointer();
  const width = Math.max(group.width + (widening ?? 0), 48);
  const resize = useStickerDrag(
    {
      dragged: ({ x }) => setWidening(x),
      dropped: ({ x }) => {
        setWidening(null);
        editing.resize(group.width + x);
      },
      tapped: () => setWidening(null),
      cancelled: () => setWidening(null),
    },
    true,
  );
  const typed = blocks.map((block) => editing.typedOf(block));
  const markers = listMarkers(typed.map(({ kind, indent }) => ({ kind, indent, runs: [] })));
  return (
    <View
      {...keep}
      style={[styles.editor, { left: group.x, top: group.y, width: Math.min(width, page.width) }]}
    >
      {blocks.map((block, index) => (
        <BlockInput
          key={block.id}
          block={block}
          typed={typed[index] ?? { kind: "paragraph", indent: 0, text: "" }}
          marker={markers[index] ?? null}
          first={index === 0}
          editing={editing}
        />
      ))}
      <View
        {...resize}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Width of the text"
        style={styles.handle}
      />
    </View>
  );
}

function BlockInput({
  block,
  typed,
  marker,
  first,
  editing,
}: {
  block: TextBlock;
  typed: TypedBlock;
  marker: string | null;
  first: boolean;
  editing: TextEditing;
}) {
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const selection = useRef({ start: 0, end: 0 });
  const [height, setHeight] = useState(0);
  const look = blockLooks[typed.kind];
  const lineHeight = Math.round(look.size * 1.35);
  const request = editing.focusRequest;
  useEffect(() => {
    if (!request || request.blockId !== block.id) return;
    const node = input.current as unknown as {
      focus(): void;
      setSelection?: (start: number, end: number) => void;
      setSelectionRange?: (start: number, end: number) => void;
    } | null;
    node?.focus();
    const { start, end } = request.selection;
    if (node?.setSelectionRange) node.setSelectionRange(start, end);
    else node?.setSelection?.(start, end);
  }, [request, block.id]);

  return (
    <View
      style={[
        styles.block,
        { marginTop: first ? 0 : 4 + look.above },
        marker === null ? null : { paddingLeft: typed.indent * indentStep },
      ]}
    >
      {marker === null ? null : (
        <Text style={[styles.marker, { fontSize: look.size, lineHeight }]}>{marker}</Text>
      )}
      <TextInput
        ref={input}
        multiline
        rows={1}
        scrollEnabled={false}
        value={typed.text}
        placeholder={first && typed.text === "" ? "Type here" : undefined}
        accessibilityLabel={blockKindNames[typed.kind]}
        onChangeText={(text) => editing.change(block.id, text)}
        onFocus={() => editing.focus(block.id)}
        onBlur={() => editing.leave(block.id)}
        onSelectionChange={({ nativeEvent }) => {
          selection.current = nativeEvent.selection;
          editing.select(block.id, nativeEvent.selection);
        }}
        onKeyPress={(event) => {
          const { start, end } = selection.current;
          if (event.nativeEvent.key === "Backspace" && start === 0 && end === 0) {
            event.preventDefault();
            editing.backspaceAtStart(block.id);
          }
        }}
        onContentSizeChange={({ nativeEvent }) => setHeight(nativeEvent.contentSize.height)}
        style={[
          styles.input,
          {
            fontSize: look.size,
            lineHeight,
            fontWeight: look.bold ? "700" : "400",
            height: Math.max(height, lineHeight),
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  target: { position: "absolute", pointerEvents: "auto" },
  editor: {
    position: "absolute",
    backgroundColor: paperColour,
    outlineColor: "#8f887a",
    outlineStyle: "dashed",
    outlineWidth: 1,
    pointerEvents: "auto",
    userSelect: "text",
  },
  block: { flexDirection: "row" },
  marker: { width: markerWidth, color: textColour },
  input: {
    flex: 1,
    padding: 0,
    margin: 0,
    color: textColour,
    borderWidth: 0,
  },
  handle: {
    position: "absolute",
    top: 0,
    right: -14,
    bottom: 0,
    width: 16,
    backgroundColor: "#c9bfa9",
    borderRadius: 4,
    pointerEvents: "auto",
  },
});

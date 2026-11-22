import {
  type PageSize,
  readBlockMarkdown,
  type TextBlockKind,
  textBlockProblem,
  writeBlockMarkdown,
} from "@foyer/shared";
import type { TextBlock } from "@foyer/shared/gen/foyer/text/v1/text_pb";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Point } from "../page/sheet-camera";
import type { HouseholdSync, SyncState } from "../sync/household-sync";
import { BlockDrafts } from "./block-drafts";
import { blocksIn, groupBelow, groupsOn, newGroupSpot } from "./text-groups";
import {
  blockShortcut,
  readTypedText,
  type Selection,
  type TypedBlock,
  typedTextOf,
  wrapSelection,
} from "./typed-text";

/** How many levels a list item can be nested. */
export const indentLimit = 5;

/** The narrowest a text group can be made, in points. */
export const narrowestGroup = 48;

/** A request to put the cursor in a block, at a selection. Each new request has a new serial. */
export type FocusRequest = { blockId: string; selection: Selection; serial: number };

/** Typed text on a page as someone edits it, and what they can do to it. Only while the device is
 *  up to date with the household can text be changed: offline, it's read-only. */
export type TextEditing = {
  editable: boolean;
  /** Whether the next tap on the page puts new text there. */
  placing: boolean;
  /** The group being edited, or null. */
  groupId: string | null;
  /** The block the cursor was last in, while a group is edited. */
  focusedBlockId: string | null;
  focusRequest: FocusRequest | null;
  /** A block as it's edited: what's typed in the focused one, or else its stored Markdown. */
  typedOf(block: TextBlock): TypedBlock;
  startPlacing(): void;
  cancelPlacing(): void;
  place(tap: Point): void;
  edit(groupId: string): void;
  focus(blockId: string): void;
  select(blockId: string, selection: Selection): void;
  leave(blockId: string): void;
  change(blockId: string, typed: string): void;
  backspaceAtStart(blockId: string): void;
  setKind(kind: TextBlockKind): void;
  indent(by: 1 | -1): void;
  toggleStyle(style: "bold" | "italic"): void;
  canSplit: boolean;
  split(at: Point): void;
  canJoin: boolean;
  joinBelow(): void;
  resize(width: number): void;
  move(groupId: string, to: Point): void;
  remove(): void;
  finish(): void;
};

type Focused = { blockId: string; typed: TypedBlock; selection: Selection };

/** Edits the text on a page through the household's sync. Sends a block's text when typing pauses
 *  and when the cursor leaves it, and ends editing when the device goes offline or the page
 *  changes. */
export function useTextEditing(
  pageId: string,
  page: PageSize,
  state: SyncState,
  sync: HouseholdSync,
): TextEditing {
  const editable = state.status === "up-to-date";
  const [placing, setPlacing] = useState(false);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [focused, setFocused] = useState<Focused | null>(null);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const drafts = useMemo(
    () => new BlockDrafts((blockId, markdown) => sync.editBlock(blockId, markdown)),
    [sync],
  );
  const latest = useRef({ state, groupId });
  latest.current = { state, groupId };
  const serial = useRef(0);

  const stored = useCallback((block: TextBlock): TypedBlock => {
    const content = readBlockMarkdown(block.markdown);
    return { kind: content.kind, indent: content.indent, text: typedTextOf(content.runs) };
  }, []);
  const typedOf = (block: TextBlock) =>
    focused?.blockId === block.id ? focused.typed : stored(block);
  const requestFocus = (blockId: string, selection: Selection) => {
    serial.current += 1;
    setFocusRequest({ blockId, selection, serial: serial.current });
  };
  const blockOf = (blockId: string) => latest.current.state.textBlocks.get(blockId);
  const send = (blockId: string, typed: TypedBlock) => {
    drafts.drop(blockId);
    const block = blockOf(blockId);
    const markdown = markdownOf(typed);
    if (block && block.markdown !== markdown && !textBlockProblem(markdown)) {
      sync.editBlock(blockId, markdown);
    }
  };
  const setTyped = (blockId: string, typed: TypedBlock, selection?: Selection) => {
    const kept = focused?.blockId === blockId ? focused.selection : { start: 0, end: 0 };
    setFocused({ blockId, typed, selection: selection ?? kept });
  };

  const finish = useCallback(() => {
    drafts.flush();
    const now = sync.getState();
    const editing = latest.current.groupId;
    if (editing) {
      const blocks = blocksIn(editing, now.textBlocks);
      const empty = blocks.every(({ markdown }) => readBlockMarkdown(markdown).runs.length === 0);
      if (now.textGroups.has(editing) && empty) sync.deleteTextGroup(editing);
    }
    setGroupId(null);
    setFocused(null);
    setPlacing(false);
  }, [drafts, sync]);

  const groupGone = groupId !== null && !state.textGroups.has(groupId);
  useEffect(() => {
    if (groupGone) {
      drafts.flush();
      setGroupId(null);
      setFocused(null);
    }
  }, [groupGone, drafts]);
  useEffect(() => {
    if (!editable) finish();
  }, [editable, finish]);
  useEffect(() => {
    void pageId;
    return () => finish();
  }, [pageId, finish]);

  const edit = (next: string) => {
    if (!editable) return;
    if (groupId !== null && groupId !== next) finish();
    setPlacing(false);
    setGroupId(next);
    const last = blocksIn(next, state.textBlocks).at(-1);
    if (last) {
      const typed = stored(last);
      setFocused({ blockId: last.id, typed, selection: endOf(typed) });
      requestFocus(last.id, endOf(typed));
    }
  };

  const group = groupId === null ? undefined : state.textGroups.get(groupId);
  const blocks = groupId === null ? [] : blocksIn(groupId, state.textBlocks);
  const focusedIndex = blocks.findIndex(({ id }) => id === focused?.blockId);
  const below = group ? groupBelow(group, groupsOn(pageId, state.textGroups)) : null;

  return {
    editable,
    placing,
    groupId,
    focusedBlockId: focused?.blockId ?? null,
    focusRequest,
    typedOf,
    startPlacing: () => {
      if (!editable) return;
      finish();
      setPlacing(true);
    },
    cancelPlacing: () => setPlacing(false),
    place: (tap) => {
      if (!editable) return;
      const spot = newGroupSpot(tap, page);
      const made = sync.addText(pageId, spot.at, spot.width, "");
      setPlacing(false);
      setGroupId(made.groupId);
      const typed: TypedBlock = { kind: "paragraph", indent: 0, text: "" };
      setFocused({ blockId: made.blockId, typed, selection: { start: 0, end: 0 } });
      requestFocus(made.blockId, { start: 0, end: 0 });
    },
    edit,
    focus: (blockId) => {
      if (focused?.blockId === blockId) return;
      if (focused) drafts.leave(focused.blockId);
      const block = blockOf(blockId);
      if (block) setFocused({ blockId, typed: stored(block), selection: { start: 0, end: 0 } });
    },
    select: (blockId, selection) => {
      if (focused?.blockId === blockId) setFocused({ ...focused, selection });
    },
    leave: (blockId) => drafts.leave(blockId),
    change: (blockId, text) => {
      const block = blockOf(blockId);
      if (!block || groupId === null || !editable) return;
      const before = typedOf(block);
      const [first = "", ...more] = text.split(/\r?\n/);
      let typed: TypedBlock = { ...before, text: first };
      const shortcut = before.kind === "paragraph" ? blockShortcut(first) : null;
      if (shortcut) typed = { kind: shortcut.kind, indent: 0, text: shortcut.text };
      const isList = typed.kind === "bulleted" || typed.kind === "numbered";
      if (more.length === 0) {
        const markdown = markdownOf(typed);
        if (textBlockProblem(markdown)) return;
        setTyped(blockId, typed, shortcut ? { start: 0, end: 0 } : undefined);
        if (shortcut) requestFocus(blockId, { start: 0, end: 0 });
        drafts.type(blockId, markdown);
        return;
      }
      if (isList && first === "" && more.length === 1 && more[0] === "") {
        const paragraph: TypedBlock = { kind: "paragraph", indent: 0, text: "" };
        send(blockId, paragraph);
        setTyped(blockId, paragraph);
        return;
      }
      send(blockId, typed);
      let after = blockId;
      let last: TypedBlock = typed;
      for (const line of more) {
        last = {
          kind: isList ? typed.kind : "paragraph",
          indent: isList ? typed.indent : 0,
          text: line,
        };
        after = sync.addBlock(groupId, after, markdownOf(last));
      }
      setFocused({ blockId: after, typed: last, selection: { start: 0, end: 0 } });
      requestFocus(after, { start: 0, end: 0 });
    },
    backspaceAtStart: (blockId) => {
      const block = blockOf(blockId);
      if (!block || groupId === null || !editable) return;
      const typed = typedOf(block);
      if (typed.kind !== "paragraph") {
        const paragraph = { ...typed, kind: "paragraph" as const, indent: 0 };
        send(blockId, paragraph);
        setTyped(blockId, paragraph, { start: 0, end: 0 });
        return;
      }
      const index = blocks.findIndex(({ id }) => id === blockId);
      const previous = blocks[index - 1];
      if (!previous) return;
      const joined = stored(previous);
      const caret = joined.text.length;
      const merged = { ...joined, text: joined.text + typed.text };
      drafts.drop(blockId);
      sync.deleteBlock(blockId);
      send(previous.id, merged);
      setFocused({ blockId: previous.id, typed: merged, selection: { start: caret, end: caret } });
      requestFocus(previous.id, { start: caret, end: caret });
    },
    setKind: (kind) => {
      if (!focused || !editable) return;
      const isList = kind === "bulleted" || kind === "numbered";
      const typed = { ...focused.typed, kind, indent: isList ? focused.typed.indent : 0 };
      send(focused.blockId, typed);
      setTyped(focused.blockId, typed);
      requestFocus(focused.blockId, focused.selection);
    },
    indent: (by) => {
      if (!focused || !editable) return;
      const { kind, indent } = focused.typed;
      if (kind !== "bulleted" && kind !== "numbered") return;
      const typed = { ...focused.typed, indent: Math.max(0, Math.min(indent + by, indentLimit)) };
      send(focused.blockId, typed);
      setTyped(focused.blockId, typed);
      requestFocus(focused.blockId, focused.selection);
    },
    toggleStyle: (style) => {
      if (!focused || !editable) return;
      const wrapped = wrapSelection(focused.typed.text, focused.selection, style);
      const typed = { ...focused.typed, text: wrapped.text };
      send(focused.blockId, typed);
      setTyped(focused.blockId, typed, wrapped.selection);
      requestFocus(focused.blockId, wrapped.selection);
    },
    canSplit: editable && focusedIndex > 0,
    split: (at) => {
      if (!focused || focusedIndex <= 0 || !editable) return;
      drafts.flush();
      const made = sync.splitTextGroup(focused.blockId, at);
      if (!made) return;
      setGroupId(made);
      requestFocus(focused.blockId, focused.selection);
    },
    canJoin: editable && below !== null,
    joinBelow: () => {
      if (!group || !below || !editable) return;
      drafts.flush();
      sync.joinTextGroups(group.id, below.id);
    },
    resize: (width) => {
      if (!group || !editable) return;
      const fits = Math.max(narrowestGroup, Math.min(width, page.width - group.x));
      if (fits !== group.width) sync.resizeTextGroup(group.id, fits);
    },
    move: (moved, to) => {
      if (!editable) return;
      sync.moveTextGroup(moved, to.x, to.y);
    },
    remove: () => {
      if (!group) return;
      for (const { id } of blocks) drafts.drop(id);
      sync.deleteTextGroup(group.id);
      setGroupId(null);
      setFocused(null);
    },
    finish,
  };
}

function markdownOf(typed: TypedBlock): string {
  return writeBlockMarkdown({ ...typed, runs: readTypedText(typed.text) });
}

function endOf(typed: TypedBlock): Selection {
  return { start: typed.text.length, end: typed.text.length };
}

import { mergeRuns, type TextBlockKind, type TextRun } from "@foyer/shared";

/** A block as someone edits it: its kind, how far a list item is nested, and its text as typed,
 *  with `*` around words for italic, `**` for bold and `***` for both, as Markdown has them. */
export type TypedBlock = { kind: TextBlockKind; indent: number; text: string };

/** The runs of what someone typed. Stars that open and close a stretch, touching its first and
 *  last characters, style it; any other stars are kept as typed. */
export function readTypedText(typed: string): TextRun[] {
  const tokens = tokensOf(typed);
  const opened: number[] = [];
  const pairs = new Map<number, number>();
  tokens.forEach((token, index) => {
    if (token.stars === 0 || token.stars > 3) return;
    const before = typed.charAt(token.from - 1);
    const after = typed.charAt(token.from + token.stars);
    const canClose = before !== "" && !/\s/.test(before);
    const canOpen = after !== "" && !/\s/.test(after);
    if (canClose) {
      const match = opened.findLastIndex((open) => tokens[open]?.stars === token.stars);
      if (match >= 0) {
        pairs.set(opened[match] ?? -1, index);
        opened.splice(match);
        return;
      }
    }
    if (canOpen) opened.push(index);
  });

  const closing = new Set(pairs.values());
  const runs: TextRun[] = [];
  let bold = 0;
  let italic = 0;
  tokens.forEach((token, index) => {
    const marker = pairs.has(index) ? 1 : closing.has(index) ? -1 : 0;
    if (marker === 0) {
      const text = token.stars > 0 ? "*".repeat(token.stars) : token.text;
      runs.push({ text, bold: bold > 0, italic: italic > 0 });
      return;
    }
    if (token.stars >= 2) bold += marker;
    if (token.stars !== 2) italic += marker;
  });
  return mergeRuns(runs);
}

/** How runs read as typed, with each style's stars around it. */
export function typedTextOf(runs: readonly TextRun[]): string {
  return mergeRuns(runs)
    .map(({ text, bold, italic }) => {
      const stars = "*".repeat((bold ? 2 : 0) + (italic ? 1 : 0));
      return stars + text + stars;
    })
    .join("");
}

const shortcuts: [string, TextBlockKind][] = [
  ["### ", "heading3"],
  ["## ", "heading2"],
  ["# ", "heading1"],
  ["- ", "bulleted"],
  ["* ", "bulleted"],
  ["1. ", "numbered"],
];

/** The kind a paragraph becomes when someone types Markdown's prefix for it at its start, such as
 *  "# " for a heading or "- " for a bulleted item, and the text after it, or null. */
export function blockShortcut(typed: string): { kind: TextBlockKind; text: string } | null {
  const found = shortcuts.find(([prefix]) => typed.startsWith(prefix));
  return found ? { kind: found[1], text: typed.slice(found[0].length) } : null;
}

/** A selection in typed text, from its start to its end. */
export type Selection = { start: number; end: number };

/** Typed text with a style's stars around the selection, leaving out spaces at its ends, and the
 *  selection inside them. With nothing selected, the stars go at the cursor, with it between. */
export function wrapSelection(
  typed: string,
  selection: Selection,
  style: "bold" | "italic",
): { text: string; selection: Selection } {
  const stars = style === "bold" ? "**" : "*";
  let { start, end } = selection;
  while (start < end && /\s/.test(typed.charAt(start))) start += 1;
  while (end > start && /\s/.test(typed.charAt(end - 1))) end -= 1;
  const text = typed.slice(0, start) + stars + typed.slice(start, end) + stars + typed.slice(end);
  return { text, selection: { start: start + stars.length, end: end + stars.length } };
}

type Token = { from: number; stars: number; text: string };

function tokensOf(typed: string): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  while (at < typed.length) {
    const from = at;
    if (typed.charAt(at) === "*") {
      while (typed.charAt(at) === "*") at += 1;
      tokens.push({ from, stars: at - from, text: "" });
    } else {
      while (at < typed.length && typed.charAt(at) !== "*") at += 1;
      tokens.push({ from, stars: 0, text: typed.slice(from, at) });
    }
  }
  return tokens;
}

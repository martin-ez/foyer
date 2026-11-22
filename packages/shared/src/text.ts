/** What a text block is: a paragraph, a heading of one of three levels, or a list item. */
export type TextBlockKind =
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3"
  | "bulleted"
  | "numbered";

/** A stretch of a block's text in one style. */
export type TextRun = { text: string; bold: boolean; italic: boolean };

/** What a block holds: its kind, how many levels a list item is nested (0 for anything else), and
 *  its text, as runs in their styles. */
export type TextBlockContent = { kind: TextBlockKind; indent: number; runs: readonly TextRun[] };

/** The most characters a block's Markdown can have, counted as Unicode code points. */
export const textBlockLimit = 10_000;

/** The longest a block's order can be. Adding blocks one after another at the end or the start
 *  of a group lengthens their orders by a character about every 30 blocks. */
export const textOrderLimit = 1_000;

const orderDigits = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** An order that sorts after `before` and before `after`, compared character by character, where
 *  null means the start or the end of the group. Throws when `before` doesn't sort before `after`,
 *  or either isn't an order. */
export function orderBetween(before: string | null, after: string | null): string {
  for (const order of [before, after]) {
    if (order !== null && textOrderProblem(order)) throw new Error(`“${order}” isn't an order.`);
  }
  if (before !== null && after !== null && before >= after) {
    throw new Error(`“${before}” doesn't sort before “${after}”.`);
  }
  return midpoint(before ?? "", after);
}

function midpoint(low: string, high: string | null): string {
  const last = orderDigits.length - 1;
  if (high === null && low !== "") {
    const from = orderDigits.indexOf(low.charAt(0));
    if (from < last) return orderDigits.charAt(from + 1);
    return orderDigits.charAt(last) + midpoint(low.slice(1), null);
  }
  if (low === "" && high !== null) {
    const to = orderDigits.indexOf(high.charAt(0));
    if (to > 1) return orderDigits.charAt(to - 1);
  }
  if (high !== null) {
    let shared = 0;
    while (shared < high.length && (low[shared] ?? "0") === high[shared]) shared += 1;
    if (shared > 0) return high.slice(0, shared) + midpoint(low.slice(shared), high.slice(shared));
  }
  const from = low === "" ? 0 : orderDigits.indexOf(low.charAt(0));
  const to = high === null ? orderDigits.length : orderDigits.indexOf(high.charAt(0));
  if (to - from > 1) return orderDigits.charAt(Math.round((from + to) / 2));
  if (high !== null && high.length > 1) return high.charAt(0);
  return orderDigits.charAt(from) + midpoint(low.slice(1), null);
}

/** Why this can't be a block's order, as a sentence, or null if it can. */
export function textOrderProblem(order: string): string | null {
  if (
    order === "" ||
    order.length > textOrderLimit ||
    order.endsWith("0") ||
    [...order].some((character) => !orderDigits.includes(character))
  ) {
    return "A block's order must be made of 0-9, A-Z and a-z, not end in 0, and be at most 1,000 characters.";
  }
  return null;
}

/** Why a block can't hold this Markdown, as a sentence, or null if it can: one line of at most
 *  `textBlockLimit` characters, holding only what `writeBlockMarkdown` writes. */
export function textBlockProblem(markdown: string): string | null {
  if (Array.from(markdown).length > textBlockLimit) {
    return "A block can't be longer than 10,000 characters.";
  }
  if (/[\n\r]/.test(markdown)) return "A block's text can't hold line breaks.";
  if (writeBlockMarkdown(readBlockMarkdown(markdown)) !== markdown) {
    return "A block's Markdown can only hold its type, bold and italic, with anything else escaped.";
  }
  return null;
}

const listPrefix = /^((?: {2})*)(- |1\. )/;
const headingPrefix = /^(#{1,3}) /;
const headings = ["heading1", "heading2", "heading3"] as const;

/** What a block's Markdown holds. Reads anything, but only Markdown that `textBlockProblem` takes
 *  reads back as it was written. */
export function readBlockMarkdown(markdown: string): TextBlockContent {
  const list = listPrefix.exec(markdown);
  if (list) {
    const [prefix, spaces = "", marker] = list;
    const kind = marker === "- " ? "bulleted" : "numbered";
    return { kind, indent: spaces.length / 2, runs: readRuns(markdown.slice(prefix.length)) };
  }
  const heading = headingPrefix.exec(markdown);
  if (heading) {
    const [prefix, hashes = "#"] = heading;
    const kind = headings[hashes.length - 1] ?? "heading1";
    return { kind, indent: 0, runs: readRuns(markdown.slice(prefix.length)) };
  }
  return { kind: "paragraph", indent: 0, runs: readRuns(markdown) };
}

/** A block as Markdown: its type's prefix, then its runs, each style marked on its own, with
 *  anything else Markdown would read as more escaped. List items take at most `indent` levels;
 *  other blocks none. */
export function writeBlockMarkdown(block: TextBlockContent): string {
  const runs = mergeRuns(block.runs);
  let inline = runs.map(writeRun).join("");
  const first = runs[0];
  if (first && !first.bold && !first.italic) inline = escapeStart(inline);
  const isHeading = (headings as readonly string[]).includes(block.kind);
  if (isHeading && endsWithBareHash(inline)) inline = `${inline.slice(0, -1)}\\#`;
  return prefixOf(block) + inline;
}

function prefixOf({ kind, indent }: TextBlockContent): string {
  switch (kind) {
    case "paragraph":
      return "";
    case "heading1":
      return "# ";
    case "heading2":
      return "## ";
    case "heading3":
      return "### ";
    case "bulleted":
      return `${"  ".repeat(indent)}- `;
    case "numbered":
      return `${"  ".repeat(indent)}1. `;
  }
}

/** A block's text without its styles. */
export function plainTextOf(runs: readonly TextRun[]): string {
  return runs.map(({ text }) => text).join("");
}

/** The runs, with neighbours in the same style joined and empty ones dropped. */
export function mergeRuns(runs: readonly TextRun[]): TextRun[] {
  const merged: TextRun[] = [];
  for (const run of runs) {
    if (run.text === "") continue;
    const last = merged[merged.length - 1];
    if (last && last.bold === run.bold && last.italic === run.italic) {
      merged[merged.length - 1] = { ...last, text: last.text + run.text };
    } else {
      merged.push({ ...run });
    }
  }
  return merged;
}

function readRuns(inline: string): TextRun[] {
  const runs: TextRun[] = [];
  let open = 0;
  let text = "";
  const flush = () => {
    if (text !== "") runs.push({ text, bold: open >= 2, italic: open % 2 === 1 });
    text = "";
  };
  let at = 0;
  while (at < inline.length) {
    const character = inline.charAt(at);
    const next = inline.charAt(at + 1);
    if (character === "\\" && isAsciiPunctuation(next)) {
      text += next;
      at += 2;
      continue;
    }
    if (character !== "*") {
      text += character;
      at += 1;
      continue;
    }
    let stars = 0;
    while (inline.charAt(at + stars) === "*") stars += 1;
    at += stars;
    if (stars < open) {
      text += "*".repeat(stars);
      continue;
    }
    const opening = stars - open;
    if (opening > 3) {
      text += "*".repeat(stars);
      continue;
    }
    flush();
    open = opening;
  }
  flush();
  return runs;
}

function writeRun({ text, bold, italic }: TextRun): string {
  const marker = "*".repeat((bold ? 2 : 0) + (italic ? 1 : 0));
  return marker + escapeInline(text) + marker;
}

const entity = /^&(?:#\d+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/;

function escapeInline(text: string): string {
  let escaped = "";
  for (let at = 0; at < text.length; at += 1) {
    const character = text.charAt(at);
    const special =
      "\\`*_[]<~".includes(character) || (character === "&" && entity.test(text.slice(at)));
    escaped += special ? `\\${character}` : character;
  }
  return escaped;
}

function escapeStart(inline: string): string {
  const spaces = /^ */.exec(inline)?.[0] ?? "";
  const rest = inline.slice(spaces.length);
  const numbered = /^\d{1,9}[.)]/.exec(rest);
  if (numbered) {
    const digits = numbered[0].slice(0, -1);
    return `${spaces}${digits}\\${rest.slice(digits.length)}`;
  }
  return "#-+>".includes(rest.charAt(0)) && rest !== "" ? `${spaces}\\${rest}` : inline;
}

function endsWithBareHash(inline: string): boolean {
  if (!inline.endsWith("#")) return false;
  const backslashes = /\\*#$/.exec(inline)?.[0].length ?? 1;
  return (backslashes - 1) % 2 === 0;
}

function isAsciiPunctuation(character: string): boolean {
  return character !== "" && "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~".includes(character);
}

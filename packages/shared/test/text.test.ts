import {
  orderBetween,
  plainTextOf,
  readBlockMarkdown,
  type TextBlockContent,
  type TextRun,
  textBlockLimit,
  textBlockProblem,
  textOrderProblem,
  writeBlockMarkdown,
} from "@foyer/shared";
import { describe, expect, it } from "vitest";

const plain = (text: string): TextRun => ({ text, bold: false, italic: false });
const bold = (text: string): TextRun => ({ text, bold: true, italic: false });
const italic = (text: string): TextRun => ({ text, bold: false, italic: true });
const both = (text: string): TextRun => ({ text, bold: true, italic: true });
const paragraph = (...runs: TextRun[]): TextBlockContent => ({
  kind: "paragraph",
  indent: 0,
  runs,
});

describe("orderBetween", () => {
  it("makes an order between two others, or before or after one", () => {
    const first = orderBetween(null, null);
    const after = orderBetween(first, null);
    const before = orderBetween(null, first);
    const between = orderBetween(first, after);
    expect([before < first, first < between, between < after]).toEqual([true, true, true]);
  });

  it("always fits another order between two that sort next to each other", () => {
    let low = orderBetween(null, null);
    const high = orderBetween(low, null);
    for (let times = 0; times < 200; times += 1) {
      const next = orderBetween(low, high);
      expect(low < next && next < high).toBe(true);
      expect(textOrderProblem(next)).toBe(null);
      low = next;
    }
  });

  it("keeps orders short when blocks are added at the end or the start, one after another", () => {
    let last = orderBetween(null, null);
    let first = last;
    for (let times = 0; times < 300; times += 1) {
      const next = orderBetween(last, null);
      const previous = orderBetween(null, first);
      expect(last < next && previous < first).toBe(true);
      last = next;
      first = previous;
    }
    expect(last.length).toBeLessThan(15);
    expect(first.length).toBeLessThan(15);
  });

  it("refuses orders that don't sort one before the other", () => {
    expect(() => orderBetween("V", "V")).toThrow();
    expect(() => orderBetween("b", "a")).toThrow();
    expect(() => orderBetween("a0", null)).toThrow();
  });
});

describe("textOrderProblem", () => {
  it("takes digits and letters that don't end in 0", () => {
    expect(textOrderProblem("V")).toBe(null);
    expect(textOrderProblem("0Az9")).toBe(null);
  });

  it("refuses an empty order, one ending in 0, other characters, and long ones", () => {
    const problem =
      "A block's order must be made of 0-9, A-Z and a-z, not end in 0, and be at most 1,000 characters.";
    for (const order of ["", "a0", "a-b", "é", "a".repeat(1_001)]) {
      expect(textOrderProblem(order)).toBe(problem);
    }
  });
});

describe("readBlockMarkdown and writeBlockMarkdown", () => {
  const cases: [string, TextBlockContent][] = [
    ["Buy milk", paragraph(plain("Buy milk"))],
    ["", paragraph()],
    ["# Shopping", { kind: "heading1", indent: 0, runs: [plain("Shopping")] }],
    ["## Monday", { kind: "heading2", indent: 0, runs: [plain("Monday")] }],
    ["### Notes", { kind: "heading3", indent: 0, runs: [plain("Notes")] }],
    ["- Oat milk", { kind: "bulleted", indent: 0, runs: [plain("Oat milk")] }],
    ["    - Barista", { kind: "bulleted", indent: 2, runs: [plain("Barista")] }],
    ["1. Call the bank", { kind: "numbered", indent: 0, runs: [plain("Call the bank")] }],
    ["  1. ", { kind: "numbered", indent: 1, runs: [] }],
    [
      "Get **oat** milk, *not* ***dairy***",
      paragraph(
        plain("Get "),
        bold("oat"),
        plain(" milk, "),
        italic("not"),
        plain(" "),
        both("dairy"),
      ),
    ],
    ["**a***b*", paragraph(bold("a"), italic("b"))],
    ["*a***b**", paragraph(italic("a"), bold("b"))],
    ["**a*****b***c", paragraph(bold("a"), both("b"), plain("c"))],
  ];

  it.each(cases)("reads and writes %j", (markdown, content) => {
    expect(readBlockMarkdown(markdown)).toEqual(content);
    expect(writeBlockMarkdown(content)).toBe(markdown);
    expect(textBlockProblem(markdown)).toBe(null);
  });

  it("escapes what Markdown would read as more than text, keeping it as typed", () => {
    const typed: [string, string][] = [
      ["5 * 3 = 15", "5 \\* 3 = 15"],
      ["snake_case and `code`", "snake\\_case and \\`code\\`"],
      ["[link](https://example.com) <b>", "\\[link\\](https://example.com) \\<b>"],
      ["a\\b ~strike~", "a\\\\b \\~strike\\~"],
      ["&amp; but not & alone", "\\&amp; but not & alone"],
      ["# not a heading", "\\# not a heading"],
      ["#hashtag", "\\#hashtag"],
      ["- not a list", "\\- not a list"],
      ["+ plus", "\\+ plus"],
      ["> quote", "\\> quote"],
      ["2026. A good year", "2026\\. A good year"],
      ["1) first", "1\\) first"],
      ["  - indented", "  \\- indented"],
    ];
    for (const [text, markdown] of typed) {
      expect(writeBlockMarkdown(paragraph(plain(text)))).toBe(markdown);
      expect(readBlockMarkdown(markdown)).toEqual(paragraph(plain(text)));
      expect(textBlockProblem(markdown)).toBe(null);
    }
  });

  it("escapes a list item's or heading's text that starts like Markdown", () => {
    const item = { kind: "bulleted", indent: 0, runs: [plain("- nested?")] } as const;
    expect(writeBlockMarkdown(item)).toBe("- \\- nested?");
    expect(readBlockMarkdown("- \\- nested?")).toEqual(item);
    const numbered = { kind: "numbered", indent: 0, runs: [plain("1. again")] } as const;
    expect(writeBlockMarkdown(numbered)).toBe("1. 1\\. again");
  });

  it("escapes a heading's last #, which Markdown would drop", () => {
    const heading = { kind: "heading2", indent: 0, runs: [plain("Learn C#")] } as const;
    expect(writeBlockMarkdown(heading)).toBe("## Learn C\\#");
    expect(readBlockMarkdown("## Learn C\\#")).toEqual(heading);
    const hash = { kind: "heading1", indent: 0, runs: [plain("#")] } as const;
    expect(writeBlockMarkdown(hash)).toBe("# \\#");
    expect(readBlockMarkdown("# \\#")).toEqual(hash);
  });

  it("joins neighbouring runs in the same style, and drops empty ones", () => {
    const content = paragraph(bold("a"), bold("b"), plain(""), plain("c"));
    expect(writeBlockMarkdown(content)).toBe("**ab**c");
  });

  it("writes only list items nested", () => {
    expect(writeBlockMarkdown({ kind: "paragraph", indent: 2, runs: [plain("a")] })).toBe("a");
  });
});

describe("textBlockProblem", () => {
  it("refuses Markdown it wouldn't write: other syntax, unescaped or loose markers", () => {
    const problem =
      "A block's Markdown can only hold its type, bold and italic, with anything else escaped.";
    for (const markdown of [
      "_italic_",
      "[link](https://example.com)",
      "#### Too deep",
      "2. Two",
      "   - Three spaces",
      "**unclosed",
      "****",
      "a\\b",
      "* star list",
      "**a****b**",
    ]) {
      expect(textBlockProblem(markdown)).toBe(problem);
    }
  });

  it("refuses line breaks", () => {
    expect(textBlockProblem("one\ntwo")).toBe("A block's text can't hold line breaks.");
    expect(textBlockProblem("one\rtwo")).toBe("A block's text can't hold line breaks.");
  });

  it("refuses Markdown over the limit, counting characters as code points", () => {
    expect(textBlockLimit).toBe(10_000);
    expect(textBlockProblem(`${"a".repeat(9_999)}🧺`)).toBe(null);
    expect(textBlockProblem("a".repeat(10_001))).toBe(
      "A block can't be longer than 10,000 characters.",
    );
  });
});

describe("plainTextOf", () => {
  it("joins a block's runs without their styles", () => {
    expect(plainTextOf([plain("Get "), bold("oat"), plain(" milk")])).toBe("Get oat milk");
  });
});

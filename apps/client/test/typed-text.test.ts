import type { TextRun } from "@foyer/shared";
import { describe, expect, it } from "vitest";
import { blockShortcut, readTypedText, typedTextOf, wrapSelection } from "../src/text/typed-text";

const plain = (text: string): TextRun => ({ text, bold: false, italic: false });
const bold = (text: string): TextRun => ({ text, bold: true, italic: false });
const italic = (text: string): TextRun => ({ text, bold: false, italic: true });
const both = (text: string): TextRun => ({ text, bold: true, italic: true });

describe("readTypedText", () => {
  it("styles stretches between stars, as Markdown does", () => {
    expect(readTypedText("Get **oat** milk, *not* ***dairy***")).toEqual([
      plain("Get "),
      bold("oat"),
      plain(" milk, "),
      italic("not"),
      plain(" "),
      both("dairy"),
    ]);
  });

  it("styles stretches inside others", () => {
    expect(readTypedText("**bold *and italic* bold**")).toEqual([
      bold("bold "),
      both("and italic"),
      bold(" bold"),
    ]);
  });

  it("keeps stars that don't open and close a stretch as typed", () => {
    expect(readTypedText("5 * 3 = 15")).toEqual([plain("5 * 3 = 15")]);
    expect(readTypedText("**unclosed")).toEqual([plain("**unclosed")]);
    expect(readTypedText("** spaced **")).toEqual([plain("** spaced **")]);
    expect(readTypedText("a ****** b")).toEqual([plain("a ****** b")]);
  });

  it("reads plain text as one run, and nothing as none", () => {
    expect(readTypedText("Buy milk")).toEqual([plain("Buy milk")]);
    expect(readTypedText("")).toEqual([]);
  });
});

describe("typedTextOf", () => {
  it("puts each style's stars around it, reading back as the same runs", () => {
    const runs = [plain("Get "), bold("oat"), plain(" milk, "), italic("not"), both("!")];
    const typed = typedTextOf(runs);
    expect(typed).toBe("Get **oat** milk, *not****!***");
    expect(readTypedText("Get **oat** milk, *not* ***!***")).toEqual([
      ...runs.slice(0, 4),
      plain(" "),
      both("!"),
    ]);
  });
});

describe("blockShortcut", () => {
  it("turns Markdown's prefixes into a block's kind", () => {
    expect(blockShortcut("# Shopping")).toEqual({ kind: "heading1", text: "Shopping" });
    expect(blockShortcut("## ")).toEqual({ kind: "heading2", text: "" });
    expect(blockShortcut("### Notes")).toEqual({ kind: "heading3", text: "Notes" });
    expect(blockShortcut("- Oat milk")).toEqual({ kind: "bulleted", text: "Oat milk" });
    expect(blockShortcut("* Oat milk")).toEqual({ kind: "bulleted", text: "Oat milk" });
    expect(blockShortcut("1. Call")).toEqual({ kind: "numbered", text: "Call" });
  });

  it("leaves other text as it is", () => {
    expect(blockShortcut("#hashtag")).toBe(null);
    expect(blockShortcut("2. Two")).toBe(null);
    expect(blockShortcut("Buy milk")).toBe(null);
  });
});

describe("wrapSelection", () => {
  it("puts a style's stars around the selection, leaving out spaces at its ends", () => {
    expect(wrapSelection("Get oat milk", { start: 3, end: 8 }, "bold")).toEqual({
      text: "Get **oat** milk",
      selection: { start: 6, end: 9 },
    });
    expect(wrapSelection("Get oat milk", { start: 4, end: 7 }, "italic")).toEqual({
      text: "Get *oat* milk",
      selection: { start: 5, end: 8 },
    });
  });

  it("puts the stars at the cursor when nothing is selected", () => {
    expect(wrapSelection("Get ", { start: 4, end: 4 }, "bold")).toEqual({
      text: "Get ****",
      selection: { start: 6, end: 6 },
    });
  });
});

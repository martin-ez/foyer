import { describe, expect, it } from "vitest";
import { plainTextOf } from "../src/html-text";

describe("a description written as HTML", () => {
  it("puts each line break, paragraph and list item on a line of its own", () => {
    expect(plainTextOf("Bring:<br>the card<br><br>and a pen")).toBe(
      "Bring:\nthe card\n\nand a pen",
    );
    expect(plainTextOf("<p>First</p><p>Second</p><div>Third</div><div>Fourth</div>")).toBe(
      "First\n\nSecond\n\nThird\nFourth",
    );
    expect(plainTextOf("Shopping:<ul><li>Milk</li><li><b>Eggs</b></li></ul>Thanks")).toBe(
      "Shopping:\nMilk\nEggs\nThanks",
    );
  });

  it("drops other tags, and keeps the text and line breaks between them", () => {
    expect(plainTextOf('<html-blob><b>Bold</b> and <span style="x">plain</span></html-blob>')).toBe(
      "Bold and plain",
    );
    expect(plainTextOf("<i>Line one</i>\nLine two")).toBe("Line one\nLine two");
    expect(plainTextOf("<ul>\n<li>One</li>\n<li>Two</li>\n</ul>")).toBe("One\nTwo");
    expect(plainTextOf("<b>Note</b><!-- a comment --><style>b { color: red }</style>")).toBe(
      "Note",
    );
  });

  it("decodes entities, in text and in addresses", () => {
    expect(plainTextOf("<b>Tom &amp; Jerry</b> &lt;3&nbsp;&#8212; &#x1F600; &unknown;")).toBe(
      "Tom & Jerry <3 — 😀 &unknown;",
    );
    expect(plainTextOf('<a href="https://example.com/?a=1&amp;b=2">Tickets</a>')).toBe(
      "Tickets (https://example.com/?a=1&b=2)",
    );
  });

  it("follows a link's text with its address only when the two differ", () => {
    expect(plainTextOf('See <a href="https://example.com/menu">the menu</a>.')).toBe(
      "See the menu (https://example.com/menu).",
    );
    expect(plainTextOf('<a href="https://example.com/">https://example.com</a>')).toBe(
      "https://example.com",
    );
    expect(plainTextOf("<a href='mailto:sam@example.com'>sam@example.com</a>")).toBe(
      "sam@example.com",
    );
    expect(plainTextOf('<a href="https://example.com/map"><img src="map.png"></a>')).toBe(
      "https://example.com/map",
    );
  });

  it("gives the address a link to Google's redirect leads to", () => {
    const redirect =
      "https://www.google.com/url?q=https://example.com/menu&amp;sa=D&amp;source=calendar";

    expect(plainTextOf(`<a href="${redirect}">https://example.com/menu</a>`)).toBe(
      "https://example.com/menu",
    );
    expect(plainTextOf(`<a href="${redirect}">Menu</a>`)).toBe("Menu (https://example.com/menu)");
  });
});

describe("a plain-text description", () => {
  it("is kept as it is, even holding what looks like markup", () => {
    for (const plain of [
      "Bring the card\n\n  and a pen  ",
      "a < b and c > d",
      "Tom &amp; Jerry",
      "x<y and z>w",
      "",
    ]) {
      expect(plainTextOf(plain)).toBe(plain);
    }
  });
});

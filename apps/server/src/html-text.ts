const knownTags =
  "a|b|br|i|u|s|em|strong|span|p|div|ul|ol|li|h[1-6]|blockquote|pre|code|font|sub|sup|hr|strike|del|ins|img|table|thead|tbody|tr|td|th|html-blob";
const knownTag = new RegExp(`<\\/?(?:${knownTags})(?:\\s[^<>]*)?\\/?>`, "i");
const markup = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)([^<>]*)>/g;
const paragraphTags = new Set(["p", "blockquote", "pre", "h1", "h2", "h3", "h4", "h5", "h6"]);
const lineTags = new Set(["div", "ul", "ol", "li", "hr", "table", "tr"]);
const hiddenTags = new Set(["script", "style", "head", "title"]);
const namedEntities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  bull: "•",
  middot: "·",
  copy: "©",
  reg: "®",
  trade: "™",
  euro: "€",
};

/** A description as plain text: one written as HTML, as Google Calendar's own editor saves it, with
 *  its line breaks, paragraphs and list items on lines of their own, each link's address after its
 *  text when the two differ, other tags dropped and entities decoded. Text with no tags is kept. */
export function plainTextOf(description: string): string {
  if (!knownTag.test(description)) return description;
  let text = "";
  let hidden = 0;
  let link: { address: string; from: number } | null = null;
  const breakLine = () => {
    if (text !== "" && !text.endsWith("\n")) text += "\n";
  };
  const breakParagraph = () => {
    breakLine();
    if (text !== "" && !text.endsWith("\n\n")) text += "\n";
  };
  const addText = (raw: string) => {
    if (hidden > 0 || raw === "") return;
    const decoded = decodeEntities(raw.replaceAll("\r\n", "\n"));
    if (decoded.trim() === "" && (text === "" || text.endsWith("\n"))) return;
    text += decoded;
  };

  let from = 0;
  for (const match of description.matchAll(markup)) {
    addText(description.slice(from, match.index));
    from = match.index + match[0].length;
    const [, closing, name = "", attributes = ""] = match;
    const tag = name.toLowerCase();
    if (hiddenTags.has(tag)) {
      hidden = Math.max(0, hidden + (closing ? -1 : 1));
    } else if (tag === "br") {
      text += "\n";
    } else if (paragraphTags.has(tag)) {
      breakParagraph();
    } else if (lineTags.has(tag)) {
      breakLine();
    } else if (tag === "a" && !closing) {
      const address = addressOf(attributes);
      link = address ? { address, from: text.length } : null;
    } else if (tag === "a" && link) {
      const shown = text.slice(link.from).trim();
      if (!sameAddress(shown, link.address)) {
        text += shown === "" ? link.address : ` (${link.address})`;
      }
      link = null;
    }
  }
  addText(description.slice(from));
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeEntities(text: string): string {
  return text.replace(
    /&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g,
    (entity, name: string) => {
      if (!name.startsWith("#")) return namedEntities[name] ?? entity;
      const hex = name[1] === "x" || name[1] === "X";
      const point = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
      const valid = point > 0 && point <= 0x10ffff && (point < 0xd800 || point > 0xdfff);
      return valid ? String.fromCodePoint(point) : entity;
    },
  );
}

function addressOf(attributes: string): string | null {
  const href = /(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`=]+))/i.exec(attributes);
  const address = decodeEntities(href?.[1] ?? href?.[2] ?? href?.[3] ?? "").trim();
  return address === "" ? null : (redirectTarget(address) ?? address);
}

function redirectTarget(address: string): string | null {
  try {
    const url = new URL(address);
    const isGoogle = url.hostname === "www.google.com" || url.hostname === "google.com";
    return isGoogle && url.pathname === "/url" ? url.searchParams.get("q") : null;
  } catch {
    return null;
  }
}

function sameAddress(shown: string, address: string): boolean {
  const plain = (value: string) => value.replace(/^(mailto|tel):/i, "").replace(/\/$/, "");
  return plain(shown) === plain(address);
}

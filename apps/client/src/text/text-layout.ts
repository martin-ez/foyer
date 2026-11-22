import { readBlockMarkdown, type TextBlockKind } from "@foyer/shared";
import type { TextBlock, TextGroup } from "@foyer/shared/gen/foyer/text/v1/text_pb";
import {
  FontSlant,
  FontWeight,
  type SkColor,
  type Skia,
  type SkParagraph,
  type SkTextStyle,
  type SkTypefaceFontProvider,
} from "react-native-skia";
import { describeText, listMarkers } from "./text-groups";

/** The family typed text is drawn in, bundled with the app. */
export const textFamily = "IBM Plex Sans";

/** The family emoji in typed text are drawn in, bundled with the app. */
export const emojiFamily = "Noto Color Emoji";

/** The colour of typed text. */
export const textColour = "#2b2620";

/** How each kind of block looks: its size in points, whether it's bold, and the space above it
 *  when another block comes before it. */
export const blockLooks: Record<TextBlockKind, { size: number; bold: boolean; above: number }> = {
  paragraph: { size: 12, bold: false, above: 0 },
  heading1: { size: 22, bold: true, above: 10 },
  heading2: { size: 17, bold: true, above: 8 },
  heading3: { size: 14, bold: true, above: 6 },
  bulleted: { size: 12, bold: false, above: 0 },
  numbered: { size: 12, bold: false, above: 0 },
};

/** The space between two blocks, in points. */
export const blockGap = 4;

/** How far each level of a list item is indented, in points. */
export const indentStep = 18;

/** The width of the column a list item's marker is drawn in, before its text. */
export const markerWidth = 16;

const lineHeight = 1.35;

/** A block laid out in its group: its top, from the group's top, its height, how far its text is
 *  from the group's left, and how wide it is, all in points, with its paragraph and its marker's. */
export type LaidOutBlock = {
  id: string;
  top: number;
  height: number;
  left: number;
  width: number;
  paragraph: SkParagraph;
  marker: SkParagraph | null;
  markerLeft: number;
};

/** A text group laid out on its page, in points: its blocks, how tall they make it, and its text as
 *  a screen reader reads it. */
export type LaidOutGroup = {
  group: TextGroup;
  height: number;
  blocks: LaidOutBlock[];
  text: string;
};

/** Lays a group's blocks out in page points, the same on every device, at every zoom: each block
 *  wraps within the group's width, less a list item's indent and marker. */
export function layOutGroup(
  skia: typeof Skia,
  fonts: SkTypefaceFontProvider,
  group: TextGroup,
  blocks: readonly TextBlock[],
): LaidOutGroup {
  const contents = blocks.map(({ markdown }) => readBlockMarkdown(markdown));
  const markers = listMarkers(contents);
  const colour = skia.Color(textColour);
  let bottom = 0;
  const laidOut = contents.map((content, index): LaidOutBlock => {
    const look = blockLooks[content.kind];
    const top = index === 0 ? 0 : bottom + blockGap + look.above;
    const indent = markers[index] === null ? 0 : content.indent * indentStep;
    const left = markers[index] === null ? 0 : indent + markerWidth;
    const width = Math.max(group.width - left, 1);
    const base = styleOf(colour, look.size, look.bold, false);
    const builder = skia.ParagraphBuilder.Make({ textStyle: base }, fonts);
    for (const run of content.runs) {
      builder.pushStyle(styleOf(colour, look.size, look.bold || run.bold, run.italic));
      builder.addText(run.text);
      builder.pop();
    }
    if (content.runs.length === 0) builder.addText(" ");
    const paragraph = builder.build();
    paragraph.layout(width);
    const height = paragraph.getHeight();
    const marker = markers[index] ?? null;
    const markerParagraph =
      marker === null
        ? null
        : skia.ParagraphBuilder.Make({ textStyle: base }, fonts).addText(marker).build();
    markerParagraph?.layout(markerWidth);
    bottom = top + height;
    const id = blocks[index]?.id ?? "";
    return { id, top, height, left, width, paragraph, marker: markerParagraph, markerLeft: indent };
  });
  return { group, height: bottom, blocks: laidOut, text: describeText(blocks) };
}

/** Lets go of the paragraphs a laid-out group holds. */
export function disposeGroup({ blocks }: LaidOutGroup): void {
  for (const { paragraph, marker } of blocks) {
    paragraph.dispose();
    marker?.dispose();
  }
}

/** Whether text holds an emoji, which needs the emoji font. */
export function hasEmoji(text: string): boolean {
  return /\p{Extended_Pictographic}/u.test(text);
}

function styleOf(colour: SkColor, size: number, bold: boolean, italic: boolean): SkTextStyle {
  return {
    color: colour,
    fontFamilies: [textFamily, emojiFamily],
    fontSize: size,
    heightMultiplier: lineHeight,
    fontStyle: {
      weight: bold ? FontWeight.Bold : FontWeight.Normal,
      slant: italic ? FontSlant.Italic : FontSlant.Upright,
    },
  };
}

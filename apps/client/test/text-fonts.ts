import { readFileSync } from "node:fs";
import path from "node:path";
import type { Skia as SkiaApi, SkTypefaceFontProvider } from "react-native-skia";
import { getSkiaExports } from "react-native-skia/lib/commonjs/headless";
import { emojiFamily, textFamily } from "../src/text/text-layout";

const fontsDir = path.join(import.meta.dirname, "..", "assets", "fonts");

/** Skia's API and the fonts the app bundles for typed text, read from their files. The headless
 *  build declares the same API with types of its own. */
export function textFonts(): { Skia: typeof SkiaApi; fonts: SkTypefaceFontProvider } {
  const { Skia } = getSkiaExports();
  const fonts = Skia.TypefaceFontProvider.Make();
  const files: [string, string][] = [
    ["IBMPlexSans-Regular.ttf", textFamily],
    ["IBMPlexSans-Italic.ttf", textFamily],
    ["IBMPlexSans-Bold.ttf", textFamily],
    ["IBMPlexSans-BoldItalic.ttf", textFamily],
    ["NotoColorEmoji.ttf", emojiFamily],
  ];
  for (const [file, family] of files) {
    const data = Skia.Data.fromBytes(new Uint8Array(readFileSync(path.join(fontsDir, file))));
    const typeface = Skia.Typeface.MakeFromData(data);
    if (!typeface) throw new Error(`Couldn't read ${file}`);
    fonts.registerFont(typeface, family);
  }
  return {
    Skia: Skia as unknown as typeof SkiaApi,
    fonts: fonts as unknown as SkTypefaceFontProvider,
  };
}

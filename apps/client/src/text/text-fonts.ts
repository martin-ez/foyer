import { Skia, type SkTypeface, type SkTypefaceFontProvider, useTypeface } from "react-native-skia";
import { emojiFamily, textFamily } from "./text-layout";

const regular = require("../../assets/fonts/IBMPlexSans-Regular.ttf");
const italic = require("../../assets/fonts/IBMPlexSans-Italic.ttf");
const bold = require("../../assets/fonts/IBMPlexSans-Bold.ttf");
const boldItalic = require("../../assets/fonts/IBMPlexSans-BoldItalic.ttf");
const emoji = require("../../assets/fonts/NotoColorEmoji.ttf");

const loaded: { text?: SkTypeface[]; emoji?: SkTypeface } = {};
const providers: { text?: SkTypefaceFontProvider; withEmoji?: SkTypefaceFontProvider } = {};

/** The fonts typed text is drawn in, once they've loaded, or null until then. The emoji font, about
 *  5 MB, only loads once some text needs it, and stays loaded after. */
export function useTextFonts(withEmoji: boolean): SkTypefaceFontProvider | null {
  const needText = loaded.text === undefined;
  const text = [
    useTypeface(needText ? regular : null),
    useTypeface(needText ? italic : null),
    useTypeface(needText ? bold : null),
    useTypeface(needText ? boldItalic : null),
  ];
  if (needText && text.every((face) => face !== null)) loaded.text = text as SkTypeface[];
  const emojiFace = useTypeface(withEmoji && loaded.emoji === undefined ? emoji : null);
  if (emojiFace && loaded.emoji === undefined) loaded.emoji = emojiFace;

  return fontsFor(withEmoji && loaded.emoji !== undefined);
}

function fontsFor(withEmoji: boolean): SkTypefaceFontProvider | null {
  const { text, emoji: emojiFace } = loaded;
  if (!text) return null;
  const which = withEmoji ? "withEmoji" : "text";
  const made = providers[which];
  if (made) return made;
  const fonts = Skia.TypefaceFontProvider.Make();
  for (const face of text) fonts.registerFont(face, textFamily);
  if (withEmoji && emojiFace) fonts.registerFont(emojiFace, emojiFamily);
  providers[which] = fonts;
  return fonts;
}

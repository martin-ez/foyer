import circleAndScribble from "./circle-and-scribble.json";
import fastFlick from "./fast-flick.json";
import handwrittenSentence from "./handwritten-sentence.json";
import tiltedPencil from "./tilted-pencil.json";
import tinyDot from "./tiny-dot.json";

/** The stroke fixtures recorded on a real iPad, by name, as `strokeFixtureOf` wrote them. Written
 *  by `pnpm record-strokes`. */
export const strokeFixtures: Readonly<Record<string, unknown>> = {
  "circle-and-scribble": circleAndScribble,
  "fast-flick": fastFlick,
  "handwritten-sentence": handwrittenSentence,
  "tilted-pencil": tiltedPencil,
  "tiny-dot": tinyDot,
};

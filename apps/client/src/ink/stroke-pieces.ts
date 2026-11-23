import { type StrokeSamples, strokeSampleLimit } from "@foyer/shared";

/** A stroke's samples split into strokes the household takes, of at most `strokeSampleLimit`
 *  samples each, each starting where the one before ended. Lists that are empty are left out. */
export function samplesInPieces(drawn: {
  x: readonly number[];
  y: readonly number[];
  time: readonly number[];
  force: readonly number[];
  altitude: readonly number[];
  azimuth: readonly number[];
}): StrokeSamples[] {
  const pieces: StrokeSamples[] = [];
  for (let start = 0; ; start += strokeSampleLimit - 1) {
    const end = Math.min(drawn.x.length, start + strokeSampleLimit);
    const piece = (values: readonly number[]) => values.slice(start, end);
    const reported = (name: "force" | "altitude" | "azimuth") =>
      drawn[name].length > 0 ? { [name]: piece(drawn[name]) } : {};
    pieces.push({
      x: piece(drawn.x),
      y: piece(drawn.y),
      time: piece(drawn.time),
      ...reported("force"),
      ...reported("altitude"),
      ...reported("azimuth"),
    });
    if (end >= drawn.x.length) return pieces;
  }
}

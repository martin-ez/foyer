import {
  create,
  fromBinary,
  fromJson,
  type JsonObject,
  toBinary,
  toJson,
} from "@bufbuild/protobuf";
import { timestampDate, timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  type Input,
  SamplesSchema,
  type Stroke,
  StrokeSchema,
  type Tool,
} from "./gen/foyer/ink/v1/ink_pb";
import { strokeProblem } from "./ink";

/** A stroke recorded as a test fixture, as `StrokeAdd` would add it again: its brush, when the pen
 *  touched down, and its samples, encoded as the device that drew it encoded them. */
export type FixtureStroke = {
  drawnAt: number;
  input: Input;
  tool: Tool;
  colour: number;
  size: number;
  samples: Uint8Array;
};

/** Writes strokes as a fixture: each stroke in its Protocol Buffers JSON form, without its id, page
 *  and member, and with its samples as the `Samples` message's JSON form, so a diff shows them. */
export function strokeFixtureOf(strokes: readonly Stroke[]): JsonObject[] {
  return strokes.map((stroke) => {
    const { drawnAt, input, tool, colour, size } = toJson(StrokeSchema, stroke, {
      alwaysEmitImplicit: true,
    }) as JsonObject;
    const samples = toJson(SamplesSchema, fromBinary(SamplesSchema, stroke.samples));
    return { drawnAt, input, tool, colour, size, samples } as JsonObject;
  });
}

/** Reads a fixture that `strokeFixtureOf` wrote. Throws when it holds a stroke that can't be
 *  added, as `strokeProblem` says. */
export function readStrokeFixture(fixture: unknown): FixtureStroke[] {
  if (!Array.isArray(fixture)) throw new Error("A stroke fixture must be a list of strokes.");
  return fixture.map((json: JsonObject, index) => {
    const { samples, ...rest } = json;
    const brush = fromJson(StrokeSchema, rest);
    const stroke = {
      drawnAt: brush.drawnAt ? timestampDate(brush.drawnAt).getTime() : 0,
      input: brush.input,
      tool: brush.tool,
      colour: brush.colour,
      size: brush.size,
      samples: toBinary(SamplesSchema, fromJson(SamplesSchema, samples ?? {})),
    };
    const problem = strokeProblem(stroke);
    if (problem) throw new Error(`Stroke ${index + 1} of the fixture can't be added: ${problem}`);
    return stroke;
  });
}

/** When to say each of a fixture's strokes was drawn, if the last was drawn `at`, keeping the time
 *  between them as it was recorded. */
export function redrawnAt(strokes: readonly FixtureStroke[], at: number): number[] {
  const last = Math.max(...strokes.map(({ drawnAt }) => drawnAt));
  return strokes.map(({ drawnAt }) => at - (last - drawnAt));
}

/** The stroke a fixture holds, as a household's `Stroke` with the given id, page and member. */
export function fixtureStrokeAsStroke(
  stroke: FixtureStroke,
  ids: { id: string; pageId: string; drawnBy: string },
): Stroke {
  return create(StrokeSchema, {
    ...ids,
    drawnAt: timestampFromDate(new Date(stroke.drawnAt)),
    input: stroke.input,
    tool: stroke.tool,
    colour: stroke.colour,
    size: stroke.size,
    samples: stroke.samples,
  });
}

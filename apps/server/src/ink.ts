import { timestampMs } from "@bufbuild/protobuf/wkt";
import { isId, strokeProblem } from "@foyer/shared";
import {
  Input,
  type StrokeAdd,
  type StrokeErase,
  Tool,
} from "@foyer/shared/gen/foyer/ink/v1/ink_pb";
import type { Row } from "@foyer/shared/gen/foyer/sync/v1/sync_pb";
import type { Applied, Setter } from "./changes";
import { canSeePage } from "./pages";
import { latestSeq, nextSeq, pullReplyRowLimit, type RowKey, strokesOnPageBetween } from "./rows";

const inputs: Partial<Record<Input, string>> = {
  [Input.PENCIL]: "pencil",
  [Input.FINGER]: "finger",
  [Input.MOUSE]: "mouse",
  [Input.STYLUS]: "stylus",
};

const tools: Partial<Record<Tool, string>> = {
  [Tool.PEN]: "pen",
  [Tool.MONOLINE]: "monoline",
};

/** The most strokes one erase can name. */
export const eraseLimit = 1_000;

/** How much a reply to a page's pull holds at most, unless one change alone changed more: strokes,
 *  and bytes of their samples. */
export const inkReplyLimits = { strokes: pullReplyRowLimit, bytes: 512 * 1024 };

/** A page's strokes added or erased after a cursor, oldest change first, if the member sees the
 *  page. The strokes one change changed always come together. */
export function pullInk(
  sql: SqlStorage,
  memberId: string,
  pageId: string,
  cursor: number,
  limits = inkReplyLimits,
): { rows: Row[]; cursor: number; done: boolean } {
  const latest = latestSeq(sql);
  if (!canSeePage(sql, memberId, pageId)) return { rows: [], cursor: latest, done: true };
  const changed = sql
    .exec<{ seq: number; bytes: number }>(
      `SELECT seq, coalesce(length(samples), 0) AS bytes FROM strokes
       WHERE page_id = ? AND seq > ? ORDER BY seq LIMIT ?`,
      pageId,
      cursor,
      limits.strokes + 1,
    )
    .toArray();
  const reply = (upTo: number, done: boolean) => ({
    rows: strokesOnPageBetween(sql, pageId, cursor, upTo),
    cursor: upTo,
    done,
  });
  const first = changed[0];
  if (!first) return reply(latest, true);
  let bytes = 0;
  for (const [index, stroke] of changed.entries()) {
    const full = index >= limits.strokes || bytes + stroke.bytes > limits.bytes;
    if (full && stroke.seq !== first.seq) return reply(stroke.seq - 1, false);
    bytes += stroke.bytes;
  }
  const after = sql
    .exec("SELECT 1 FROM strokes WHERE page_id = ? AND seq > ? LIMIT 1", pageId, first.seq)
    .toArray();
  return changed.length > limits.strokes && after.length > 0
    ? reply(first.seq, false)
    : reply(latest, true);
}

/** Adds a stroke to a page the member sees, which has been created. It stacks by when the pen
 *  touched down, by the device's clock but no later than the change was made. */
export function addStroke(
  sql: SqlStorage,
  memberId: string,
  setter: Setter,
  stroke: StrokeAdd,
): Applied {
  if (!isId(stroke.strokeId)) return { refused: "A stroke's id must be a UUID version 7." };
  if (sql.exec("SELECT 1 FROM strokes WHERE id = ?", stroke.strokeId).toArray().length > 0) {
    return { refused: "A stroke with this id already exists." };
  }
  const page = sql.exec("SELECT 1 FROM pages WHERE id = ?", stroke.pageId).toArray();
  if (page.length === 0 || !canSeePage(sql, memberId, stroke.pageId)) {
    return { refused: "There's no such page." };
  }
  if (!stroke.drawnAt) return { refused: "A stroke must say when it was drawn." };
  const problem = strokeProblem(stroke);
  if (problem) return { refused: problem };

  const seq = nextSeq(sql);
  sql.exec(
    `INSERT INTO strokes (id, page_id, drawn_at, drawn_by, input, tool, colour, size, samples, seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    stroke.strokeId,
    stroke.pageId,
    Math.min(timestampMs(stroke.drawnAt), setter.at),
    memberId,
    inputs[stroke.input],
    tools[stroke.tool],
    stroke.colour,
    stroke.size,
    stroke.samples.slice().buffer,
    seq,
  );
  return { seq, changed: [{ kind: "stroke", id: stroke.strokeId }], unchanged: [] };
}

/** Erases strokes on pages the member sees, dropping their samples but keeping their rows, so
 *  that a page's pull finds them erased. Strokes already erased stay as they are. */
export function eraseStrokes(sql: SqlStorage, memberId: string, erase: StrokeErase): Applied {
  const ids = [...new Set(erase.strokeIds)];
  if (ids.length === 0) return { refused: "An erase must name at least one stroke." };
  if (ids.length > eraseLimit) {
    return { refused: `An erase can name at most ${eraseLimit.toLocaleString("en")} strokes.` };
  }
  const strokes = ids.flatMap((id) =>
    sql
      .exec<{ id: string; page_id: string; erased: number }>(
        "SELECT id, page_id, samples IS NULL AS erased FROM strokes WHERE id = ?",
        id,
      )
      .toArray(),
  );
  const seen = strokes.filter(({ page_id }) => canSeePage(sql, memberId, page_id));
  if (seen.length < ids.length) return { refused: "There's no such stroke." };

  const key = ({ id }: { id: string }): RowKey => ({ kind: "stroke", id });
  const toErase = seen.filter(({ erased }) => erased === 0);
  const seq = nextSeq(sql);
  for (const { id } of toErase) {
    sql.exec("UPDATE strokes SET samples = NULL, seq = ? WHERE id = ?", seq, id);
  }
  return {
    seq,
    changed: toErase.map(key),
    unchanged: seen.filter(({ erased }) => erased === 1).map(key),
  };
}

/** Deletes the ink on an item's pages, as when the item is deleted with them. */
export function deleteInkOnPagesOf(sql: SqlStorage, itemId: string): void {
  sql.exec("DELETE FROM strokes WHERE page_id IN (SELECT id FROM pages WHERE item_id = ?)", itemId);
}

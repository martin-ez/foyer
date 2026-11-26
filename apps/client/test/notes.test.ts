import { create } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import { ItemKind, ItemSchema } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import { describe, expect, it } from "vitest";
import { recentNotes } from "../src/notebook/notes";

function item(id: string, kind: ItemKind, writtenAt: string) {
  return create(ItemSchema, {
    id,
    kind,
    title: id,
    createdAt: timestampFromMs(Date.parse(writtenAt)),
  });
}

describe("recentNotes", () => {
  it("lists the notes written most recently, newest first, up to the count", () => {
    const items = [
      item("Recipes", ItemKind.NOTE, "2026-11-01T10:00:00Z"),
      item("Packing list", ItemKind.NOTE, "2026-11-20T10:00:00Z"),
      item("Buy milk", ItemKind.TASK, "2026-11-25T10:00:00Z"),
      item("Dentist", ItemKind.EVENT, "2026-11-24T10:00:00Z"),
      item("Gift ideas", ItemKind.NOTE, "2026-11-10T10:00:00Z"),
    ];

    expect(recentNotes(items, 2).map(({ title }) => title)).toEqual(["Packing list", "Gift ideas"]);
  });

  it("lists notes written at the same moment by id, newest first", () => {
    const items = [
      item("019a8f4e-0001", ItemKind.NOTE, "2026-11-20T10:00:00Z"),
      item("019a8f4e-0002", ItemKind.NOTE, "2026-11-20T10:00:00Z"),
    ];

    expect(recentNotes(items, 5).map(({ id }) => id)).toEqual(["019a8f4e-0002", "019a8f4e-0001"]);
  });
});

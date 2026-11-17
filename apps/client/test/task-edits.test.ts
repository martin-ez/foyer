import { parseRepeat } from "@foyer/shared";
import { RepeatFrom } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import { describe, expect, it } from "vitest";
import { changedFields, shownFields, shownRepeat } from "../src/tasks/task-edits";

const fields = { title: "Buy milk", description: "From the corner shop", date: "2026-11-17" };
const task = { ...fields, repeat: "", repeatFrom: RepeatFrom.UNSPECIFIED };
const weekly = parseRepeat("FREQ=WEEKLY;BYDAY=TU");
const repeatingTask = { ...task, repeat: "FREQ=WEEKLY;BYDAY=TU", repeatFrom: RepeatFrom.SCHEDULE };

describe("shownFields", () => {
  it("shows the task as it is now in every field the member hasn't edited", () => {
    expect(shownFields(task, {})).toEqual(fields);
  });

  it("shows what the member typed in the fields they edited, even when the task changed since", () => {
    const renamedElsewhere = { ...task, title: "Buy oat milk", date: "2026-11-18" };

    expect(shownFields(renamedElsewhere, { title: "Buy milk and bread" })).toEqual({
      title: "Buy milk and bread",
      description: "From the corner shop",
      date: "2026-11-18",
    });
  });
});

describe("changedFields", () => {
  it("leaves out the fields the member didn't edit, however the task changed since", () => {
    const renamedElsewhere = { ...task, title: "Buy oat milk" };

    expect(changedFields(renamedElsewhere, { date: "2026-11-20" })).toEqual({ date: "2026-11-20" });
  });

  it("leaves out an edited field that matches the task as it is now", () => {
    expect(
      changedFields(task, { title: " Buy milk ", description: "From the corner shop" }),
    ).toEqual({});
  });

  it("saves an edited field over a change made elsewhere, with the title trimmed", () => {
    const renamedElsewhere = { ...task, title: "Buy oat milk" };

    expect(
      changedFields(renamedElsewhere, { title: " Buy milk and bread ", description: "" }),
    ).toEqual({ title: "Buy milk and bread", description: "" });
  });

  it("saves a new way of repeating, and leaves out one that matches how the task repeats now", () => {
    const repeat = { rule: weekly, from: "completion" as const };

    expect(changedFields(repeatingTask, { repeat })).toEqual({ repeat });
    expect(changedFields(repeatingTask, { repeat: { rule: weekly, from: "schedule" } })).toEqual(
      {},
    );
    expect(changedFields(task, { repeat: { rule: null, from: "completion" } })).toEqual({});
  });

  it("saves stopping a task repeating", () => {
    const repeat = { rule: null, from: "schedule" as const };

    expect(changedFields(repeatingTask, { repeat })).toEqual({ repeat });
  });
});

describe("shownRepeat", () => {
  it("shows how the task repeats now until the member chooses otherwise", () => {
    expect(shownRepeat(repeatingTask, {})).toEqual({ rule: weekly, from: "schedule" });
    expect(shownRepeat(repeatingTask, { repeat: { rule: null, from: "schedule" } })).toEqual({
      rule: null,
      from: "schedule",
    });
  });
});

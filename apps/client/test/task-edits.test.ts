import { describe, expect, it } from "vitest";
import { changedFields, shownFields } from "../src/tasks/task-edits";

const task = { title: "Buy milk", description: "From the corner shop", date: "2026-11-17" };

describe("shownFields", () => {
  it("shows the task as it is now in every field the member hasn't edited", () => {
    expect(shownFields(task, {})).toEqual(task);
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
});

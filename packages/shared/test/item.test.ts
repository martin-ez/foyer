import { itemTitleLimit, itemTitleProblem, limitItemTitle } from "@foyer/shared";
import { describe, expect, it } from "vitest";

describe("itemTitleProblem", () => {
  it("refuses a blank title", () => {
    expect(itemTitleProblem("")).toBe("A task's title can't be blank.");
  });

  it("refuses a title over the limit, counting characters as code points", () => {
    expect(itemTitleLimit).toBe(500);
    expect(itemTitleProblem("a".repeat(501))).toBe(
      "A task's title can't be longer than 500 characters.",
    );
    expect(itemTitleProblem(`${"a".repeat(499)}🧺`)).toBe(null);
  });
});

describe("limitItemTitle", () => {
  it("keeps a title within the limit as it is", () => {
    expect(limitItemTitle("Buy milk")).toBe("Buy milk");
  });

  it("cuts a longer title to the limit without splitting a character", () => {
    expect(limitItemTitle(`${"a".repeat(499)}🧺🧺`)).toBe(`${"a".repeat(499)}🧺`);
  });
});

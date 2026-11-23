import {
  clashingName,
  freeSpaceName,
  limitSpaceName,
  nameClashProblem,
  spaceNameLimit,
  spaceNameProblem,
} from "@foyer/shared";
import { describe, expect, it } from "vitest";

describe("spaceNameProblem", () => {
  it("refuses a blank name", () => {
    expect(spaceNameProblem("")).toBe("A space's name can't be blank.");
  });

  it("refuses a name over the limit, counting characters as code points", () => {
    expect(spaceNameLimit).toBe(120);
    expect(spaceNameProblem("a".repeat(121))).toBe(
      "A space's name can't be longer than 120 characters.",
    );
    expect(spaceNameProblem(`${"a".repeat(119)}🏡`)).toBe(null);
  });
});

describe("clashingName", () => {
  it("finds a name that's the same, ignoring case", () => {
    expect(clashingName("home", ["Garden", "Home"])).toBe("Home");
  });

  it("finds nothing when every name differs", () => {
    expect(clashingName("Home", ["Garden", "Homes"])).toBe(undefined);
  });
});

describe("nameClashProblem", () => {
  it("names another space that has the name, ignoring case", () => {
    expect(nameClashProblem("home", [{ name: "Home", archived: false }])).toBe(
      "Another space you see is called “Home”.",
    );
  });

  it("says when the space that has it is archived, unless another that has it isn't", () => {
    const archivedHome = { name: "Home", archived: true };
    expect(nameClashProblem("home", [archivedHome])).toBe("An archived space is called “Home”.");
    expect(nameClashProblem("home", [archivedHome, { name: "HOME", archived: false }])).toBe(
      "Another space you see is called “HOME”.",
    );
  });

  it("finds nothing when no other space has the name", () => {
    expect(nameClashProblem("Home", [{ name: "Homes", archived: true }])).toBe(null);
  });
});

describe("freeSpaceName", () => {
  it("keeps a name nobody has", () => {
    expect(freeSpaceName("Home", ["Garden"])).toBe("Home");
  });

  it("adds the first free number, ignoring case", () => {
    expect(freeSpaceName("groceries", ["Groceries"])).toBe("groceries 2");
    expect(freeSpaceName("Groceries", ["Groceries", "GROCERIES 2"])).toBe("Groceries 3");
  });

  it("shortens a name before its number to stay within the limit", () => {
    const name = "a".repeat(120);

    expect(freeSpaceName(name, [name])).toBe(`${"a".repeat(118)} 2`);
  });

  it("drops spaces left at the end of a shortened name", () => {
    const name = `${"a".repeat(117)} bc`;

    expect(freeSpaceName(name, [name])).toBe(`${"a".repeat(117)} 2`);
  });
});

describe("limitSpaceName", () => {
  it("keeps the first 120 characters, counted as code points", () => {
    const emoji = "🏡".repeat(121);

    expect(limitSpaceName(emoji)).toBe("🏡".repeat(120));
    expect(limitSpaceName("Home")).toBe("Home");
  });

  it("keeps the first characters up to a limit it's given", () => {
    expect(limitSpaceName("Groceries", 6)).toBe("Grocer");
  });
});

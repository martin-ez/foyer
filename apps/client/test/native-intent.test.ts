import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { handleDevLink } from "../src/shell/dev-links";

let redirectSystemPath: typeof import("../src/app/+native-intent").redirectSystemPath;

beforeAll(async () => {
  Object.assign(globalThis, { __DEV__: true });
  ({ redirectSystemPath } = await import("../src/app/+native-intent"));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("redirectSystemPath", () => {
  it("opens the route a link names", () => {
    expect(redirectSystemPath({ path: "/tasks", initial: false })).toBe("/tasks");
    expect(redirectSystemPath({ path: "foyer://signed-in?code=abc", initial: true })).toBe(
      "foyer://signed-in?code=abc",
    );
  });

  it("follows a development link where the app is, or on its first page when it opens", () => {
    const fixtures: (string | null)[] = [];
    const stop = handleDevLink("add-strokes", (params) => fixtures.push(params.get("fixture")));

    const whileOpen = redirectSystemPath({
      path: "foyer://dev/add-strokes?fixture=tiny-dot",
      initial: false,
    });
    const opening = redirectSystemPath({
      path: "foyer://dev/add-strokes?fixture=fast-flick",
      initial: true,
    });
    stop();

    expect(whileOpen).toBeNull();
    expect(opening).toBe("/");
    expect(fixtures).toEqual(["tiny-dot", "fast-flick"]);
  });

  it("stays where the app is when following a development link fails", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const stop = handleDevLink("add-strokes", () => {
      throw new Error("No page is open.");
    });

    const followed = redirectSystemPath({
      path: "foyer://dev/add-strokes?fixture=tiny-dot",
      initial: false,
    });
    stop();

    expect(followed).toBeNull();
  });
});

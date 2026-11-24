import { describe, expect, it, vi } from "vitest";
import { followDevLink, handleDevLink } from "../src/shell/dev-links";

describe("followDevLink", () => {
  it("hands a development link's parameters to what handles it", () => {
    const handler = vi.fn();
    const stop = handleDevLink("add-strokes", handler);

    const followed = followDevLink("foyer://dev/add-strokes?fixture=circle-and-scribble");
    stop();

    expect(followed).toBe(true);
    expect(handler.mock.calls[0]?.[0].get("fixture")).toBe("circle-and-scribble");
  });

  it("follows the link given as a path too", () => {
    const handler = vi.fn();
    const stop = handleDevLink("sign-in", handler);

    expect(followDevLink("/dev/sign-in?code=abc")).toBe(true);
    expect(followDevLink("dev/sign-in?code=def")).toBe(true);
    stop();

    expect(handler.mock.calls.map(([params]) => params.get("code"))).toEqual(["abc", "def"]);
  });

  it("keeps a link that comes first until something handles it", () => {
    expect(followDevLink("foyer://dev/sign-in?code=early")).toBe(true);
    const handler = vi.fn();

    const stop = handleDevLink("sign-in", handler);
    stop();

    expect(handler.mock.calls[0]?.[0].get("code")).toBe("early");
  });

  it("leaves every other link to the app's routes", () => {
    const handler = vi.fn();
    const stop = handleDevLink("add-strokes", handler);

    expect(followDevLink("foyer://signed-in?code=abc")).toBe(false);
    expect(followDevLink("/tasks")).toBe(false);
    expect(followDevLink("foyer://dev/unknown")).toBe(false);
    stop();

    expect(handler).not.toHaveBeenCalled();
  });

  it("stops handing links over once handling stops", () => {
    const handler = vi.fn();
    handleDevLink("add-strokes", handler)();

    followDevLink("foyer://dev/add-strokes?fixture=dot");
    handleDevLink("add-strokes", () => {})();

    expect(handler).not.toHaveBeenCalled();
  });
});

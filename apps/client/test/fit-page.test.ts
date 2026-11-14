import { describe, expect, it } from "vitest";
import { fitPage, placeholderPageAspectRatio } from "../src/page/fit-page";

describe("fitPage", () => {
  it("fills the height of a wide space", () => {
    expect(fitPage(1000, 400)).toEqual({ width: 400 * placeholderPageAspectRatio, height: 400 });
  });

  it("fills the width of a tall space", () => {
    expect(fitPage(300, 1000)).toEqual({ width: 300, height: 300 / placeholderPageAspectRatio });
  });

  it("fills a space of the page's own shape exactly", () => {
    expect(fitPage(600, 600 / placeholderPageAspectRatio)).toEqual({
      width: 600,
      height: 600 / placeholderPageAspectRatio,
    });
  });

  it("is empty when there is no room", () => {
    expect(fitPage(0, 500)).toEqual({ width: 0, height: 0 });
    expect(fitPage(500, -10)).toEqual({ width: 0, height: 0 });
  });
});

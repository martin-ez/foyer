import { a2Landscape, a4Portrait } from "@foyer/shared";
import { describe, expect, it } from "vitest";
import {
  deskMargin,
  fittedCamera,
  largestScale,
  panCamera,
  pointOnPage,
  resizeCamera,
  zoomCamera,
  zoomLimits,
} from "../src/page/sheet-camera";

const page = { width: 600, height: 800 };
const view = { width: 1000, height: 848 };
const fit = (848 - deskMargin * 2) / 800;

describe("fitting a page to the desk", () => {
  it("shows the whole page as large as fits inside the margin, in the middle", () => {
    expect(fittedCamera(view, page)).toEqual({
      x: (1000 - 600 * fit) / 2,
      y: deskMargin,
      scale: fit,
    });
  });

  it("fits a wide page by its width", () => {
    const camera = fittedCamera({ width: 1000, height: 1000 }, a2Landscape);

    expect(a2Landscape.width * camera.scale).toBeCloseTo(1000 - deskMargin * 2);
    expect(camera.x).toBeCloseTo(deskMargin);
  });

  it("shows nothing on a desk with no room", () => {
    expect(fittedCamera({ width: 0, height: 0 }, a4Portrait).scale).toBe(0);
  });
});

describe("zooming", () => {
  it("zooms from fitting the desk to four times the page's size", () => {
    expect(zoomLimits(view, page)).toEqual({ smallest: fit, largest: largestScale });
  });

  it("keeps the point under the fingers over the same point of the page", () => {
    const camera = fittedCamera(view, page);
    const focus = { x: 400, y: 300 };
    const onPage = (c: typeof camera) => ({
      x: (focus.x - c.x) / c.scale,
      y: (focus.y - c.y) / c.scale,
    });

    const zoomed = zoomCamera(camera, view, page, 2, focus);

    expect(zoomed.scale).toBeCloseTo(fit * 2);
    expect(onPage(zoomed).x).toBeCloseTo(onPage(camera).x);
    expect(onPage(zoomed).y).toBeCloseTo(onPage(camera).y);
  });

  it("moves the page with the fingers while pinching", () => {
    const camera = zoomCamera(fittedCamera(view, page), view, page, 2, { x: 500, y: 424 });

    const pinched = zoomCamera(camera, view, page, 1, { x: 500, y: 424 }, { x: -30, y: 20 });

    expect(pinched).toEqual({ x: camera.x - 30, y: camera.y + 20, scale: camera.scale });
  });

  it("stops at the limits", () => {
    const camera = fittedCamera(view, page);
    const middle = { x: 500, y: 424 };

    expect(zoomCamera(camera, view, page, 100, middle).scale).toBe(largestScale);
    expect(zoomCamera(camera, view, page, 0.01, middle)).toEqual(camera);
  });
});

describe("moving the page", () => {
  it("moves a zoomed page", () => {
    const camera = zoomCamera(fittedCamera(view, page), view, page, 2, { x: 500, y: 424 });

    expect(panCamera(camera, view, page, { x: 10, y: -10 })).toEqual({
      ...camera,
      x: camera.x + 10,
      y: camera.y - 10,
    });
  });

  it("leaves at most a margin of desk at any edge", () => {
    const camera = zoomCamera(fittedCamera(view, page), view, page, 2, { x: 500, y: 424 });

    const pushed = panCamera(camera, view, page, { x: 5000, y: 5000 });
    const pulled = panCamera(camera, view, page, { x: -5000, y: -5000 });

    expect(pushed).toMatchObject({ x: deskMargin, y: deskMargin });
    expect(pulled.x + page.width * pulled.scale).toBeCloseTo(view.width - deskMargin);
    expect(pulled.y + page.height * pulled.scale).toBeCloseTo(view.height - deskMargin);
  });

  it("keeps a page that fits the desk in the middle", () => {
    const camera = fittedCamera(view, page);

    expect(panCamera(camera, view, page, { x: 50, y: 50 })).toEqual(camera);
  });
});

describe("resizing the desk", () => {
  it("keeps a fitted page fitted", () => {
    const larger = { width: 1400, height: 1048 };

    expect(resizeCamera(fittedCamera(view, page), view, larger, page)).toEqual(
      fittedCamera(larger, page),
    );
  });

  it("keeps a zoomed page's zoom", () => {
    const camera = zoomCamera(fittedCamera(view, page), view, page, 2, { x: 500, y: 424 });

    expect(resizeCamera(camera, view, { width: 900, height: 848 }, page).scale).toBe(camera.scale);
  });

  it("fits a page shown on a desk that had no room yet", () => {
    const camera = fittedCamera({ width: 0, height: 0 }, page);

    expect(resizeCamera(camera, { width: 0, height: 0 }, view, page)).toEqual(
      fittedCamera(view, page),
    );
  });
});

describe("pointing at the page", () => {
  it("finds the point of the page under a point on the screen", () => {
    const camera = { x: 100, y: 24, scale: 2 };

    expect(pointOnPage(camera, { x: 100, y: 24 })).toEqual({ x: 0, y: 0 });
    expect(pointOnPage(camera, { x: 300, y: 224 })).toEqual({ x: 100, y: 100 });
  });

  it("follows the page as it's zoomed, so the point under the focus stays the same", () => {
    const camera = fittedCamera(view, page);
    const focus = { x: 400, y: 300 };

    const zoomed = zoomCamera(camera, view, page, 2, focus);

    expect(pointOnPage(zoomed, focus).x).toBeCloseTo(pointOnPage(camera, focus).x);
    expect(pointOnPage(zoomed, focus).y).toBeCloseTo(pointOnPage(camera, focus).y);
  });
});

import type { PageSize } from "@foyer/shared";

/** A width and a height, in screen points. */
export type Size = { width: number; height: number };

/** A point on the screen, in screen points from the sheet's top-left corner. */
export type Point = { x: number; y: number };

/** Where a page lies on the desk: its top-left corner on the screen, and how many screen points one
 *  point of the page takes. */
export type Camera = { x: number; y: number; scale: number };

/** The space left around a page fitted to the desk, in screen points. */
export const deskMargin = 24;

/** The most a page can be zoomed in: one point of the page then takes this many screen points. */
export const largestScale = 4;

/** How far a page can be zoomed: from fitting the desk with a margin around it, to `largestScale`. */
export function zoomLimits(view: Size, page: PageSize): { smallest: number; largest: number } {
  const room = { width: view.width - deskMargin * 2, height: view.height - deskMargin * 2 };
  const fit = Math.max(0, Math.min(room.width / page.width, room.height / page.height));
  return { smallest: fit, largest: Math.max(largestScale, fit) };
}

/** The whole page, as large as fits the desk, in its middle. */
export function fittedCamera(view: Size, page: PageSize): Camera {
  return keepOnDesk({ x: 0, y: 0, scale: zoomLimits(view, page).smallest }, view, page);
}

/** How to move and scale a picture of the desk taken through the camera `from` so that it lies
 *  where the page does through the camera `to`. */
export function snapshotMove(from: Camera, to: Camera): Camera {
  const scale = from.scale > 0 ? to.scale / from.scale : 1;
  return { x: to.x - from.x * scale, y: to.y - from.y * scale, scale };
}

/** Zooms by `factor` around `focus`, which stays over the same point of the page, then moves the
 *  page by `pan`, as two fingers pinching and moving together do. */
export function zoomCamera(
  camera: Camera,
  view: Size,
  page: PageSize,
  factor: number,
  focus: Point,
  pan: Point = { x: 0, y: 0 },
): Camera {
  if (camera.scale <= 0) return camera;
  const { smallest, largest } = zoomLimits(view, page);
  const scale = Math.min(largest, Math.max(smallest, camera.scale * factor));
  const ratio = scale / camera.scale;
  const x = focus.x - (focus.x - camera.x) * ratio + pan.x;
  const y = focus.y - (focus.y - camera.y) * ratio + pan.y;
  return keepOnDesk({ x, y, scale }, view, page);
}

/** Moves the page by `by`, as far as it can go. */
export function panCamera(camera: Camera, view: Size, page: PageSize, by: Point): Camera {
  return keepOnDesk({ ...camera, x: camera.x + by.x, y: camera.y + by.y }, view, page);
}

/** The point of the page under a point on the screen, in points from the page's top-left corner. */
export function pointOnPage(camera: Camera, at: Point): Point {
  return { x: (at.x - camera.x) / camera.scale, y: (at.y - camera.y) / camera.scale };
}

/** Keeps the page in place when the desk changes size. A page fitted to the desk stays fitted, and
 *  a zoomed page keeps its zoom, within the new limits. */
export function resizeCamera(camera: Camera, from: Size, to: Size, page: PageSize): Camera {
  const wasFitted = Math.abs(camera.scale - zoomLimits(from, page).smallest) < 1e-9;
  if (wasFitted) return fittedCamera(to, page);
  const { smallest, largest } = zoomLimits(to, page);
  const scale = Math.min(largest, Math.max(smallest, camera.scale));
  return keepOnDesk({ ...camera, scale }, to, page);
}

function keepOnDesk(camera: Camera, view: Size, page: PageSize): Camera {
  const along = (position: number, viewLength: number, pageLength: number) => {
    const length = pageLength * camera.scale;
    if (length + deskMargin * 2 <= viewLength) return (viewLength - length) / 2;
    return Math.min(deskMargin, Math.max(viewLength - deskMargin - length, position));
  };
  return {
    x: along(camera.x, view.width, page.width),
    y: along(camera.y, view.height, page.height),
    scale: camera.scale,
  };
}

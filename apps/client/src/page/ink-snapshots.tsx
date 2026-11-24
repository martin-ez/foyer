import type { PageSize } from "@foyer/shared";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { PixelRatio } from "react-native";
import {
  drawAsPicture,
  FilterMode,
  Group,
  Image,
  MipmapMode,
  type SkImage,
  Skia,
  type SkPicture,
} from "react-native-skia";
import { type Camera, type Size, snapshotMove, zoomLimits } from "./sheet-camera";

const restingMs = 150;

const canvasCatchUpMs = 1000;

const longestPicture = 4096;

const smooth = { filter: FilterMode.Linear, mipmap: MipmapMode.None };

type Snapshot = { image: SkImage; camera: Camera; size: Size };

/** A page's ink, in a canvas the size of `view`, drawn from two pictures of it, so that moving and
 *  zooming the page moves pictures instead of drawing every stroke again: the whole page, and the
 *  view, sharp, once the page rests. A new `ink`, in the page's own points, is drawn again. */
export function InkSnapshots({
  ink,
  page,
  view,
  camera,
  held,
}: {
  ink: ReactNode;
  page: PageSize;
  view: Size;
  camera: Camera;
  /** Whether a finger or button is down on the page, which never rests while one is. */
  held: boolean;
}) {
  const picture = usePicture(ink, page);
  const resting = useResting(camera, view, held);
  const fit = zoomLimits(view, page).smallest;
  const whole = useSnapshot(picture, () => {
    const ratio = PixelRatio.get();
    const scale = Math.min(fit, longestPicture / ratio / Math.max(page.width, page.height));
    const size = { width: page.width * scale, height: page.height * scale };
    return { camera: { x: 0, y: 0, scale }, size };
  }, [fit, page.width, page.height]);
  const sharp = useSnapshot(picture, () => resting, [resting]);
  const sharpNow = sharp && sameCamera(sharp.camera, camera) && sameSize(sharp.size, view);
  const wholeShown = whole && !sharpNow ? <Placed snapshot={whole} camera={camera} /> : null;
  return (
    <>
      {sharp && wholeShown ? (
        <Group clip={placed(sharp, camera)} invertClip>
          {wholeShown}
        </Group>
      ) : (
        wholeShown
      )}
      {sharp ? <Placed snapshot={sharp} camera={camera} /> : null}
    </>
  );
}

function Placed({ snapshot, camera }: { snapshot: Snapshot; camera: Camera }) {
  return (
    <Image image={snapshot.image} sampling={smooth} fit="fill" {...placed(snapshot, camera)} />
  );
}

function placed({ camera: taken, size }: Snapshot, camera: Camera) {
  const { x, y, scale } = snapshotMove(taken, camera);
  return { x, y, width: size.width * scale, height: size.height * scale };
}

function usePicture(ink: ReactNode, page: PageSize): SkPicture | null {
  const [picture, setPicture] = useState<SkPicture | null>(null);
  useEffect(() => {
    let wanted = true;
    const bounds = { x: 0, y: 0, width: page.width, height: page.height };
    void drawAsPicture(<Group>{ink}</Group>, bounds).then((drawn) => {
      if (wanted) setPicture(drawn);
      else drawn.dispose();
    });
    return () => {
      wanted = false;
    };
  }, [ink, page.width, page.height]);
  useEffect(() => () => picture?.dispose(), [picture]);
  return picture;
}

function useResting(camera: Camera, view: Size, held: boolean): { camera: Camera; size: Size } {
  const [resting, setResting] = useState({ camera, size: view });
  const { x, y, scale } = camera;
  const { width, height } = view;
  useEffect(() => {
    if (held) return;
    const now = { camera: { x, y, scale }, size: { width, height } };
    const timer = setTimeout(
      () =>
        setResting((before) =>
          sameCamera(before.camera, now.camera) && sameSize(before.size, now.size) ? before : now,
        ),
      restingMs,
    );
    return () => clearTimeout(timer);
  }, [x, y, scale, width, height, held]);
  return resting;
}

function useSnapshot(
  picture: SkPicture | null,
  where: () => { camera: Camera; size: Size },
  dependencies: unknown[],
): Snapshot | null {
  // biome-ignore lint/correctness/useExhaustiveDependencies: `where` is read through `dependencies`.
  const snapshot = useMemo(
    () => (picture ? takeSnapshot(picture, where()) : null),
    [picture, ...dependencies],
  );
  useEffect(
    () => () => {
      if (snapshot) setTimeout(() => snapshot.image.dispose(), canvasCatchUpMs);
    },
    [snapshot],
  );
  return snapshot;
}

function takeSnapshot(
  picture: SkPicture,
  { camera, size }: { camera: Camera; size: Size },
): Snapshot | null {
  const ratio = PixelRatio.get();
  const width = Math.ceil(size.width * ratio);
  const height = Math.ceil(size.height * ratio);
  if (width <= 0 || height <= 0 || camera.scale <= 0) return null;
  const surface = Skia.Surface.MakeOffscreen(width, height);
  if (!surface) return null;
  const canvas = surface.getCanvas();
  canvas.scale(ratio, ratio);
  canvas.translate(camera.x, camera.y);
  canvas.scale(camera.scale, camera.scale);
  canvas.drawPicture(picture);
  surface.flush();
  const image = surface.makeImageSnapshot();
  surface.dispose();
  return { image, camera, size };
}

function sameCamera(a: Camera, b: Camera): boolean {
  return a.x === b.x && a.y === b.y && a.scale === b.scale;
}

function sameSize(a: Size, b: Size): boolean {
  return a.width === b.width && a.height === b.height;
}

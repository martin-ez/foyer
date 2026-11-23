import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { format } from "node:util";
import type { ReactNode } from "react";
import {
  AlphaType,
  ColorType,
  drawOffscreen,
  getSkiaExports,
  type ImageInfo,
  makeOffscreenSurface,
  type SkImage,
} from "react-native-skia/lib/commonjs/headless";
import { expect } from "vitest";

const goldenImagesDir = path.join(import.meta.dirname, "golden-images");
const failuresDir = path.join(goldenImagesDir, "failures");
const updateCommand = "pnpm update-golden-images";

/** Draws `element` on a canvas of the given size, on the CPU as the app's Skia would, and checks
 *  it pixel by pixel against `test/golden-images/<name>.png`, or saves it there with
 *  `UPDATE_GOLDEN_IMAGES` set. A drawing that throws or logs an error fails instead. */
export async function expectToMatchGoldenImage(
  name: string,
  element: ReactNode,
  size: { width: number; height: number },
) {
  const goldenPath = path.join(goldenImagesDir, `${name}.png`);
  const actualPath = path.join(failuresDir, `${name}.png`);
  const diffPath = path.join(failuresDir, `${name}.diff.png`);
  await rm(actualPath, { force: true });
  await rm(diffPath, { force: true });

  const actual = await drawOrFail(name, element, size);
  if (process.env.UPDATE_GOLDEN_IMAGES) {
    await mkdir(goldenImagesDir, { recursive: true });
    await writeFile(goldenPath, await actual.encodeToBytes());
    return;
  }

  const golden = await readGoldenImage(goldenPath);
  if (!golden) {
    expect.fail(`${name} has no golden image yet. Run \`${updateCommand}\` to save it.`);
  }

  const info = rgbaInfo(size);
  const sameSize = golden.width() === size.width && golden.height() === size.height;
  const diff = sameSize
    ? markChangesInRedOverFadedGolden(await readRgba(golden, info), await readRgba(actual, info))
    : null;
  if (diff?.count === 0) return;

  await mkdir(failuresDir, { recursive: true });
  await writeFile(actualPath, await actual.encodeToBytes());
  if (diff) await writeFile(diffPath, await encodeRgba(diff.pixels, info));
  const difference = diff
    ? `differs from its golden image in ${diff.count} of ${size.width * size.height} pixels`
    : `is ${size.width}×${size.height}, but its golden image is ${golden.width()}×${golden.height()}`;
  expect.fail(
    `${name} ${difference}. The drawing is in ${relative(actualPath)}` +
      (diff ? ` and the pixels that changed are red in ${relative(diffPath)}` : "") +
      `. If the change is intended, run \`${updateCommand}\` and commit the new golden image.`,
  );
}

async function drawOrFail(
  name: string,
  element: ReactNode,
  size: { width: number; height: number },
) {
  const errors: string[] = [];
  const logError = console.error;
  console.error = (...args: unknown[]) => errors.push(format(...args));
  let image: SkImage | null = null;
  try {
    image = await drawOffscreen(makeOffscreenSurface(size.width, size.height), element);
  } catch (error) {
    errors.push(format(error));
  } finally {
    console.error = logError;
  }
  if (!image || errors.length > 0) {
    expect.fail(
      `${name} couldn't be drawn, so it wasn't compared with its golden image or saved as one:\n\n` +
        errors.join("\n\n"),
    );
  }
  return image;
}

async function readGoldenImage(goldenPath: string) {
  const bytes = await readFile(goldenPath).catch(() => null);
  if (!bytes) return null;
  const { Skia } = getSkiaExports();
  return Skia.Image.MakeFromEncoded(Skia.Data.fromBytes(new Uint8Array(bytes)));
}

function rgbaInfo(size: { width: number; height: number }): ImageInfo {
  return { ...size, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul };
}

async function readRgba(image: SkImage, info: ImageInfo) {
  const pixels = await image.readPixels(0, 0, info);
  if (!(pixels instanceof Uint8Array)) throw new Error("Skia couldn't read the image's pixels.");
  return pixels;
}

function markChangesInRedOverFadedGolden(golden: Uint8Array, actual: Uint8Array) {
  const pixels = new Uint8Array(golden.length);
  let count = 0;
  for (let i = 0; i < golden.length; i += 4) {
    const same =
      golden[i] === actual[i] &&
      golden[i + 1] === actual[i + 1] &&
      golden[i + 2] === actual[i + 2] &&
      golden[i + 3] === actual[i + 3];
    if (!same) count++;
    const grey = ((golden[i] ?? 0) + (golden[i + 1] ?? 0) + (golden[i + 2] ?? 0)) / 3;
    const faded = Math.round(128 + grey / 2);
    pixels.set(same ? [faded, faded, faded, 255] : [255, 0, 0, 255], i);
  }
  return { pixels, count };
}

async function encodeRgba(pixels: Uint8Array, info: ImageInfo) {
  const { Skia } = getSkiaExports();
  const image = Skia.Image.MakeRaster(info, Skia.Data.fromBytes(pixels), info.width * 4);
  if (!image) throw new Error("Skia couldn't make an image from the diff.");
  return image.encodeToBytes();
}

function relative(file: string) {
  return path.relative(process.cwd(), file);
}

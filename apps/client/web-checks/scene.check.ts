import { create } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import { a4Portrait, encodeSamples, type StrokeSamples, strokeFixtureOf } from "@foyer/shared";
import { Input, StrokeSchema, Tool } from "@foyer/shared/gen/foyer/ink/v1/ink_pb";
import { expect, type Page, test } from "@playwright/test";
import { expectOnAnotherDevice } from "./another-device";
import { line } from "./ink";
import { saveScreenshot } from "./screenshot";
import { addTask, bundleBuildTimeout, openSpaceOfItsOwn, sameMemberOnAnotherDevice } from "./tasks";

test.beforeEach(() => {
  test.setTimeout(bundleBuildTimeout + 60_000);
});

test("adds a stroke fixture to the open page, reads it back from the scene, and sends it to another device", async ({
  page,
}, testInfo) => {
  const fixture: unknown = strokeFixtureOf([
    stroke(circle({ x: 200, y: 300 }, 60, 80), Tool.PEN, 0x1a1a1a, 1.4, 0),
    stroke(line({ x: 300, y: 260 }, { x: 520, y: 340 }, 120), Tool.MONOLINE, 0x2255aa, 2, 1_800),
  ]);
  const space = await openSpaceOfItsOwn(page);
  await addTask(page);

  const added = await page.evaluate((json) => window.foyerTest?.addStrokes?.(json), fixture);
  const scene = await sceneOn(page);

  expect(scene?.page).toMatchObject({ kind: "space", ...a4Portrait });
  expect(scene?.stickers).toEqual([expect.objectContaining({ kind: "task", hidden: false })]);
  expect(scene?.strokes.map(({ id }) => id)).toEqual(added);
  expect(scene?.strokes).toEqual([
    expect.objectContaining({
      input: "pencil",
      brush: { tool: "pen", colour: 0x1a1a1a, size: expect.closeTo(1.4, 5) },
      bounds: expect.objectContaining({ x: 140, y: 240 }),
      samples: 80,
    }),
    expect.objectContaining({
      brush: { tool: "monoline", colour: 0x2255aa, size: 2 },
      bounds: { x: 300, y: 260, width: 220, height: 80 },
      samples: 120,
    }),
  ]);
  await expect(page.getByText(/not saved yet/)).toBeHidden();
  await saveScreenshot(page, testInfo, "stroke-fixture-added");

  const other = await sameMemberOnAnotherDevice(page, space);
  await expectOnAnotherDevice
    .poll(async () => (await sceneOn(other))?.strokes.map(({ id }) => id))
    .toEqual(added);
  await saveScreenshot(other, testInfo, "stroke-fixture-on-another-device");
});

function sceneOn(page: Page) {
  return page.evaluate(() => window.foyerTest?.scene?.());
}

function circle(centre: { x: number; y: number }, radius: number, count: number): StrokeSamples {
  const turns = Array.from({ length: count }, (_, index) => (index / count) * 2 * Math.PI);
  return {
    x: turns.map((turn) => centre.x + radius * Math.cos(turn)),
    y: turns.map((turn) => centre.y + radius * Math.sin(turn)),
    time: turns.map((_, index) => index * 8),
    force: turns.map((_, index) => 0.3 + 0.3 * Math.sin(index / 7) ** 2),
  };
}

function stroke(samples: StrokeSamples, tool: Tool, colour: number, size: number, after: number) {
  return create(StrokeSchema, {
    drawnAt: timestampFromMs(Date.UTC(2026, 10, 24, 10) + after),
    input: Input.PENCIL,
    tool,
    colour,
    size,
    samples: encodeSamples(samples),
  });
}

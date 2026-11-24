import { a4Portrait, decodeSamples, readStrokeFixture } from "@foyer/shared";
import { Tool } from "@foyer/shared/gen/foyer/ink/v1/ink_pb";
import { strokeFixtures } from "@foyer/shared/stroke-fixtures";
import { expect, type Page, test } from "@playwright/test";
import { expectOnAnotherDevice } from "./another-device";
import { saveScreenshot } from "./screenshot";
import { addTask, bundleBuildTimeout, openSpaceOfItsOwn, sameMemberOnAnotherDevice } from "./tasks";

const fixtureName = "circle-and-scribble";

test.beforeEach(() => {
  test.setTimeout(bundleBuildTimeout + 60_000);
});

test("adds a stroke fixture to the open page, reads it back from the scene, and sends it to another device", async ({
  page,
}, testInfo) => {
  const fixture = strokeFixtures[fixtureName];
  if (!fixture) throw new Error(`Record the "${fixtureName}" stroke fixture first.`);
  const recorded = readStrokeFixture(fixture);
  const space = await openSpaceOfItsOwn(page);
  await addTask(page);

  const added = await page.evaluate((json) => window.foyerTest?.addStrokes?.(json), fixture);
  const scene = await sceneOn(page);

  expect(scene?.page).toMatchObject({ kind: "space", ...a4Portrait });
  expect(scene?.stickers).toEqual([expect.objectContaining({ kind: "task", hidden: false })]);
  expect(scene?.strokes.map(({ id }) => id)).toEqual(added);
  expect(scene?.strokes.map(({ samples }) => samples)).toEqual(
    recorded.map(({ samples }) => decodeSamples(samples).x.length),
  );
  expect(scene?.strokes.map(({ brush }) => brush)).toEqual(
    recorded.map(({ tool, colour, size }) => ({
      tool: tool === Tool.MONOLINE ? "monoline" : "pen",
      colour,
      size: expect.closeTo(size, 5),
    })),
  );
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

import { fromBinary } from "@bufbuild/protobuf";
import { a4Portrait } from "@foyer/shared";
import {
  type DeviceMessage,
  DeviceMessageSchema,
  type HouseholdMessage,
  HouseholdMessageSchema,
} from "@foyer/shared/gen/foyer/sync/v1/sync_pb";
import { type Browser, expect, type Locator, type Page, test } from "@playwright/test";
import { type Camera, fittedCamera, pointOnPage } from "../src/page/sheet-camera";
import { expectOnAnotherDevice } from "./another-device";
import { describeDayOfMonth, openDayInMonth } from "./calendar-pages";
import { saveScreenshot } from "./screenshot";
import { housemate, member, signIn } from "./sign-in";

const bundleBuildTimeout = 120_000;

type Sent = DeviceMessage["message"];
type Received = HouseholdMessage["message"];

type Member = { page: Page; sent: Sent[]; received: Received[] };

type Point = { x: number; y: number };

type Box = { x: number; y: number; width: number; height: number };

type Sheet = { box: Box; camera: Camera };

const dayNoOtherCheckOpens = { months: 12, dayOfMonth: 15 };

test("shows who else is on the page and where they point, through the household", async ({
  browser,
}, testInfo) => {
  test.setTimeout(bundleBuildTimeout + 60_000);
  test.skip(
    testInfo.project.name !== "ipad",
    "Checked in one viewport, so that two runs don't share the household's page at once.",
  );
  const baseURL = testInfo.project.use.baseURL;

  const alex = await openAs(browser, baseURL, member);
  const { pageId, name: day } = await openDayNoOtherCheckOpens(alex);
  await expect.poll(() => lastHere(alex)).toEqual({ pageId, members: 0 });

  const sam = await openAs(browser, baseURL, housemate);
  await openDayNoOtherCheckOpens(sam);
  await expectOnAnotherDevice.poll(() => lastHere(alex)).toEqual({ pageId, members: 1 });
  await expect.poll(() => lastHere(sam)).toEqual({ pageId, members: 1 });
  const samsMarker = markerOf(alex.page, housemate);
  const alexsMarker = markerOf(sam.page, member);
  await expectOnAnotherDevice(samsMarker).toBeVisible();
  await expect(alexsMarker).toBeVisible();
  const waiting = await onPage(alex.page, day, await topLeftCorner(samsMarker));
  expect(waiting.x).toBeGreaterThanOrEqual(0);
  expect(waiting.x).toBeLessThan(a4Portrait.width / 2);
  expect(waiting.y).toBeGreaterThanOrEqual(0);
  expect(waiting.y).toBeLessThan(50);

  const stopRecording = await startRecordingPath(alex.page, housemate, day);
  const pointedAt = await pointAtMiddleOfPage(sam.page, day);
  await expect.poll(() => kinds(sam.sent)).toContain("point");
  await expectOnAnotherDevice.poll(() => kinds(alex.received)).toContain("pointed");
  await expectOnAnotherDevice
    .poll(async () => onPage(alex.page, day, await topLeftCorner(samsMarker)))
    .toEqual(nearly(pointedAt));
  const glided = await stopRecording();
  expect(between(glided, waiting, pointedAt)).not.toHaveLength(0);
  expect(glided.at(-1)).toEqual(nearly(pointedAt));
  await saveScreenshot(alex.page, testInfo, "presence-pointing");
  await saveScreenshot(sam.page, testInfo, "presence-waiting");

  const fitted = await sheetOf(alex.page, day);
  await zoomIn(alex.page, fitted);
  const zoomedMarker = await settled(samsMarker);
  expect(zoomedMarker).not.toEqual(nearly(toScreen(fitted, pointedAt)));
  await alex.page.mouse.move(zoomedMarker.x, zoomedMarker.y);
  await expect.poll(() => distance(lastPoint(alex), pointedAt)).toBeLessThan(1);
  await saveScreenshot(alex.page, testInfo, "presence-zoomed");

  await setHidden(sam.page, true);
  await expect.poll(() => kinds(sam.sent).at(-1)).toBe("leave");
  await expectOnAnotherDevice.poll(() => lastHere(alex)).toEqual({ pageId, members: 0 });
  await expectOnAnotherDevice(samsMarker).toHaveCount(0);

  const enteredBefore = entered(sam).length;
  await setHidden(sam.page, false);
  await expect.poll(() => entered(sam).slice(enteredBefore)).toEqual([pageId]);
  await expectOnAnotherDevice.poll(() => lastHere(alex)).toEqual({ pageId, members: 1 });
  await expectOnAnotherDevice(samsMarker).toBeVisible();

  await sam.page.getByRole("button", { name: "Next day" }).click();
  await expect(sam.page.getByRole("heading")).toHaveText(
    await describeDayOfMonth(
      sam.page,
      dayNoOtherCheckOpens.months,
      dayNoOtherCheckOpens.dayOfMonth + 1,
    ),
  );
  await expect.poll(() => entered(sam).length).toBe(enteredBefore + 2);
  await expectOnAnotherDevice.poll(() => lastHere(alex)).toEqual({ pageId, members: 0 });
  await expectOnAnotherDevice(samsMarker).toHaveCount(0);
  await expect(markerOf(sam.page, member)).toHaveCount(0);

  await sam.page.getByRole("button", { name: "Previous day" }).click();
  await expect(sam.page.getByRole("heading")).toHaveText(day);
  await expectOnAnotherDevice.poll(() => lastHere(alex)).toEqual({ pageId, members: 1 });
  await expectOnAnotherDevice(samsMarker).toBeVisible();

  await sam.page.getByRole("tab", { name: "Notebook" }).click();
  await expectOnAnotherDevice.poll(() => lastHere(alex)).toEqual({ pageId, members: 0 });
  await expectOnAnotherDevice(samsMarker).toHaveCount(0);
  await sam.page.getByRole("tab", { name: "Calendar" }).click();
  await expectOnAnotherDevice.poll(() => lastHere(alex)).toEqual({ pageId, members: 1 });
  await expectOnAnotherDevice(samsMarker).toBeVisible();
  await sam.page.context().close();
  await expectOnAnotherDevice.poll(() => lastHere(alex)).toEqual({ pageId, members: 0 });
  await expectOnAnotherDevice(samsMarker).toHaveCount(0);

  await alex.page.context().close();
});

async function openDayNoOtherCheckOpens(device: Member) {
  const { months, dayOfMonth } = dayNoOtherCheckOpens;
  const name = await openDayInMonth(device.page, months, dayOfMonth);
  await expect(device.page.getByRole("heading")).toHaveText(name);
  const pageId = await device.page.evaluate(
    ([ahead, of]) => {
      const now = new Date();
      const date = new Date(now.getFullYear(), now.getMonth() + ahead, of);
      const pad = (value: number) => String(value).padStart(2, "0");
      return `day:${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    },
    [months, dayOfMonth] as const,
  );
  await expect.poll(() => entered(device).at(-1)).toBe(pageId);
  return { pageId, name };
}

async function openAs(browser: Browser, baseURL: string | undefined, email: string) {
  const page = await (await browser.newContext({ baseURL })).newPage();
  const device: Member = { page, sent: [], received: [] };
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => {
      if (typeof payload !== "string")
        device.sent.push(fromBinary(DeviceMessageSchema, payload).message);
    });
    socket.on("framereceived", ({ payload }) => {
      if (typeof payload !== "string") {
        device.received.push(fromBinary(HouseholdMessageSchema, payload).message);
      }
    });
  });
  await signIn(page, email);
  await expect(page.getByText("Up to date")).toBeVisible({ timeout: bundleBuildTimeout });
  return device;
}

function kinds(messages: (Sent | Received)[]) {
  return messages.map(({ case: kind }) => kind);
}

function entered({ sent }: Member) {
  return sent.flatMap((message) => (message.case === "enter" ? [message.value.pageId] : []));
}

function lastHere({ received }: Member) {
  const here = received.findLast(({ case: kind }) => kind === "here");
  return here?.case === "here"
    ? { pageId: here.value.pageId, members: here.value.members.length }
    : null;
}

function markerOf(page: Page, email: string) {
  return page.getByLabel(`${email.split("@")[0]} is on this page`);
}

async function topLeftCorner(marker: Locator): Promise<Point> {
  const box = await marker.boundingBox();
  if (!box) throw new Error("The marker isn't shown");
  return { x: box.x, y: box.y };
}

async function sheetOf(page: Page, day: string): Promise<Sheet> {
  const box = await page.getByLabel(day).boundingBox();
  if (!box) throw new Error("The page isn't shown");
  return { box, camera: fittedCamera(box, a4Portrait) };
}

function toPage({ box, camera }: Sheet, at: Point): Point {
  return pointOnPage(camera, { x: at.x - box.x, y: at.y - box.y });
}

async function onPage(page: Page, day: string, at: Point): Promise<Point> {
  return toPage(await sheetOf(page, day), at);
}

function toScreen({ box, camera }: Sheet, { x, y }: Point): Point {
  return { x: box.x + camera.x + x * camera.scale, y: box.y + camera.y + y * camera.scale };
}

async function zoomIn(page: Page, { box }: Sheet) {
  await page.mouse.move(box.x + box.width / 3, box.y + box.height / 3);
  await page.keyboard.down("Control");
  for (let step = 0; step < 4; step++) await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
}

async function settled(marker: Locator): Promise<Point> {
  let before = await topLeftCorner(marker);
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const now = await topLeftCorner(marker);
    if (now.x === before.x && now.y === before.y) return now;
    before = now;
  }
}

function lastPoint({ sent }: Member): Point | null {
  const point = sent.findLast(({ case: kind }) => kind === "point");
  return point?.case === "point" ? { x: point.value.x, y: point.value.y } : null;
}

function distance(from: Point | null, to: Point): number {
  return from ? Math.hypot(from.x - to.x, from.y - to.y) : Number.POSITIVE_INFINITY;
}

async function pointAtMiddleOfPage(page: Page, day: string): Promise<Point> {
  const sheet = await sheetOf(page, day);
  const { box } = sheet;
  const end = { x: box.x + box.width / 2 + 20, y: box.y + box.height / 2 };
  await page.mouse.move(end.x - 40, end.y);
  await page.mouse.move(end.x, end.y, { steps: 5 });
  return toPage(sheet, end);
}

async function startRecordingPath(page: Page, email: string, day: string) {
  const markerLabel = `${email.split("@")[0]} is on this page`;
  const recording = await page.evaluateHandle(
    ([marker, sheet]) => {
      const recorded = { seen: [] as { at: Point; box: Box }[], stopped: false };
      const frame = () => {
        const at = document.querySelector(`[aria-label="${marker}"]`)?.getBoundingClientRect();
        const box = document.querySelector(`[aria-label="${sheet}"]`)?.getBoundingClientRect();
        if (at && box) {
          recorded.seen.push({
            at: { x: at.left, y: at.top },
            box: { x: box.left, y: box.top, width: box.width, height: box.height },
          });
        }
        if (!recorded.stopped) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      return recorded;
    },
    [markerLabel, day] as const,
  );
  return async (): Promise<Point[]> => {
    const frames = await recording.evaluate((recorded) => {
      recorded.stopped = true;
      return recorded.seen;
    });
    await recording.dispose();
    return frames.map(({ at, box }) => toPage({ box, camera: fittedCamera(box, a4Portrait) }, at));
  };
}

function between(path: Point[], from: Point, to: Point): Point[] {
  const inside = (value: number, a: number, b: number) =>
    value > Math.min(a, b) + 1 && value < Math.max(a, b) - 1;
  const distinct = new Map(path.map((point) => [`${point.x},${point.y}`, point]));
  return [...distinct.values()].filter(
    ({ x, y }) => inside(x, from.x, to.x) && inside(y, from.y, to.y),
  );
}

function nearly({ x, y }: Point) {
  return { x: expect.closeTo(x, 0), y: expect.closeTo(y, 0) };
}

function setHidden(page: Page, hidden: boolean) {
  return page.evaluate((isHidden) => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (isHidden ? "hidden" : "visible"),
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

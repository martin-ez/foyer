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
import { describeDayInBrowser } from "./pages";
import { saveScreenshot } from "./screenshot";
import { householdMembers, signIn } from "./sign-in";

const bundleBuildTimeout = 120_000;

type Sent = DeviceMessage["message"];
type Received = HouseholdMessage["message"];

type Member = { page: Page; sent: Sent[]; received: Received[] };

type Point = { x: number; y: number };

type Sheet = {
  box: { x: number; y: number; width: number; height: number };
  camera: Camera;
};

test("shows who else is on the page and where they point, through the household", async ({
  browser,
}, testInfo) => {
  test.setTimeout(bundleBuildTimeout + 60_000);
  test.skip(
    testInfo.project.name !== "ipad",
    "Checked in one viewport, so that two runs don't share the household's page at once.",
  );
  const [first, second] = householdMembers();
  test.skip(second === undefined, "Needs two emails in HOUSEHOLD_MEMBERS in .dev.vars.");
  if (first === undefined || second === undefined) return;
  const baseURL = testInfo.project.use.baseURL;

  const alex = await openAs(browser, baseURL, first);
  const today = await todaysPageId(alex.page);
  await expect.poll(() => entered(alex)).toEqual([today]);
  await expect.poll(() => lastHere(alex)).toEqual({ pageId: today, members: 0 });

  const sam = await openAs(browser, baseURL, second);
  await expect.poll(() => entered(sam)).toEqual([today]);
  await expect.poll(() => lastHere(alex)).toEqual({ pageId: today, members: 1 });
  await expect.poll(() => lastHere(sam)).toEqual({ pageId: today, members: 1 });
  const samsMarker = markerOf(alex.page, second);
  const alexsMarker = markerOf(sam.page, first);
  await expect(samsMarker).toBeVisible();
  await expect(alexsMarker).toBeVisible();
  const alexsSheet = await sheetOf(alex.page);
  const samsSheet = await sheetOf(sam.page);
  const waiting = await topLeftCorner(samsMarker);
  const waitingOnPage = toPage(alexsSheet, waiting);
  expect(waitingOnPage.x).toBeGreaterThanOrEqual(0);
  expect(waitingOnPage.x).toBeLessThan(a4Portrait.width / 2);
  expect(waitingOnPage.y).toBeGreaterThanOrEqual(0);
  expect(waitingOnPage.y).toBeLessThan(50);

  const path = recordPath(alex.page, second);
  const pointedAt = toPage(samsSheet, await pointAtMiddleOfPage(sam.page));
  await expect.poll(() => kinds(sam.sent)).toContain("point");
  await expect.poll(() => kinds(alex.received)).toContain("pointed");
  await expect
    .poll(async () => toPage(alexsSheet, await topLeftCorner(samsMarker)))
    .toEqual(nearly(pointedAt));
  const glided = await path;
  expect(between(glided, waiting, toScreen(alexsSheet, pointedAt)).length).toBeGreaterThan(3);
  await saveScreenshot(alex.page, testInfo, "presence-pointing");
  await saveScreenshot(sam.page, testInfo, "presence-waiting");

  await zoomIn(alex.page, alexsSheet);
  const zoomedMarker = await settled(samsMarker);
  expect(zoomedMarker).not.toEqual(nearly(toScreen(alexsSheet, pointedAt)));
  await alex.page.mouse.move(zoomedMarker.x, zoomedMarker.y);
  await expect.poll(() => distance(lastPoint(alex), pointedAt)).toBeLessThan(1);
  await saveScreenshot(alex.page, testInfo, "presence-zoomed");

  await setHidden(sam.page, true);
  await expect.poll(() => kinds(sam.sent).at(-1)).toBe("leave");
  await expect.poll(() => lastHere(alex)).toEqual({ pageId: today, members: 0 });
  await expect(samsMarker).toHaveCount(0);

  await setHidden(sam.page, false);
  await expect.poll(() => entered(sam)).toEqual([today, today]);
  await expect.poll(() => lastHere(alex)).toEqual({ pageId: today, members: 1 });
  await expect(samsMarker).toBeVisible();

  await sam.page.getByRole("button", { name: "Next day" }).click();
  await expect(sam.page.getByRole("heading")).toHaveText(await describeDayInBrowser(sam.page, 1));
  await expect.poll(() => entered(sam).length).toBe(3);
  await expect.poll(() => lastHere(alex)).toEqual({ pageId: today, members: 0 });
  await expect(samsMarker).toHaveCount(0);
  await expect(markerOf(sam.page, first)).toHaveCount(0);

  await sam.page.getByRole("button", { name: "Today" }).click();
  await expect.poll(() => lastHere(alex)).toEqual({ pageId: today, members: 1 });
  await expect(samsMarker).toBeVisible();

  await sam.page.getByRole("tab", { name: "Notebook" }).click();
  await expect.poll(() => lastHere(alex)).toEqual({ pageId: today, members: 0 });
  await expect(samsMarker).toHaveCount(0);
  await sam.page.getByRole("tab", { name: "Calendar" }).click();
  await expect.poll(() => lastHere(alex)).toEqual({ pageId: today, members: 1 });
  await expect(samsMarker).toBeVisible();
  await sam.page.context().close();
  await expect.poll(() => lastHere(alex)).toEqual({ pageId: today, members: 0 });
  await expect(samsMarker).toHaveCount(0);

  await alex.page.context().close();
});

async function openAs(browser: Browser, baseURL: string | undefined, email: string) {
  const page = await (await browser.newContext({ baseURL })).newPage();
  const member: Member = { page, sent: [], received: [] };
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => {
      if (typeof payload !== "string")
        member.sent.push(fromBinary(DeviceMessageSchema, payload).message);
    });
    socket.on("framereceived", ({ payload }) => {
      if (typeof payload !== "string") {
        member.received.push(fromBinary(HouseholdMessageSchema, payload).message);
      }
    });
  });
  await signIn(page, email);
  await expect(page.getByText("Up to date")).toBeVisible({ timeout: bundleBuildTimeout });
  return member;
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

function todaysPageId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, "0");
    return `day:${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  });
}

function markerOf(page: Page, email: string) {
  return page.getByLabel(`${email.split("@")[0]} is on this page`);
}

async function topLeftCorner(marker: Locator): Promise<Point> {
  const box = await marker.boundingBox();
  if (!box) throw new Error("The marker isn't shown");
  return { x: box.x, y: box.y };
}

async function sheetOf(page: Page): Promise<Sheet> {
  const box = await page.getByLabel(await describeDayInBrowser(page, 0)).boundingBox();
  if (!box) throw new Error("The page isn't shown");
  return { box, camera: fittedCamera(box, a4Portrait) };
}

function toPage({ box, camera }: Sheet, at: Point): Point {
  return pointOnPage(camera, { x: at.x - box.x, y: at.y - box.y });
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

async function pointAtMiddleOfPage(page: Page): Promise<Point> {
  const box = await page.getByLabel(await describeDayInBrowser(page, 0)).boundingBox();
  if (!box) throw new Error("The page isn't shown");
  const end = { x: box.x + box.width / 2 + 20, y: box.y + box.height / 2 };
  await page.mouse.move(end.x - 40, end.y);
  await page.mouse.move(end.x, end.y, { steps: 5 });
  return end;
}

function recordPath(page: Page, email: string): Promise<Point[]> {
  const label = `${email.split("@")[0]} is on this page`;
  return page.evaluate(
    (markerLabel) =>
      new Promise<Point[]>((resolve) => {
        const seen: Point[] = [];
        const start = performance.now();
        const frame = () => {
          const marker = document.querySelector(`[aria-label="${markerLabel}"]`);
          const box = marker?.getBoundingClientRect();
          if (box) seen.push({ x: box.left, y: box.top });
          if (performance.now() - start < 2000) requestAnimationFrame(frame);
          else resolve(seen);
        };
        requestAnimationFrame(frame);
      }),
    label,
  );
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

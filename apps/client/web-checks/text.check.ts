import {
  expect,
  type Locator,
  type Page,
  type TestInfo,
  test,
  type WebSocketRoute,
} from "@playwright/test";
import { expectOnAnotherDevice } from "./another-device";
import { openDayInWeek } from "./calendar-pages";
import { saveScreenshot } from "./screenshot";
import { housemate, signIn } from "./sign-in";
import {
  addTask,
  boxOf,
  bundleBuildTimeout,
  drag,
  openSpaceOfItsOwn,
  sameMemberOnAnotherDevice,
  stickerOf,
} from "./tasks";

test.beforeEach(() => {
  test.setTimeout(bundleBuildTimeout + 90_000);
});

function weeksNoOtherCheckUses(testInfo: TestInfo, which: number): number {
  return 11 + 2 * which + (testInfo.project.name === "ipad" ? 0 : 1);
}

async function openDay(page: Page, weeks: number, email?: string) {
  await signIn(page, email);
  await expect(page.getByText("Up to date")).toBeVisible({ timeout: bundleBuildTimeout });
  await page.getByRole("tab", { name: "Calendar" }).click();
  return openDayInWeek(page, weeks, 3);
}

function openPage(page: Page, name: string | RegExp): Locator {
  return page.getByLabel(name, { exact: typeof name === "string" }).last();
}

async function fittedA4PaperOf(sheet: Locator) {
  const desk = await boxOf(sheet);
  const page = { width: 595.28, height: 841.89 };
  const margin = 24;
  const scale = Math.min(
    (desk.width - 2 * margin) / page.width,
    (desk.height - 2 * margin) / page.height,
  );
  const width = page.width * scale;
  const height = page.height * scale;
  return {
    x: desk.x + (desk.width - width) / 2,
    y: desk.y + (desk.height - height) / 2,
    width,
    height,
  };
}

async function addTextAt(page: Page, sheet: Locator, across: number, down: number) {
  await page.getByRole("button", { name: "Add text" }).click();
  await expect(page.getByText("Tap the page where the text goes.")).toBeVisible();
  const paper = await fittedA4PaperOf(sheet);
  await page.mouse.click(paper.x + paper.width * across, paper.y + paper.height * down);
  await expect(page.getByRole("textbox", { name: "Text" })).toBeFocused();
}

function textGroupNamed(page: Page, text: string | RegExp): Locator {
  return page.getByRole("button", { name: text, exact: typeof text === "string" });
}

async function done(page: Page) {
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("button", { name: "Add text" })).toBeVisible();
  await expect(page.getByText(/not saved yet|Couldn't save/)).toBeHidden();
}

test("types headings, lists, bold and italic on a day page, and the household sees it", async ({
  page,
}, testInfo) => {
  const weeks = weeksNoOtherCheckUses(testInfo, 0);
  const day = await openDay(page, weeks);
  await addTextAt(page, openPage(page, day), 0.1, 0.12);

  await page.keyboard.type("# Saturday");
  await expect(page.getByRole("textbox", { name: "Heading 1" })).toHaveValue("Saturday");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Get **oat** milk, *not* dairy 🧺");
  await page.keyboard.press("Enter");
  await page.keyboard.type("- Bread");
  await expect(page.getByRole("textbox", { name: "Bulleted item" })).toHaveValue("Bread");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Sourdough");
  await page.getByRole("button", { name: "Indent" }).click();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Call the plumber");
  await page.getByRole("radio", { name: "Numbered item" }).click();
  await saveScreenshot(page, testInfo, "text-editing");
  await done(page);

  const written = "Saturday\nGet oat milk, not dairy 🧺\n• Bread\n• Sourdough\n1. Call the plumber";
  await expect(textGroupNamed(page, written)).toBeVisible();
  await saveScreenshot(page, testInfo, "text-on-day-page");
  const other = await page.context().browser()?.newContext(testInfo.project.use);
  if (!other) throw new Error("No other context");
  const theirs = await other.newPage();
  await openDay(theirs, weeks, housemate);
  await expectOnAnotherDevice(textGroupNamed(theirs, written)).toBeVisible();
  await saveScreenshot(theirs, testInfo, "text-on-another-device");
  await other.close();
});

test("moves, resizes, splits and joins text", async ({ page }, testInfo) => {
  const day = await openDay(page, weeksNoOtherCheckUses(testInfo, 1));
  const sheet = openPage(page, day);
  await addTextAt(page, sheet, 0.1, 0.1);
  await page.keyboard.type("Groceries");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Chores, a long line that wraps when the text is made narrow enough");
  await done(page);
  const whole = textGroupNamed(page, /^Groceries Chores/);

  const before = await boxOf(whole);
  const paper = await fittedA4PaperOf(sheet);
  await drag(page, whole, { x: paper.width * 0.05, y: paper.height * 0.15 });
  await expect
    .poll(async () => (await boxOf(whole)).y)
    .toBeGreaterThan(before.y + paper.height * 0.1);

  await whole.click();
  const handle = page.getByLabel("Width of the text");
  await drag(page, handle, { x: -before.width / 2, y: 0 });
  await done(page);
  await expect.poll(async () => (await boxOf(whole)).width).toBeLessThan(before.width * 0.75);
  await expect.poll(async () => (await boxOf(whole)).height).toBeGreaterThan(before.height);

  await whole.click();
  await page.getByRole("textbox", { name: "Text" }).last().click();
  await page.getByRole("button", { name: "Split here" }).click();
  await done(page);
  await expect(textGroupNamed(page, "Groceries")).toBeVisible();
  await expect(textGroupNamed(page, /^Chores/)).toBeVisible();
  await saveScreenshot(page, testInfo, "text-split");

  await textGroupNamed(page, "Groceries").click();
  await page.getByRole("button", { name: "Join the text below" }).click();
  await done(page);
  await expect(whole).toBeVisible();
  await expect(textGroupNamed(page, "Groceries")).toBeHidden();
});

test("writes on a task's body page, which the member's other devices show", async ({
  page,
}, testInfo) => {
  const space = await openSpaceOfItsOwn(page);
  const task = await addTask(page, `Trip ${Date.now()}`);
  await stickerOf(page, task).click();
  await addTextAt(page, openPage(page, task), 0.1, 0.4);
  await page.keyboard.type("## Pack");
  await page.keyboard.press("Enter");
  await page.keyboard.type("1. Passports");
  await done(page);
  await expect(textGroupNamed(page, "Pack\n1. Passports")).toBeVisible();
  await saveScreenshot(page, testInfo, "text-on-body-page");

  const other = await sameMemberOnAnotherDevice(page, space);
  await stickerOf(other, task).click();
  await expectOnAnotherDevice(textGroupNamed(other, "Pack\n1. Passports")).toBeVisible();
});

test("can't change text while offline", async ({ page }, testInfo) => {
  let online = true;
  let connection: WebSocketRoute | undefined;
  await page.routeWebSocket(/\/sync$/, (socket) => {
    if (!online) return socket.close();
    socket.connectToServer();
    connection = socket;
  });
  const day = await openDay(page, weeksNoOtherCheckUses(testInfo, 2));
  await addTextAt(page, openPage(page, day), 0.1, 0.2);
  await page.keyboard.type("Written while connected");

  online = false;
  await connection?.close();

  await expect(page.getByText("Text can't be changed while offline.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Text" })).toBeHidden();
  const written = textGroupNamed(page, "Written while connected");
  await expect(written).toBeDisabled();
  await expect(page.getByRole("button", { name: "Add text" })).toBeDisabled();
  await saveScreenshot(page, testInfo, "text-offline");

  online = true;

  await expect(page.getByText("Up to date")).toBeVisible({ timeout: 40_000 });
  await expect(written).toBeEnabled();
});

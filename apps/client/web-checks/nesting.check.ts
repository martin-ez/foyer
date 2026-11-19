import { expect, type Page, test } from "@playwright/test";
import { saveScreenshot } from "./screenshot";
import { addTask, bundleBuildTimeout, openSpaceOfItsOwn, pageTitle, stickerOf } from "./tasks";

let space = "";

test.beforeEach(async ({ page }) => {
  test.setTimeout(bundleBuildTimeout + 60_000);
  space = await openSpaceOfItsOwn(page);
});

async function addTaskUnder(page: Page, parent: string, title: string) {
  await stickerOf(page, parent).click();
  await page.getByLabel("New task under it").fill(title);
  await page.getByRole("button", { name: "Add under it" }).click();
  await expect(stickerOf(page, title)).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
}

function spaceListNames(page: Page) {
  return page.getByRole("list", { name: space }).getByRole("button").allTextContents();
}

test("puts a task under another and takes it out again, moving its sticker", async ({
  page,
}, testInfo) => {
  const party = await addTask(page, `Party ${Date.now()}`);
  const cake = await addTask(page, `Cake ${Date.now()}`);
  await stickerOf(page, cake).click();

  await page.getByLabel("Put it under another task").fill(party);
  await page.getByRole("button", { name: `Put under “${party}”` }).click();

  await expect(page.getByText(`Under “${party}”`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Show on its page" })).toBeHidden();
  await page.getByRole("button", { name: `Open “${party}”` }).click();
  await expect(pageTitle(page)).toHaveText(party);
  await expect(stickerOf(page, cake)).toBeVisible();
  await saveScreenshot(page, testInfo, "task-under-another");
  await page.getByRole("button", { name: "Close" }).click();
  await expect(stickerOf(page, party)).toBeVisible();
  await expect(stickerOf(page, cake)).toBeHidden();
  await stickerOf(page, party).click();

  await stickerOf(page, cake).click();
  await page.getByRole("button", { name: `Take it out of “${party}”` }).click();

  await expect(page.getByText(`Under “${party}”`)).toBeHidden();
  await page.getByRole("button", { name: "Show on its page" }).click();
  await expect(stickerOf(page, cake)).toBeVisible();
  await expect(page.getByText(/not saved yet|Couldn't save/)).toBeHidden();
});

test("lists the tasks under a task right after it", async ({ page }, testInfo) => {
  const party = await addTask(page, `Party ${Date.now()}`);
  const cake = `Cake ${Date.now()}`;
  await addTaskUnder(page, party, cake);

  await page.getByRole("button", { name: "List", exact: true }).click();

  const names = await spaceListNames(page);
  const at = names.findIndex((name) => name.startsWith(party));
  expect(names[at + 1]?.startsWith(cake)).toBe(true);
  await page
    .getByRole("list", { name: space })
    .getByRole("button", { name: cake })
    .scrollIntoViewIfNeeded();
  await saveScreenshot(page, testInfo, "nested-list");
});

test("asks before ticking a task with an open task under it", async ({ page }, testInfo) => {
  const party = await addTask(page, `Party ${Date.now()}`);
  const cake = `Cake ${Date.now()}`;
  await addTaskUnder(page, party, cake);
  const partyBox = page.getByRole("checkbox", { name: `Done: ${party}` });
  const question = page.getByRole("dialog", { name: "Tick the tasks under it?" });

  await partyBox.click();
  await expect(question).toContainText(`“${party}” has an open task under it.`);
  await saveScreenshot(page, testInfo, "tick-question");
  await question.getByRole("button", { name: "Cancel" }).click();

  await expect(question).toBeHidden();
  await expect(partyBox).not.toBeChecked();

  await partyBox.click();
  await question.getByRole("button", { name: "Only this task" }).click();

  await expect(partyBox).toBeChecked();
  await stickerOf(page, party).click();
  const cakeBox = page.getByRole("checkbox", { name: `Done: ${cake}` });
  await expect(cakeBox).not.toBeChecked();
  await page.getByRole("button", { name: "Close" }).click();
  await partyBox.click();
  await expect(partyBox).not.toBeChecked();

  await partyBox.click();
  await question.getByRole("button", { name: "Tick it too" }).click();

  await expect(partyBox).toBeChecked();
  await stickerOf(page, party).click();
  await expect(cakeBox).toBeChecked();
  await page.getByRole("button", { name: "Close" }).click();

  await partyBox.click();
  await expect(partyBox).not.toBeChecked();
  await page.getByRole("checkbox", { name: `Done: ${party}` }).click();
  await expect(question).toBeHidden();
  await expect(partyBox).toBeChecked();
});

async function deleteTaskWithItemsUnder(page: Page, title: string, answer: string) {
  await page.getByRole("button", { name: "Delete task" }).click();
  await expect(page.getByText("It has an item under it.")).toBeVisible();
  await page.getByRole("button", { name: answer }).click();
  await expect(pageTitle(page)).not.toHaveText(title);
}

test("moves the tasks under a deleted task to the top of its space", async ({ page }) => {
  const party = await addTask(page, `Party ${Date.now()}`);
  const cake = `Cake ${Date.now()}`;
  await addTaskUnder(page, party, cake);
  await stickerOf(page, party).click();

  await deleteTaskWithItemsUnder(page, party, `Move them to the top of ${space}`);

  await page.getByRole("button", { name: "List", exact: true }).click();
  const names = await spaceListNames(page);
  expect(names.some((name) => name.startsWith(cake))).toBe(true);
  expect(names.some((name) => name.startsWith(party))).toBe(false);
  await expect(page.getByText(/not saved yet|Couldn't save/)).toBeHidden();
});

test("moves the tasks under a deleted task up to its own parent", async ({ page }) => {
  const party = await addTask(page, `Party ${Date.now()}`);
  const food = `Food ${Date.now()}`;
  const cake = `Cake ${Date.now()}`;
  await addTaskUnder(page, party, food);
  await stickerOf(page, party).click();
  await addTaskUnder(page, food, cake);
  await stickerOf(page, party).click();
  await stickerOf(page, food).click();

  await deleteTaskWithItemsUnder(page, food, `Move them up to “${party}”`);

  await stickerOf(page, party).click();
  await expect(stickerOf(page, cake)).toBeVisible();
  await expect(stickerOf(page, food)).toBeHidden();
  await expect(page.getByText(/not saved yet|Couldn't save/)).toBeHidden();
});

test("deletes the tasks under a deleted task too", async ({ page }) => {
  const party = await addTask(page, `Party ${Date.now()}`);
  const cake = `Cake ${Date.now()}`;
  await addTaskUnder(page, party, cake);
  await stickerOf(page, party).click();

  await deleteTaskWithItemsUnder(page, party, "Delete them too");

  await page.getByRole("button", { name: "List", exact: true }).click();
  const names = await spaceListNames(page);
  expect(names.some((name) => name.startsWith(cake) || name.startsWith(party))).toBe(false);
  await expect(page.getByText(/not saved yet|Couldn't save/)).toBeHidden();
});

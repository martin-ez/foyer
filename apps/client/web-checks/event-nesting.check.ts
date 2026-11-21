import { expect, type Page, test } from "@playwright/test";
import { connectAtFakeGoogle, memberOfItsOwn } from "./google-calendar";
import { saveScreenshot } from "./screenshot";
import { eventNestingMembers, signIn } from "./sign-in";
import { addTask, bundleBuildTimeout, openSpace, pageTitle, stickerOf } from "./tasks";

function eventSticker(page: Page, title: string) {
  return page.getByRole("button", { name: `Event: ${title}` });
}

async function addEventTomorrow(page: Page, title: string, space: string) {
  await page.getByRole("tab", { name: "Calendar" }).click();
  await page.getByRole("button", { name: "New event" }).click();
  await page.getByLabel("Title").fill(title);
  await page.getByRole("checkbox", { name: "All day" }).click();
  const tomorrow = await page.evaluate(() => {
    const day = new Date();
    day.setDate(day.getDate() + 1);
    const two = (value: number) => String(value).padStart(2, "0");
    return `${day.getFullYear()}-${two(day.getMonth() + 1)}-${two(day.getDate())}`;
  });
  await page.getByLabel("First day").fill(tomorrow);
  await page.getByLabel("Last day").fill(tomorrow);
  await page.getByRole("checkbox", { name: `In ${space}` }).click();
  await page.getByRole("button", { name: "Add event" }).click();
  await expect(eventSticker(page, title).first()).toBeVisible();
}

test("puts an event under a task, shows it on the task's page and list, and takes it out", async ({
  page,
}, testInfo) => {
  test.setTimeout(bundleBuildTimeout + 120_000);
  await signIn(page, memberOfItsOwn(eventNestingMembers, testInfo));
  await expect(page.getByText("Up to date")).toBeVisible({ timeout: bundleBuildTimeout });
  await connectAtFakeGoogle(page, /^Continue as /);
  await openSpace(page, "Personal");
  const party = await addTask(page, `Party ${Date.now()}`);
  const dinner = `Dinner ${Date.now()}`;
  await addEventTomorrow(page, dinner, "Personal");

  await page.getByRole("list", { name: "Upcoming events" }).getByLabel(`Event: ${dinner}`).click();
  await page.getByLabel("Put it under a task").fill(party);
  await page.getByRole("button", { name: `Put under “${party}”` }).click();

  await expect(page.getByText(`Under “${party}”`)).toBeVisible();
  await saveScreenshot(page, testInfo, "event-editor-under-task");
  await page.getByRole("button", { name: `Open “${party}”` }).click();
  await expect(page.getByRole("button", { name: "Delete task" })).toBeVisible();

  await openSpace(page, "Personal");
  await stickerOf(page, party).click();
  await expect(pageTitle(page)).toHaveText(party);
  await expect(eventSticker(page, dinner)).toBeVisible();
  await saveScreenshot(page, testInfo, "event-on-task-page");
  await page.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "List", exact: true }).click();
  const names = await page
    .getByRole("list", { name: "Personal" })
    .getByRole("button")
    .allTextContents();
  const at = names.findIndex((name) => name.startsWith(party));
  expect(names[at + 1]?.startsWith(dinner)).toBe(true);
  await saveScreenshot(page, testInfo, "event-under-task-in-list");
  await page.getByRole("button", { name: "Hide list" }).click();

  await stickerOf(page, party).click();
  await eventSticker(page, dinner).click();
  await expect(page.getByLabel("Title")).toHaveValue(dinner);
  await page.getByRole("button", { name: `Take it out of “${party}”` }).click();

  await expect(page.getByText(`Under “${party}”`)).toBeHidden();
  await expect(pageTitle(page)).toHaveText(/^Personal, page \d+$/);
  await expect(eventSticker(page, dinner)).toBeVisible();
  await expect(page.getByText(/not saved yet|Couldn't save/)).toBeHidden();
});

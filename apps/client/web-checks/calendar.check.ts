import { expect, type Page, test } from "@playwright/test";
import { describeDayInBrowser, describeMonthInBrowser, describeWeekInBrowser } from "./pages";
import { saveScreenshot } from "./screenshot";
import { signIn } from "./sign-in";
import { bundleBuildTimeout, pageTitle } from "./tasks";

test.beforeEach(async ({ page }) => {
  test.setTimeout(bundleBuildTimeout + 30_000);
  await signIn(page);
  await expect(page.getByText("Up to date")).toBeVisible({ timeout: bundleBuildTimeout });
});

function show(page: Page, span: "Day" | "Week" | "Month") {
  return page.getByRole("radio", { name: span }).click();
}

test("switches between day, week and month pages around the same day", async ({
  page,
}, testInfo) => {
  await expect(page.getByRole("radio", { name: "Day", checked: true })).toBeVisible();

  await show(page, "Week");
  await expect(pageTitle(page)).toHaveText(await describeWeekInBrowser(page, 0));
  await expect(page.getByLabel(await describeWeekInBrowser(page, 0))).toBeVisible();
  await saveScreenshot(page, testInfo, "week-page");

  await show(page, "Month");
  await expect(pageTitle(page)).toHaveText(await describeMonthInBrowser(page, 0));
  const monday = await page.evaluate(() =>
    new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(new Date(2026, 10, 16)),
  );
  await expect(page.getByText(monday, { exact: true })).toBeVisible();
  await saveScreenshot(page, testInfo, "month-page");

  await show(page, "Day");
  await expect(pageTitle(page)).toHaveText(await describeDayInBrowser(page, 0));
});

test("moves between months and weeks, and back to today", async ({ page }) => {
  await show(page, "Month");
  await page.getByRole("button", { name: "Next month" }).click();
  await page.getByRole("button", { name: "Next month" }).click();
  await expect(pageTitle(page)).toHaveText(await describeMonthInBrowser(page, 2));
  await page.getByRole("button", { name: "Previous month" }).click();
  await expect(pageTitle(page)).toHaveText(await describeMonthInBrowser(page, 1));

  await page.getByRole("button", { name: "Today" }).click();
  await expect(pageTitle(page)).toHaveText(await describeMonthInBrowser(page, 0));

  await show(page, "Week");
  await page.getByRole("button", { name: "Previous week" }).click();
  await expect(pageTitle(page)).toHaveText(await describeWeekInBrowser(page, -1));
  await page.getByRole("button", { name: "Next week" }).click();
  await page.getByRole("button", { name: "Next week" }).click();
  await expect(pageTitle(page)).toHaveText(await describeWeekInBrowser(page, 1));
  await page.getByRole("button", { name: "Today" }).click();
  await expect(pageTitle(page)).toHaveText(await describeWeekInBrowser(page, 0));
});

test("opens a day's page from the month and the week pages", async ({ page }) => {
  const today = await describeDayInBrowser(page, 0);
  const inAWeek = await describeDayInBrowser(page, 7);

  await show(page, "Month");
  await page.getByRole("button", { name: `Open ${today}` }).click();
  await expect(pageTitle(page)).toHaveText(today);
  await expect(page.getByRole("radio", { name: "Day", checked: true })).toBeVisible();

  await show(page, "Week");
  await page.getByRole("button", { name: "Next week" }).click();
  await page.getByRole("button", { name: `Open ${inAWeek}` }).click();
  await expect(pageTitle(page)).toHaveText(inAWeek);
});

import { expect, type Page, test } from "@playwright/test";
import { describeDayInBrowser } from "./pages";
import { saveScreenshot } from "./screenshot";
import { signIn } from "./sign-in";
import { bundleBuildTimeout, pageTitle } from "./tasks";

test.beforeEach(async ({ page }) => {
  test.setTimeout(bundleBuildTimeout + 30_000);
  await signIn(page);
  await expect(page.getByText("Up to date")).toBeVisible({ timeout: bundleBuildTimeout });
});

async function expectToShow(page: Page, destination: string, title: string | RegExp) {
  await expect(page.getByRole("tab", { name: destination, selected: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/${destination.toLowerCase()}$`));
  await expect(pageTitle(page)).toHaveText(title);
}

test("opens each destination from the bar", async ({ page }, testInfo) => {
  const today = await describeDayInBrowser(page, 0);
  await expectToShow(page, "Calendar", today);

  await page.getByRole("tab", { name: "Notebook" }).click();
  await expectToShow(page, "Notebook", "Notebook");
  await saveScreenshot(page, testInfo, "notebook");

  await page.getByRole("tab", { name: "Tasks" }).click();
  await expectToShow(page, "Tasks", /^Inbox, page \d+$/);
  await saveScreenshot(page, testInfo, "tasks");

  await page.getByRole("tab", { name: "Calendar" }).click();
  await expectToShow(page, "Calendar", today);
});

test("opens each destination from its address, and goes back through them", async ({ page }) => {
  const today = await describeDayInBrowser(page, 0);

  await page.goto("/tasks");
  await expectToShow(page, "Tasks", /^Inbox, page \d+$/);
  await page.goto("/notebook");
  await expectToShow(page, "Notebook", "Notebook");
  await page.goto("/calendar");
  await expectToShow(page, "Calendar", today);

  await page.getByRole("tab", { name: "Tasks" }).click();
  await expectToShow(page, "Tasks", /^Inbox, page \d+$/);
  await page.goBack();
  await expectToShow(page, "Calendar", today);
});

test("keeps the day a destination showed while another is open", async ({ page }) => {
  await page.getByRole("button", { name: "Next day" }).click();
  const tomorrow = await describeDayInBrowser(page, 1);
  await expect(pageTitle(page)).toHaveText(tomorrow);

  await page.getByRole("tab", { name: "Tasks" }).click();
  await expectToShow(page, "Tasks", /^Inbox, page \d+$/);
  await page.getByRole("tab", { name: "Calendar" }).click();

  await expectToShow(page, "Calendar", tomorrow);
});

test("shows and hides the account menu, and signs out from it", async ({ page }, testInfo) => {
  await page.getByRole("tab", { name: "Tasks" }).click();

  await page.getByRole("button", { name: "Account" }).click();
  await expect(page.getByText(/^Signed in as /)).toBeVisible();
  await expect(page.getByText(/backend: storage/)).toBeVisible();
  await saveScreenshot(page, testInfo, "account-menu");
  await page.getByRole("button", { name: "Hide account" }).click();
  await expect(page.getByText(/^Signed in as /)).toBeHidden();
  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();

  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
});

test("says it's waiting for the spaces until the household sends them", async ({ browser }) => {
  const context = await browser.newContext(test.info().project.use);
  const page = await context.newPage();
  await page.routeWebSocket(/\/sync$/, () => {});
  await signIn(page);

  await page.getByRole("tab", { name: "Tasks" }).click({ timeout: bundleBuildTimeout });

  await expect(page.getByText("Waiting for the household's spaces…")).toBeVisible();
  await context.close();
});

import { expect, test } from "@playwright/test";
import { saveScreenshot } from "../web-checks/screenshot";
import { openApp, pageTitle } from "../web-checks/tasks";
import { current, deploy, earlier, expectLoadedFrom } from "./versions";

test("reloads into the new version when it opens a view whose file a deploy replaced", async ({
  page,
}, testInfo) => {
  await deploy(earlier);
  await openApp(page);
  await expect(page.getByRole("tab", { name: "Calendar", selected: true })).toBeVisible();
  await expectLoadedFrom(page, earlier);

  await deploy(current);
  const reloaded = page.waitForEvent("load", { timeout: 15_000 });
  await page.getByRole("tab", { name: "Tasks" }).click();
  await reloaded;

  await expect(page.getByRole("tab", { name: "Tasks", selected: true })).toBeVisible();
  await expect(pageTitle(page)).toHaveText(/^Inbox, page \d+$/);
  await expect(page.getByText("Up to date")).toBeVisible();
  await expectLoadedFrom(page, current);
  await saveScreenshot(page, testInfo, "after-deploy");
});

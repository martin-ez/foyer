import { expect, test } from "@playwright/test";
import { saveScreenshot } from "../web-checks/screenshot";
import { signIn } from "../web-checks/sign-in";
import { current, deploy, expectLoadedFrom } from "./versions";

test("the exported app opens, signs in and gets up to date", async ({ page }, testInfo) => {
  await deploy(current);

  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
  await expectLoadedFrom(page, current);

  await signIn(page);
  await expect(page.getByText("Up to date")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Calendar", selected: true })).toBeVisible();
  await saveScreenshot(page, testInfo, "first-page");
});

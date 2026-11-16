import { expect, test } from "@playwright/test";
import { saveScreenshot } from "./screenshot";
import { signIn } from "./sign-in";

const bundleBuildTimeout = 120_000;

test("the app opens, signs in and shows its first page", async ({ page }, testInfo) => {
  test.setTimeout(bundleBuildTimeout + 30_000);

  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible({
    timeout: bundleBuildTimeout,
  });

  await signIn(page);
  await expect(page.getByText(/^Signed in as /)).toBeVisible();
  await expect(page.getByText("Up to date")).toBeVisible();

  await saveScreenshot(page, testInfo, "first-page");
});

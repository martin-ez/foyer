import path from "node:path";
import type { Page, TestInfo } from "@playwright/test";

/** Saves what `page` shows as `web-checks/screenshots/<name>-<viewport>.png`, where the viewport
 *  is the Playwright project's name, such as `ipad` or `phone`. */
export async function saveScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const file = `${name}-${testInfo.project.name}.png`;
  await page.screenshot({ path: path.join(testInfo.project.testDir, "screenshots", file) });
}

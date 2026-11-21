import { existsSync } from "node:fs";
import { chromium, devices, type PlaywrightTestConfig } from "@playwright/test";

const cloudSessionChromium = "/opt/pw-browsers/chromium";
const pinnedChromiumIsMissing = !existsSync(chromium.executablePath());
const executablePath =
  pinnedChromiumIsMissing && existsSync(cloudSessionChromium) ? cloudSessionChromium : undefined;

/** The browser the web checks run in: Playwright's Chromium, or a cloud session's when
 *  Playwright's isn't there. */
export const browser = {
  browserName: "chromium",
  launchOptions: { executablePath },
} satisfies PlaywrightTestConfig["use"];

/** The viewports every web check runs in, an iPad's and a phone's, named for screenshots. */
export const viewports = [
  { name: "ipad", use: { ...devices["iPad Pro 11 landscape"], browserName: "chromium" } },
  { name: "phone", use: { ...devices["iPhone 15"], browserName: "chromium" } },
] satisfies PlaywrightTestConfig["projects"];

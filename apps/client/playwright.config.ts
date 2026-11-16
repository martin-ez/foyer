import { existsSync } from "node:fs";
import { chromium, defineConfig, devices } from "@playwright/test";

const backend = "http://localhost:8787";
const webDevServer = "http://localhost:8081";

const cloudSessionChromium = "/opt/pw-browsers/chromium";
const pinnedChromiumIsMissing = !existsSync(chromium.executablePath());
const executablePath =
  pinnedChromiumIsMissing && existsSync(cloudSessionChromium) ? cloudSessionChromium : undefined;

/** Checks the web app in a browser against the local backend, in an iPad's and a phone's
 *  viewport. Starts the backend and Expo's development server, or reuses ones already running. */
export default defineConfig({
  testDir: "web-checks",
  testMatch: "*.check.ts",
  outputDir: "web-checks/results",
  reporter: "list",
  use: {
    baseURL: backend,
    browserName: "chromium",
    launchOptions: { executablePath },
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "ipad", use: { ...devices["iPad Pro 11 landscape"], browserName: "chromium" } },
    { name: "phone", use: { ...devices["iPhone 15"], browserName: "chromium" } },
  ],
  webServer: [
    {
      command: "pnpm --filter @foyer/client web",
      url: webDevServer,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: "pnpm --filter @foyer/server dev",
      url: backend,
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});

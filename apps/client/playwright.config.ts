import { existsSync } from "node:fs";
import path from "node:path";
import { chromium, defineConfig, devices } from "@playwright/test";

const checksBackendPort = 8788;
const backend = `http://localhost:${checksBackendPort}`;
const webDevServer = "http://localhost:8081";

const checksStorage = ".wrangler/web-checks";

const cloudSessionChromium = "/opt/pw-browsers/chromium";
const pinnedChromiumIsMissing = !existsSync(chromium.executablePath());
const executablePath =
  pinnedChromiumIsMissing && existsSync(cloudSessionChromium) ? cloudSessionChromium : undefined;

/** Checks the web app in a browser, in an iPad's and a phone's viewport, against a backend of the
 *  checks' own that starts with an empty household on every run, so the local household on 8787
 *  is never touched. Starts Expo's development server, or reuses one already running. */
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
      command: `rm -rf ${checksStorage} && pnpm dev --port ${checksBackendPort} --persist-to ${checksStorage}`,
      cwd: path.join(__dirname, "../server"),
      url: backend,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});

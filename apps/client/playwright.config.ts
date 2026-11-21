import path from "node:path";
import { defineConfig } from "@playwright/test";
import { browser, viewports } from "./web-checks/browser";
import { checksHouseholdMembers } from "./web-checks/sign-in";

const checksBackendPort = 8788;
const backend = `http://localhost:${checksBackendPort}`;
const webDevServer = "http://localhost:8081";

const checksStorage = ".wrangler/web-checks";
const checksAllowlist = `HOUSEHOLD_MEMBERS:${JSON.stringify(checksHouseholdMembers)}`;

/** Checks the web app in a browser, in an iPad's and a phone's viewport, against a backend of the
 *  checks' own that starts with an empty household of the checks' members on every run, so the
 *  local household on 8787 is never touched. Starts Expo's server, or reuses one already running. */
export default defineConfig({
  testDir: "web-checks",
  testMatch: "*.check.ts",
  outputDir: "web-checks/results",
  reporter: "list",
  use: { ...browser, baseURL: backend, screenshot: "only-on-failure" },
  projects: viewports,
  webServer: [
    {
      command: "pnpm --filter @foyer/client web",
      url: webDevServer,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: `rm -rf ${checksStorage} && pnpm dev --port ${checksBackendPort} --persist-to ${checksStorage} --var '${checksAllowlist}'`,
      cwd: path.join(__dirname, "../server"),
      url: backend,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});

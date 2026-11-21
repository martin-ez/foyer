import path from "node:path";
import { defineConfig } from "@playwright/test";
import { browser, viewports } from "./web-checks/browser";
import { checksHouseholdMembers } from "./web-checks/sign-in";
import { exportChecksBackend, servedFolder } from "./web-export-checks/versions";

const storage = ".wrangler/web-export-checks";
const settings = {
  HOUSEHOLD_MEMBERS: JSON.stringify(checksHouseholdMembers),
  DEV_SIGN_IN: "1",
  WEB_APP_DEV_SERVER: "",
};
const vars = Object.entries(settings)
  .map(([name, value]) => `--var '${name}:${value}'`)
  .join(" ");

/** Checks the web app as deploys export it, served as the deployed Worker serves it, against a
 *  backend of the checks' own whose household starts empty on every run. Checks run one at a time,
 *  since each deploys the version it needs to that backend. `check-web-export` exports them first. */
export default defineConfig({
  testDir: "web-export-checks",
  testMatch: "*.check.ts",
  outputDir: "web-export-checks/results",
  reporter: "list",
  workers: 1,
  use: { ...browser, baseURL: exportChecksBackend, screenshot: "only-on-failure" },
  projects: viewports,
  webServer: {
    command: `rm -rf ${storage} && pnpm exec wrangler dev --port ${new URL(exportChecksBackend).port} --persist-to ${storage} --assets '${servedFolder}' ${vars}`,
    cwd: path.join(__dirname, "../server"),
    url: exportChecksBackend,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});

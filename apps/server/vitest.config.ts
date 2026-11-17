import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { unstable_readConfig } from "wrangler";

const wranglerConfigPath = "./wrangler.jsonc";

const settingsInPlaceOfDevVars: Record<string, string> = {
  HOUSEHOLD_MEMBERS: '["member@example.com", "housemate@example.com"]',
  GOOGLE_CLIENT_ID: "foyer-test.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "google-client-secret",
  DEV_SIGN_IN: "1",
  WEB_APP_DEV_SERVER: "",
};

const { vars, secrets } = unstable_readConfig({ config: wranglerConfigPath });
const unset = [...Object.keys(vars), ...(secrets?.required ?? [])].filter(
  (name) => !(name in settingsInPlaceOfDevVars),
);
if (unset.length > 0) {
  throw new Error(
    `Set ${unset.join(", ")} in apps/server/vitest.config.ts, so the tests don't take a value from .dev.vars.`,
  );
}

/** Runs the backend's tests in the Workers runtime. Wrangler still loads .dev.vars and says so, but
 *  every setting the backend reads is set here and overrides it, so the tests never use its values. */
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: wranglerConfigPath },
      miniflare: {
        assets: { directory: "./test/web-app" },
        bindings: settingsInPlaceOfDevVars,
      },
    }),
  ],
});

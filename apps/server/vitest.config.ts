import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { unstable_readConfig } from "wrangler";

const wranglerConfigPath = "./wrangler.jsonc";

// Wrangler still loads .dev.vars and says so, but the tests never read it: every setting the
// backend reads is set here, and overrides the developer's local value.
const settings: Record<string, string> = {
  HOUSEHOLD_MEMBERS: '["member@example.com", "housemate@example.com"]',
  GOOGLE_CLIENT_ID: "foyer-test.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "google-client-secret",
  DEV_SIGN_IN: "1",
  WEB_APP_DEV_SERVER: "",
};

const { vars, secrets } = unstable_readConfig({ config: wranglerConfigPath });
const unset = [...Object.keys(vars), ...(secrets?.required ?? [])].filter(
  (name) => !(name in settings),
);
if (unset.length > 0) {
  throw new Error(
    `Set ${unset.join(", ")} in apps/server/vitest.config.ts, so the tests don't take a value from .dev.vars.`,
  );
}

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: wranglerConfigPath },
      miniflare: {
        assets: { directory: "./test/web-app" },
        bindings: settings,
      },
    }),
  ],
});

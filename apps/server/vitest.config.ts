import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        assets: { directory: "./test/web-app" },
        bindings: {
          HOUSEHOLD_MEMBERS: '["member@example.com", "housemate@example.com"]',
          GOOGLE_CLIENT_ID: "foyer-test.apps.googleusercontent.com",
          GOOGLE_CLIENT_SECRET: "google-client-secret",
          DEV_SIGN_IN: "1",
        },
      },
    }),
  ],
});

import { env, exports } from "cloudflare:workers";
import { appName } from "@foyer/shared";
import { expect, it } from "vitest";

it("answers with the app name and a working storage check", async () => {
  const response = await exports.default.fetch("https://foyer.test/");

  expect(await response.json()).toEqual({ app: appName, storage: "ok" });
});

it("answers the household's storage check", async () => {
  const household = env.HOUSEHOLD.getByName("test");

  expect(await household.ping()).toBe("ok");
});

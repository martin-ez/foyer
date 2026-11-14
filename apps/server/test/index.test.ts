import { env, exports } from "cloudflare:workers";
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { appName } from "@foyer/shared";
import { StatusService } from "@foyer/shared/gen/foyer/status/v1/status_pb";
import { describe, expect, it } from "vitest";

const backendUrl = "https://foyer.test";
const statusPath = "/foyer.status.v1.StatusService/GetStatus";
const webAppOrigin = "http://localhost:8081";
const redirectModeTheWorkersRuntimeAccepts: RequestRedirect = "manual";

function statusClient(useBinaryFormat: boolean) {
  const transport = createConnectTransport({
    baseUrl: backendUrl,
    useBinaryFormat,
    fetch: (input, init) =>
      exports.default.fetch(
        new Request(input, { ...init, redirect: redirectModeTheWorkersRuntimeAccepts }),
      ),
  });
  return createClient(StatusService, transport);
}

describe("the status call", () => {
  it("answers with the app name and a working storage check", async () => {
    const status = await statusClient(false).getStatus({});

    expect(status).toMatchObject({ app: appName, storage: "ok" });
  });

  it("answers in the binary encoding too", async () => {
    const status = await statusClient(true).getStatus({});

    expect(status).toMatchObject({ app: appName, storage: "ok" });
  });

  it("can be made from a web page on another origin", async () => {
    const preflight = await exports.default.fetch(`${backendUrl}${statusPath}`, {
      method: "OPTIONS",
      headers: {
        Origin: webAppOrigin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,connect-protocol-version",
      },
    });
    const call = await exports.default.fetch(`${backendUrl}${statusPath}`, {
      method: "POST",
      headers: { Origin: webAppOrigin, "Content-Type": "application/json" },
      body: "{}",
    });

    expect(preflight.ok).toBe(true);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(preflight.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    const allowedHeaders = preflight.headers.get("Access-Control-Allow-Headers")?.toLowerCase();
    expect(allowedHeaders).toContain("content-type");
    expect(allowedHeaders).toContain("connect-protocol-version");
    expect(call.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await call.json()).toEqual({ app: appName, storage: "ok" });
  });
});

it("answers calls to a service that doesn't exist as not found", async () => {
  const response = await exports.default.fetch(
    `${backendUrl}/foyer.missing.v1.MissingService/Get`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    },
  );

  expect(response.status).toBe(404);
});

it("answers the household's storage check", async () => {
  const household = env.HOUSEHOLD.getByName("test");

  expect(await household.ping()).toBe("ok");
});

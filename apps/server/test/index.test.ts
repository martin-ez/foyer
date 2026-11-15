import { exports } from "cloudflare:workers";
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { appName } from "@foyer/shared";
import { StatusService } from "@foyer/shared/gen/foyer/status/v1/status_pb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { theHousehold } from "../src/household";
import { requestBackendWith } from "./backend";

const backendUrl = "https://foyer.test";
const statusPath = "/foyer.status.v1.StatusService/GetStatus";
const redirectModeTheWorkersRuntimeAccepts: RequestInit["redirect"] = "manual";

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

function preflightStatusCall(origin: string) {
  return exports.default.fetch(`${backendUrl}${statusPath}`, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type,connect-protocol-version",
    },
  });
}

function callStatusFrom(origin: string) {
  return exports.default.fetch(`${backendUrl}${statusPath}`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: "{}",
  });
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

  it.each(["https://example.com", "http://localhost:8081"])(
    "can't be made from a web page on another site, at %s",
    async (origin) => {
      const preflight = await preflightStatusCall(origin);
      const call = await callStatusFrom(origin);

      expect(preflight.ok).toBe(false);
      expect(preflight.headers.get("Access-Control-Allow-Origin")).toBeNull();
      expect(call.headers.get("Access-Control-Allow-Origin")).toBeNull();
    },
  );
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
  expect(await theHousehold().ping()).toBe("ok");
});

describe("the web app's pages", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function requestPage(url: string, devServer: string | undefined) {
    return requestBackendWith({ WEB_APP_DEV_SERVER: devServer }, url);
  }

  it("aren't served by the deployed backend", async () => {
    expect((await requestPage(`${backendUrl}/`, undefined)).status).toBe(404);
  });

  it.each(["localhost", "127.0.0.1", "[::1]"])(
    "come from the development server, at the local backend's address on %s",
    async (host) => {
      vi.spyOn(globalThis, "fetch").mockImplementation(
        async (input) => new Response(`page at ${new Request(input).url}`),
      );

      const page = await requestPage(
        `http://${host}:8787/notes/1?open=true`,
        "http://localhost:8081",
      );

      expect(await page.text()).toBe("page at http://localhost:8081/notes/1?open=true");
    },
  );

  it("don't come from the development server for a backend reached from another computer", async () => {
    const devServer = vi.spyOn(globalThis, "fetch");

    const page = await requestPage(`${backendUrl}/`, "http://localhost:8081");

    expect(page.status).toBe(404);
    expect(devServer).not.toHaveBeenCalled();
  });
});

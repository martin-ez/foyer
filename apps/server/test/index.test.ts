import { exports } from "cloudflare:workers";
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { appName } from "@foyer/shared";
import { StatusService } from "@foyer/shared/gen/foyer/status/v1/status_pb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { theHousehold } from "../src/household";
import { requestBackend, requestBackendWith } from "./backend";

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

  async function expectTheApp(page: Response) {
    expect(page.status).toBe(200);
    expect(page.headers.get("Content-Type")).toMatch(/^text\/html/);
    expect(await page.text()).toContain("<title>Foyer test app</title>");
  }

  it.each(["/", "/notes/1?open=true", "/calendar/2026-11-15/"])(
    "are the app's index.html at every address, such as %s",
    async (path) => {
      await expectTheApp(await requestBackend(`${backendUrl}${path}`));
    },
  );

  it("answer a page's address with the app when asked for its headers only", async () => {
    const page = await requestBackend(`${backendUrl}/notes/1`, { method: "HEAD" });

    expect(page.status).toBe(200);
    expect(page.headers.get("Content-Type")).toMatch(/^text\/html/);
  });

  it("don't stand in for a file the app doesn't have", async () => {
    const file = await requestBackend(`${backendUrl}/_expo/static/js/web/index-missing.js`);

    expect(file.status).toBe(404);
  });

  it("don't answer a page's address when something is sent to it", async () => {
    const sent = await requestBackend(`${backendUrl}/notes/1`, { method: "POST", body: "{}" });

    expect(sent.status).toBe(404);
  });

  it("don't stand in for the backend's own addresses", async () => {
    const signIn = await requestBackend(`${backendUrl}/auth/missing`);

    expect(signIn.status).toBe(404);
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

  it("are the app's index.html at the local backend's address without a development server", async () => {
    await expectTheApp(await requestPage("http://localhost:8787/notes/1", undefined));
  });

  it("don't come from the development server for a backend reached from another computer", async () => {
    const devServer = vi.spyOn(globalThis, "fetch");

    const page = await requestPage(`${backendUrl}/notes/1`, "http://localhost:8081");

    await expectTheApp(page);
    expect(devServer).not.toHaveBeenCalled();
  });
});

import type { MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient, createRouterTransport } from "@connectrpc/connect";
import {
  type GetStatusResponseSchema,
  StatusService,
} from "@foyer/shared/gen/foyer/status/v1/status_pb";
import { describe, expect, it } from "vitest";
import { describeBackendStatus } from "../src/backend/describe-backend-status";

function backendAnswering(getStatus: () => MessageInitShape<typeof GetStatusResponseSchema>) {
  const transport = createRouterTransport(({ service }) => {
    service(StatusService, { getStatus });
  });
  return createClient(StatusService, transport);
}

describe("describeBackendStatus", () => {
  it("describes the status the backend answers with", async () => {
    const backend = backendAnswering(() => ({ app: "Foyer", storage: "ok" }));

    expect(await describeBackendStatus(backend)).toBe("Foyer backend: storage ok");
  });

  it("says the backend is unreachable, and why, when the call fails", async () => {
    const backend = backendAnswering(() => {
      throw new ConnectError("Failed to fetch", Code.Unavailable);
    });

    expect(await describeBackendStatus(backend)).toBe(
      "Backend unreachable: [unavailable] Failed to fetch",
    );
  });
});

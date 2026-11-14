import { cors, createConnectRouter } from "@connectrpc/connect";
import { createFetchHandler } from "@connectrpc/connect/protocol";
import { StatusService } from "@foyer/shared/gen/foyer/status/v1/status_pb";
import { statusService } from "./status-service";

const router = createConnectRouter({ grpc: false, grpcWeb: false }).service(
  StatusService,
  statusService,
);

const handlers = new Map(
  router.handlers.map((handler) => [handler.requestPath, createFetchHandler(handler)]),
);

/** Answers the apps' request/response calls, made with Connect to the services in the contracts.
 *  Any web page may make them. */
export async function handleCall(request: Request): Promise<Response> {
  const handler = handlers.get(new URL(request.url).pathname);
  if (!handler) return new Response(null, { status: 404 });
  if (request.method === "OPTIONS") return allowCrossOriginCall();

  const response = await handler(request);
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Expose-Headers", cors.exposedHeaders.join(", "));
  return new Response(response.body, { status: response.status, headers });
}

function allowCrossOriginCall() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": cors.allowedMethods.join(", "),
      "Access-Control-Allow-Headers": cors.allowedHeaders.join(", "),
      "Access-Control-Max-Age": "7200",
    },
  });
}

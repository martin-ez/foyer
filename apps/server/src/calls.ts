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

const developmentServerOrigin = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/** Answers the apps' request/response calls, made with Connect to the services in the contracts.
 *  Web pages can make them from the backend's own origin, or from a development server on the
 *  same computer. */
export async function handleCall(request: Request): Promise<Response> {
  const handler = handlers.get(new URL(request.url).pathname);
  if (!handler) return new Response(null, { status: 404 });

  const origin = request.headers.get("Origin");
  const crossOrigin = origin && developmentServerOrigin.test(origin) ? origin : null;
  if (request.method === "OPTIONS") {
    return crossOrigin ? allowCrossOriginCall(crossOrigin) : new Response(null, { status: 403 });
  }

  const response = await handler(request);
  if (!crossOrigin) return response;
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", crossOrigin);
  headers.set("Access-Control-Expose-Headers", cors.exposedHeaders.join(", "));
  headers.append("Vary", "Origin");
  return new Response(response.body, { status: response.status, headers });
}

function allowCrossOriginCall(origin: string) {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": cors.allowedMethods.join(", "),
      "Access-Control-Allow-Headers": cors.allowedHeaders.join(", "),
      "Access-Control-Max-Age": "7200",
      Vary: "Origin",
    },
  });
}

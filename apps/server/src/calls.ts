import { createConnectRouter } from "@connectrpc/connect";
import { createFetchHandler } from "@connectrpc/connect/protocol";
import { CaptureService } from "@foyer/shared/gen/foyer/capture/v1/capture_pb";
import { SessionService } from "@foyer/shared/gen/foyer/session/v1/session_pb";
import { StatusService } from "@foyer/shared/gen/foyer/status/v1/status_pb";
import { captureService } from "./capture-service";
import { sessionService } from "./session-service";
import { statusService } from "./status-service";

const router = createConnectRouter({ grpc: false, grpcWeb: false })
  .service(StatusService, statusService)
  .service(SessionService, sessionService)
  .service(CaptureService, captureService);

const handlers = new Map(
  router.handlers.map((handler) => [handler.requestPath, createFetchHandler(handler)]),
);

/** Whether a path is one of the calls in the contracts. */
export function isCall(pathname: string): boolean {
  return handlers.has(pathname);
}

/** Answers the apps' request/response calls, made with Connect to the services in the contracts.
 *  Only the backend's own site can make them from a web page. */
export async function handleCall(request: Request): Promise<Response> {
  const handler = handlers.get(new URL(request.url).pathname);
  return handler ? handler(request) : new Response(null, { status: 404 });
}

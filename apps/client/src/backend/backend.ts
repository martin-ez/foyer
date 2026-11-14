import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { StatusService } from "@foyer/shared/gen/foyer/status/v1/status_pb";

/** Where the backend answers: `EXPO_PUBLIC_BACKEND_URL` when it's set, otherwise the backend that
 *  `pnpm --filter @foyer/server dev` runs on this computer. */
export const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL || "http://localhost:8787";

const transport = createConnectTransport({ baseUrl: backendUrl });

/** Calls the backend's status service. */
export const statusClient = createClient(StatusService, transport);

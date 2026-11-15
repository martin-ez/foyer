import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { SessionService } from "@foyer/shared/gen/foyer/session/v1/session_pb";
import { StatusService } from "@foyer/shared/gen/foyer/status/v1/status_pb";
import { Platform } from "react-native";
import { sendingSessionToken } from "../session/session";
import { readSessionToken } from "../session/session-token";

/** Where the backend answers. The web app is served from the backend's own address. The iPad app
 *  calls `EXPO_PUBLIC_BACKEND_URL` when it's set, and otherwise the backend that
 *  `pnpm --filter @foyer/server dev` runs on this computer. */
export const backendUrl =
  Platform.OS === "web"
    ? window.location.origin
    : process.env.EXPO_PUBLIC_BACKEND_URL || "http://localhost:8787";

const transport = createConnectTransport({
  baseUrl: backendUrl,
  interceptors: [sendingSessionToken(readSessionToken)],
});

/** Calls the backend's status service. */
export const statusClient = createClient(StatusService, transport);

/** Calls the backend's session service. */
export const sessionClient = createClient(SessionService, transport);

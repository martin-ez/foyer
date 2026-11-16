import { backendUrl } from "../backend/backend";
import { readSessionToken } from "../session/session-token";
import type { Connect } from "./household-sync";
import { reportEvents, syncAddress } from "./socket";

type ReactNativeWebSocketWithHeaders = new (
  address: string,
  protocols: null,
  options: { headers: Record<string, string> },
) => WebSocket;

/** Opens the iPad app's sync connection, carrying its session token as a bearer token. */
export const connectToHousehold: Connect = (events) => {
  let socket: WebSocket | null = null;
  let closed = false;
  readSessionToken().then(
    (token) => {
      if (closed) return;
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      socket = new (WebSocket as unknown as ReactNativeWebSocketWithHeaders)(
        syncAddress(backendUrl),
        null,
        {
          headers,
        },
      );
      reportEvents(socket, events);
    },
    () => events.closed(0),
  );
  return {
    send: (data) => socket?.send(data),
    close: () => {
      closed = true;
      socket?.close();
    },
  };
};

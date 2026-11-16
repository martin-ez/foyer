import { syncPath } from "@foyer/shared";
import type { ConnectionEvents } from "./household-sync";

/** The WebSocket address of a backend's sync connections. */
export function syncAddress(backendUrl: string): string {
  const address = new URL(syncPath, backendUrl);
  address.protocol = address.protocol === "https:" ? "wss:" : "ws:";
  return address.toString();
}

/** Reports a WebSocket's events as a sync connection's, with binary messages as bytes. */
export function reportEvents(socket: WebSocket, events: ConnectionEvents): void {
  socket.binaryType = "arraybuffer";
  socket.onopen = () => events.opened();
  socket.onmessage = ({ data }) => {
    events.received(typeof data === "string" ? data : new Uint8Array(data as ArrayBuffer));
  };
  socket.onclose = ({ code }) => events.closed(code ?? 0);
}

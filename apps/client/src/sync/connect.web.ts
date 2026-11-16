import { backendUrl } from "../backend/backend";
import type { Connect } from "./household-sync";
import { reportEvents, syncAddress } from "./socket";

/** Opens the web app's sync connection. The browser sends the session's cookie with it. */
export const connectToHousehold: Connect = (events) => {
  const socket = new WebSocket(syncAddress(backendUrl));
  reportEvents(socket, events);
  return { send: (data) => socket.send(data), close: () => socket.close() };
};

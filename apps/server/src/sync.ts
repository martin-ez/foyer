import { signedOutCloseCode } from "@foyer/shared";
import { sessionCookie } from "./cookies";
import { syncConnectionHeaders, theHousehold } from "./household";
import { sessionTokenIn } from "./signed-in";

/** Opens a device's sync connection with the household, once the WebSocket's request carries a
 *  session that hasn't ended. Without one, the connection opens and closes at once with
 *  `signedOutCloseCode`, which browsers can tell apart from a network failure. The web app's
 *  cookie only opens a connection from the backend's own site. */
export async function handleSyncConnection(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return new Response("Sync connections are WebSockets.", {
      status: 426,
      headers: { Upgrade: "websocket" },
    });
  }
  const carried = sessionTokenIn(request.headers);
  if (carried?.inCookie && request.headers.get("Origin") !== url.origin) {
    return new Response(null, { status: 403 });
  }
  const session = carried && (await theHousehold().sessionFor(carried.token));
  if (!carried || !session) return closedAtOnce(signedOutCloseCode, "Nobody is signed in.");

  const opened = await theHousehold().fetch(
    new Request(url, {
      headers: {
        Upgrade: "websocket",
        [syncConnectionHeaders.member]: session.member.id,
        [syncConnectionHeaders.session]: session.sessionId,
      },
    }),
  );
  if (!session.renewed || !carried.inCookie) return opened;
  return new Response(null, {
    status: opened.status,
    webSocket: opened.webSocket,
    headers: { "Set-Cookie": sessionCookie(carried.token, url) },
  });
}

function closedAtOnce(code: number, reason: string): Response {
  const { 0: device, 1: backend } = new WebSocketPair();
  backend.accept();
  backend.close(code, reason);
  return new Response(null, { status: 101, webSocket: device });
}

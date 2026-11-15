import { env } from "cloudflare:workers";
import { isLocalAddress } from "./local";

/** Serves the web app's pages. Locally, when `WEB_APP_DEV_SERVER` names Expo's development server,
 *  they're forwarded to it, so that the web app and the backend share one address there as they do
 *  when deployed. */
export function serveWebApp(request: Request): Promise<Response> | Response {
  const url = new URL(request.url);
  const devServer = env.WEB_APP_DEV_SERVER;
  if (!devServer || !isLocalAddress(url)) return new Response(null, { status: 404 });
  return fetch(new Request(new URL(url.pathname + url.search, devServer), request));
}

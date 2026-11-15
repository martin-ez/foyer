import { env } from "cloudflare:workers";
import { isLocalAddress } from "./local";

/** Answers every page address with the web app's `index.html`. Locally, when `WEB_APP_DEV_SERVER`
 *  names Expo's development server, requests are forwarded to it instead, so that the web app and
 *  the backend share one address there as they do when deployed. */
export function serveWebApp(request: Request): Promise<Response> | Response {
  const url = new URL(request.url);
  const devServer = env.WEB_APP_DEV_SERVER;
  if (devServer && isLocalAddress(url)) {
    return fetch(new Request(new URL(url.pathname + url.search, devServer), request));
  }
  if (!isPage(request, url)) return new Response(null, { status: 404 });
  return env.WEB_APP.fetch(new Request(new URL("/", url), request));
}

function isPage(request: Request, url: URL): boolean {
  const name = url.pathname.split("/").pop() ?? "";
  return (request.method === "GET" || request.method === "HEAD") && !name.includes(".");
}

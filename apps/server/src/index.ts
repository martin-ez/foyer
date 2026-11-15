import { handleCall, isCall } from "./calls";
import { handleSignIn } from "./sign-in";
import { serveWebApp } from "./web-app";

export { Household } from "./household";

export default {
  fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/auth/")) return handleSignIn(request);
    if (isCall(pathname)) return handleCall(request);
    return serveWebApp(request);
  },
} satisfies ExportedHandler<Env>;

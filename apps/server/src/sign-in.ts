import { env } from "cloudflare:workers";
import { cookie, readCookie, sessionCookie } from "./cookies";
import { googleAccountFor, googleClient, googleSignInAddress } from "./google";
import { type Member, theHousehold } from "./household";
import { isLocalAddress } from "./local";
import { newSecret, sha256, toBase64Url } from "./secrets";

/** The app that sign-in returns to: the web app, at the backend's own address, or the iPad app. */
type App = "web" | "ipad";

/** Why sign-in returned to the app without signing someone in. */
type SignInError = "not-in-household" | "failed";

const callbackPath = "/auth/google/callback";
const startedSignInCookieName = "foyer_sign_in";
const startedSignInLifetimeSeconds = 10 * 60;

/** What the browser keeps while the person is at Google: the state that Google must send back, the
 *  verifier that proves the code comes from this sign-in, and the app to return to. */
type StartedSignIn = { state?: string; codeVerifier?: string; app: App };

/** Answers the browser navigations that sign people in, under `/auth/`:
 *  - `/auth/google` sends the person to Google, which sends them back to `/auth/google/callback`.
 *  - `/auth/dev?email=…` signs in as an email on the allowlist without Google, when `DEV_SIGN_IN`
 *    is `1` and the backend runs on this computer.
 *
 *  Both return to the web app, or to the iPad app at `foyer://signed-in` when they're opened with
 *  `?app=ipad`. The web app gets the session's cookie; the iPad app gets a one-time `code` that it
 *  exchanges for a session token. A person who isn't let in returns with an `error`, as
 *  `?sign-in-error=` on the web. */
export async function handleSignIn(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "GET") return new Response(null, { status: 405 });
  switch (url.pathname) {
    case "/auth/google":
      return startGoogleSignIn(url);
    case callbackPath:
      return finishGoogleSignIn(request, url);
    case "/auth/dev":
      return signInWithoutGoogle(url);
    default:
      return new Response(null, { status: 404 });
  }
}

async function startGoogleSignIn(url: URL): Promise<Response> {
  const app = appIn(url);
  const client = googleClient();
  if (!client) return returnToApp(url, app, { error: "failed" });

  const state = newSecret();
  const codeVerifier = newSecret();
  const address = googleSignInAddress(client, {
    redirectUri: callbackAddress(url),
    state,
    codeChallenge: toBase64Url(await sha256(codeVerifier)),
  });
  return redirect(address, [startedSignInCookie(url, { state, codeVerifier, app })]);
}

async function finishGoogleSignIn(request: Request, url: URL): Promise<Response> {
  const { state, codeVerifier, app } = startedSignIn(request);
  const done = cookie(startedSignInCookieName, "", { path: callbackPath, maxAge: 0, url });

  if (url.searchParams.get("error") === "access_denied") {
    return returnToApp(url, app, {}, [done]);
  }
  const code = url.searchParams.get("code");
  const client = googleClient();
  if (!client || !code || !state || !codeVerifier || url.searchParams.get("state") !== state) {
    return returnToApp(url, app, { error: "failed" }, [done]);
  }

  try {
    const account = await googleAccountFor(client, {
      code,
      codeVerifier,
      redirectUri: callbackAddress(url),
    });
    const member = account.emailVerified ? await theHousehold().join(account) : null;
    return await signIn(url, app, member, [done]);
  } catch (error) {
    console.error(`Signing in with Google failed: ${error}`);
    return returnToApp(url, app, { error: "failed" }, [done]);
  }
}

async function signInWithoutGoogle(url: URL): Promise<Response> {
  if (env.DEV_SIGN_IN !== "1" || !isLocalAddress(url)) return new Response(null, { status: 404 });
  const member = await theHousehold().joinWithoutGoogle(url.searchParams.get("email") ?? "");
  return signIn(url, appIn(url), member);
}

async function signIn(
  url: URL,
  app: App,
  member: Member | null,
  cookies: string[] = [],
): Promise<Response> {
  if (!member) return returnToApp(url, app, { error: "not-in-household" }, cookies);
  if (app === "ipad") {
    const code = await theHousehold().issueSignInCode(member.id);
    return returnToApp(url, app, { code }, cookies);
  }
  const token = await theHousehold().startSession(member.id);
  return returnToApp(url, app, {}, [...cookies, sessionCookie(token, url)]);
}

function returnToApp(
  url: URL,
  app: App,
  result: { code?: string; error?: SignInError },
  cookies: string[] = [],
): Response {
  const address = new URL(app === "ipad" ? "foyer://signed-in" : `${url.origin}/`);
  if (result.code) address.searchParams.set("code", result.code);
  if (result.error) {
    address.searchParams.set(app === "ipad" ? "error" : "sign-in-error", result.error);
  }
  return redirect(address.toString(), cookies);
}

function redirect(address: string, cookies: string[]): Response {
  const headers = new Headers({ Location: address, "Cache-Control": "no-store" });
  for (const value of cookies) headers.append("Set-Cookie", value);
  return new Response(null, { status: 302, headers });
}

function startedSignInCookie(url: URL, started: Required<StartedSignIn>): string {
  return cookie(
    startedSignInCookieName,
    [started.state, started.codeVerifier, started.app].join("."),
    { path: callbackPath, maxAge: startedSignInLifetimeSeconds, url },
  );
}

function startedSignIn(request: Request): StartedSignIn {
  const [state, codeVerifier, app] =
    readCookie(request.headers, startedSignInCookieName)?.split(".") ?? [];
  return { state, codeVerifier, app: app === "ipad" ? "ipad" : "web" };
}

function appIn(url: URL): App {
  return url.searchParams.get("app") === "ipad" ? "ipad" : "web";
}

function callbackAddress(url: URL): string {
  return `${url.origin}${callbackPath}`;
}

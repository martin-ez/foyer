import { env } from "cloudflare:workers";
import { finishConnecting, isConnecting } from "./connecting";
import { cookie, readCookie, sessionCookie } from "./cookies";
import { fakeConsentPage } from "./fake-google";
import {
  googleCallbackPath as callbackPath,
  googleAccountFor,
  googleClient,
  googleSignInAddress,
} from "./google";
import { type Member, theHousehold } from "./household";
import { isLocalAddress } from "./local";
import { newSecret, sha256, toBase64Url } from "./secrets";

type App = "web" | "ipad";

type SignInError = "not-in-household" | "failed";

const startedSignInCookieName = "foyer_sign_in";
const startedSignInLifetimeSeconds = 10 * 60;

type StartedSignIn = { state?: string; codeVerifier?: string; app: App };

/** Answers the browser navigations under `/auth/` that sign people in, with Google or, locally,
 *  without it. They return to the web app with a session cookie, or, opened with `?app=ipad`, to
 *  `foyer://signed-in` with a one-time code. Someone who isn't let in returns with an error. */
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
    case "/auth/dev/google":
      return isDevelopment(url) ? fakeConsentPage(url) : new Response(null, { status: 404 });
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
  if (isConnecting(url)) return finishConnecting(url);
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
  if (!isDevelopment(url)) return new Response(null, { status: 404 });
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

function isDevelopment(url: URL): boolean {
  return env.DEV_SIGN_IN === "1" && isLocalAddress(url);
}

function appIn(url: URL): App {
  return url.searchParams.get("app") === "ipad" ? "ipad" : "web";
}

function callbackAddress(url: URL): string {
  return `${url.origin}${callbackPath}`;
}

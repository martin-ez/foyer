import { Code, ConnectError, type HandlerContext } from "@connectrpc/connect";
import { readCookie, sessionCookie, sessionCookieName } from "./cookies";
import { type Member, theHousehold } from "./household";

/** The session token a call carries: the iPad app's bearer token, or the web app's cookie. */
export function sessionTokenOf(
  context: HandlerContext,
): { token: string; inCookie: boolean } | null {
  return sessionTokenIn(context.requestHeader);
}

/** The session token a request's headers carry: the iPad app's bearer token, or the web app's
 *  cookie. */
export function sessionTokenIn(headers: Headers): { token: string; inCookie: boolean } | null {
  const bearer = headers.get("Authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (bearer) return { token: bearer, inCookie: false };
  const token = readCookie(headers, sessionCookieName);
  return token ? { token, inCookie: true } : null;
}

/** The member who made a call. Fails as unauthenticated when the call carries no session, or one
 *  that has ended. Renewing a web session renews its cookie too. */
export async function signedInMember(context: HandlerContext): Promise<Member> {
  const carried = sessionTokenOf(context);
  const session = carried && (await theHousehold().sessionFor(carried.token));
  if (!carried || !session) throw new ConnectError("Nobody is signed in", Code.Unauthenticated);
  if (session.renewed && carried.inCookie) {
    context.responseHeader.append("Set-Cookie", sessionCookie(carried.token, new URL(context.url)));
  }
  return session.member;
}

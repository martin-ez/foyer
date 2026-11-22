import { type Client, Code, ConnectError, type Interceptor } from "@connectrpc/connect";
import type { Member } from "@foyer/shared/gen/foyer/member/v1/member_pb";
import type { SessionService } from "@foyer/shared/gen/foyer/session/v1/session_pb";

/** Who is signed in on this device, as far as the app knows. A `problem` explains what went wrong
 *  in a sentence for the person. */
export type Session =
  | { status: "checking" }
  | { status: "unreachable"; problem: string }
  | { status: "signed-out"; problem?: string }
  | { status: "signed-in"; member: Member };

type Sessions = Client<typeof SessionService>;

/** Asks the backend who is signed in. */
export async function checkSession(sessions: Sessions): Promise<Session> {
  try {
    const { member } = await sessions.getSession({});
    return member ? { status: "signed-in", member } : { status: "signed-out" };
  } catch (error) {
    const reason = ConnectError.from(error);
    if (reason.code === Code.Unauthenticated) return { status: "signed-out" };
    return { status: "unreachable", problem: `Couldn't reach the backend: ${reason.message}` };
  }
}

/** Finishes signing in on the iPad, from the address that sign-in returned to: exchanges its
 *  one-time code for a session, and keeps the session's token. An address without a code means
 *  the person chose not to sign in. */
export async function finishSignIn(
  returnedTo: string,
  sessions: Sessions,
  keepToken: (token: string) => Promise<void>,
): Promise<Session> {
  const returned = new URL(returnedTo).searchParams;
  const error = returned.get("error");
  if (error) return { status: "signed-out", problem: describeSignInError(error) };
  const code = returned.get("code");
  if (!code) return { status: "signed-out" };

  try {
    const { token, member } = await sessions.finishSignIn({ code });
    if (!member) return { status: "signed-out", problem: describeSignInError("failed") };
    await keepToken(token);
    return { status: "signed-in", member };
  } catch {
    return { status: "signed-out", problem: describeSignInError("failed") };
  }
}

/** Signs out: ends the session on the backend, then forgets what this device keeps for it, such as
 *  its token. */
export async function signOut(
  sessions: Sessions,
  forgetOnDevice: () => Promise<void>,
): Promise<Session> {
  try {
    await sessions.signOut({});
  } catch (error) {
    const reason = ConnectError.from(error);
    return { status: "unreachable", problem: `Couldn't reach the backend: ${reason.message}` };
  }
  await forgetOnDevice();
  return { status: "signed-out" };
}

/** Tells the person why sign-in returned without signing them in. */
export function describeSignInError(error: string): string {
  return error === "not-in-household"
    ? "That Google account isn't part of this household."
    : "Signing in didn't work. Try again.";
}

/** Sends the session token this device keeps, if any, as a bearer token on every call. */
export function sendingSessionToken(readToken: () => Promise<string | null>): Interceptor {
  return (next) => async (request) => {
    const token = await readToken();
    if (token) request.header.set("Authorization", `Bearer ${token}`);
    return next(request);
  };
}

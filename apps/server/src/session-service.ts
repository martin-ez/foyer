import { Code, ConnectError, type ServiceImpl } from "@connectrpc/connect";
import type { SessionService } from "@foyer/shared/gen/foyer/session/v1/session_pb";
import { removedSessionCookie } from "./cookies";
import { theHousehold } from "./household";
import { sessionTokenOf, signedInMember } from "./signed-in";

/** Finishes the iPad app's sign-in, says who is signed in, and signs people out. */
export const sessionService: ServiceImpl<typeof SessionService> = {
  async finishSignIn({ code }) {
    const signedIn = await theHousehold().finishSignIn(code);
    if (!signedIn) {
      throw new ConnectError("The sign-in code isn't valid, or has expired", Code.Unauthenticated);
    }
    return signedIn;
  },

  async getSession(_, context) {
    return { member: await signedInMember(context) };
  },

  async signOut(_, context) {
    const carried = sessionTokenOf(context);
    if (carried) await theHousehold().endSession(carried.token);
    if (carried?.inCookie) {
      context.responseHeader.append("Set-Cookie", removedSessionCookie(new URL(context.url)));
    }
    return {};
  },
};

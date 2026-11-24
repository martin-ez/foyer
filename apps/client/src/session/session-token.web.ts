import type { Member } from "@foyer/shared/gen/foyer/member/v1/member_pb";

/** The web app keeps no session token: the browser holds the session in a cookie that scripts
 *  can't read, and sends it on every call. */
export async function readSessionToken(): Promise<string | null> {
  return null;
}

/** Does nothing on the web, where the backend sets the session's cookie. */
export async function keepSessionToken(_token: string): Promise<void> {}

/** Does nothing on the web, where the backend removes the session's cookie when signing out. */
export async function forgetSessionToken(): Promise<void> {}

/** The web app keeps no member: it asks the backend who is signed in each time it opens. */
export async function readSignedInMember(): Promise<Member | null> {
  return null;
}

/** Does nothing on the web, which keeps no member. */
export async function keepSignedInMember(_member: Member): Promise<void> {}

/** Does nothing on the web, which keeps no member. */
export async function forgetSignedInMember(): Promise<void> {}

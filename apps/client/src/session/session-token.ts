import { create } from "@bufbuild/protobuf";
import { type Member, MemberSchema } from "@foyer/shared/gen/foyer/member/v1/member_pb";
import * as SecureStore from "expo-secure-store";

const key = "session-token";
const memberKey = "signed-in-member";
let kept: string | null | undefined;

/** The session token the iPad app keeps in the Keychain, or null when nobody is signed in. */
export async function readSessionToken(): Promise<string | null> {
  kept ??= await SecureStore.getItemAsync(key);
  return kept;
}

/** Keeps a session token in the Keychain. */
export async function keepSessionToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(key, token);
  kept = token;
}

/** Forgets the session token. */
export async function forgetSessionToken(): Promise<void> {
  await SecureStore.deleteItemAsync(key);
  kept = null;
}

/** The member signed in on the iPad, whose id and name it keeps in the Keychain next to their
 *  session's token, to open as them without a connection; or null when it keeps no token. */
export async function readSignedInMember(): Promise<Member | null> {
  if (!(await readSessionToken())) return null;
  try {
    const { id, name } = JSON.parse((await SecureStore.getItemAsync(memberKey)) ?? "null") ?? {};
    return typeof id === "string" && typeof name === "string"
      ? create(MemberSchema, { id, name })
      : null;
  } catch {
    return null;
  }
}

/** Keeps the member signed in on the iPad, next to their session's token. */
export async function keepSignedInMember({ id, name }: Member): Promise<void> {
  await SecureStore.setItemAsync(memberKey, JSON.stringify({ id, name }));
}

/** Forgets the member signed in on the iPad. */
export async function forgetSignedInMember(): Promise<void> {
  await SecureStore.deleteItemAsync(memberKey);
}

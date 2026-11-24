import { useCallback, useEffect, useState } from "react";
import { sessionClient } from "../backend/backend";
import { forgetDeviceStorage } from "../sync/device-storage";
import { checkSession, type Session, signOut } from "./session";
import { forgetSessionToken } from "./session-token";
import { problemFromSignIn, signInWithGoogle, signInWithoutGoogle } from "./sign-in";

const withoutGoogle = signInWithoutGoogle;

/** Who is signed in on this device, checked with the backend when the app starts, and the ways to
 *  change it. Signing out forgets what the device keeps for the member. Only the iPad app's
 *  development builds can sign in without Google. */
export function useSession() {
  const [session, setSession] = useState<Session>({ status: "checking" });

  const check = useCallback(async () => {
    setSession({ status: "checking" });
    const checked = await checkSession(sessionClient);
    const problem = problemFromSignIn();
    setSession(checked.status === "signed-out" && problem ? { ...checked, problem } : checked);
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  const memberId = session.status === "signed-in" ? session.member.id : null;
  const forgetOnDevice = async () => {
    await forgetSessionToken();
    if (memberId) await forgetDeviceStorage(memberId);
  };

  return {
    session,
    check,
    signIn: async () => setSession(await signInWithGoogle()),
    signInWithoutGoogle:
      withoutGoogle && (async (email: string) => setSession(await withoutGoogle(email))),
    signOut: async () => setSession(await signOut(sessionClient, forgetOnDevice)),
  };
}

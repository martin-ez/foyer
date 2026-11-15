import { useCallback, useEffect, useState } from "react";
import { sessionClient } from "../backend/backend";
import { checkSession, type Session, signOut } from "./session";
import { forgetSessionToken } from "./session-token";
import { problemFromSignIn, signInWithGoogle } from "./sign-in";

/** Who is signed in on this device, checked with the backend when the app starts, and the ways to
 *  change it. */
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

  return {
    session,
    check,
    signIn: async () => setSession(await signInWithGoogle()),
    signOut: async () => setSession(await signOut(sessionClient, forgetSessionToken)),
  };
}

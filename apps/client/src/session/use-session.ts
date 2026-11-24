import { useCallback, useEffect, useRef, useState } from "react";
import { sessionClient } from "../backend/backend";
import { handleDevLink } from "../shell/dev-links";
import { forgetDeviceStorage } from "../sync/device-storage";
import { checkSession, type Session, signOut } from "./session";
import { forgetSessionToken } from "./session-token";
import {
  problemFromSignIn,
  signInWithCode,
  signInWithGoogle,
  signInWithoutGoogle,
} from "./sign-in";

const withoutGoogle = signInWithoutGoogle;
const withCode = signInWithCode;

/** Who is signed in on this device, checked with the backend when the app starts, and the ways to
 *  change it. Signing out forgets what the device keeps for the member. Only the iPad app's
 *  development builds can sign in without Google, or with a one-time code from it opened as
 *  `foyer://dev/sign-in?code=…`. */
export function useSession() {
  const [session, setSession] = useState<Session>({ status: "checking" });

  const latest = useRef(0);

  const check = useCallback(async () => {
    const started = ++latest.current;
    setSession({ status: "checking" });
    const checked = await checkSession(sessionClient);
    if (started !== latest.current) return;
    const problem = problemFromSignIn();
    setSession(checked.status === "signed-out" && problem ? { ...checked, problem } : checked);
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  useEffect(
    () =>
      withCode &&
      handleDevLink("sign-in", async (params) => {
        const started = ++latest.current;
        setSession({ status: "checking" });
        const signedIn = await withCode(params.get("code") ?? "");
        if (started === latest.current) setSession(signedIn);
      }),
    [],
  );

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

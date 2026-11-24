import { useCallback, useEffect, useRef, useState } from "react";
import { sessionClient } from "../backend/backend";
import {
  forgetDeviceStorage,
  forgetEndedSession,
  forgetOtherMembers,
} from "../sync/device-storage";
import { type KeptSignIn, openSession, type Session, signOut } from "./session";
import {
  forgetSessionToken,
  forgetSignedInMember,
  keepSignedInMember,
  readSignedInMember,
} from "./session-token";
import { problemFromSignIn, signInWithGoogle, signInWithoutGoogle } from "./sign-in";

const withoutGoogle = signInWithoutGoogle;

const keptSignIn: KeptSignIn = {
  member: readSignedInMember,
  signedIn: async (member) => {
    await keepSignedInMember(member);
    await forgetOtherMembers(member.id);
  },
  ended: async (memberId) => {
    await forgetSessionToken();
    await forgetSignedInMember();
    await forgetEndedSession(memberId);
  },
};

/** Who is signed in on this device, opened with `openSession` when the app starts, and the ways to
 *  change it. Signing out forgets what the device keeps for the member. Only the iPad app's
 *  development builds can sign in without Google. */
export function useSession() {
  const [session, setSession] = useState<Session>({ status: "checking" });
  const latest = useRef(0);

  const check = useCallback(async () => {
    const started = ++latest.current;
    await openSession(sessionClient, keptSignIn, (opened) => {
      if (started !== latest.current) return;
      const problem = opened.status === "checking" ? undefined : problemFromSignIn();
      setSession(opened.status === "signed-out" && problem ? { ...opened, problem } : opened);
    });
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  const show = async (next: Promise<Session>) => {
    const started = ++latest.current;
    const shown = await next;
    if (shown.status === "signed-in") await keptSignIn.signedIn(shown.member);
    if (started === latest.current) setSession(shown);
  };

  const memberId = session.status === "signed-in" ? session.member.id : null;

  const sessionEnded = useCallback(async () => {
    ++latest.current;
    if (memberId) await keptSignIn.ended(memberId);
    await check();
  }, [memberId, check]);

  const forgetOnDevice = async () => {
    await forgetSessionToken();
    await forgetSignedInMember();
    if (memberId) await forgetDeviceStorage(memberId);
  };

  return {
    session,
    check,
    sessionEnded,
    signIn: () => show(signInWithGoogle()),
    signInWithoutGoogle: withoutGoogle && ((email: string) => show(withoutGoogle(email))),
    signOut: () => show(signOut(sessionClient, forgetOnDevice)),
  };
}

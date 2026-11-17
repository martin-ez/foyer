import { PagesScreen } from "../page/pages-screen";
import { CheckingSession, SessionUnreachable, SignIn } from "../session/session-screens";
import { useSession } from "../session/use-session";

export default function Home() {
  const { session, check, signIn, signOut } = useSession();

  switch (session.status) {
    case "checking":
      return <CheckingSession />;
    case "unreachable":
      return <SessionUnreachable problem={session.problem} onRetry={check} />;
    case "signed-out":
      return <SignIn problem={session.problem} onSignIn={signIn} />;
    case "signed-in":
      return <PagesScreen member={session.member} onSignOut={signOut} onSignedOut={check} />;
  }
}

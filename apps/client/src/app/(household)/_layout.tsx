import { GoogleCalendarProvider } from "../../calendar/google-calendar-views";
import { CheckingSession, SessionUnreachable, SignIn } from "../../session/session-screens";
import { useSession } from "../../session/use-session";
import { AppShell } from "../../shell/app-shell";
import { HouseholdProvider } from "../../shell/household";
import { TickingProvider } from "../../tasks/ticking";

/** The household's views for the signed-in member, or the way to sign in. */
export default function HouseholdLayout() {
  const { session, check, signIn, signInWithoutGoogle, signOut } = useSession();

  switch (session.status) {
    case "checking":
      return <CheckingSession />;
    case "unreachable":
      return <SessionUnreachable problem={session.problem} onRetry={check} />;
    case "signed-out":
      return (
        <SignIn
          problem={session.problem}
          onSignIn={signIn}
          onSignInWithoutGoogle={signInWithoutGoogle}
        />
      );
    case "signed-in":
      return (
        <HouseholdProvider member={session.member} onSignOut={signOut} onSignedOut={check}>
          <GoogleCalendarProvider>
            <TickingProvider>
              <AppShell />
            </TickingProvider>
          </GoogleCalendarProvider>
        </HouseholdProvider>
      );
  }
}

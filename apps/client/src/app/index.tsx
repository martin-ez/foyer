import { StyleSheet, View } from "react-native";
import { BackendStatus } from "../backend/backend-status";
import { BlankPage } from "../page/blank-page";
import {
  CheckingSession,
  SessionUnreachable,
  SignedInAs,
  SignIn,
} from "../session/session-screens";
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
      return (
        <View style={styles.fill}>
          <BlankPage />
          <BackendStatus />
          <SignedInAs member={session.member} onSignOut={signOut} />
        </View>
      );
  }
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});

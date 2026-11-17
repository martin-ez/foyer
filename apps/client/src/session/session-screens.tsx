import type { Member } from "@foyer/shared/gen/foyer/member/v1/member_pb";
import { Button, StyleSheet, Text, View } from "react-native";

/** Shown while the app checks who is signed in. */
export function CheckingSession() {
  return (
    <View style={styles.screen}>
      <Text>Checking who's signed in…</Text>
    </View>
  );
}

/** Shown when the app couldn't check who is signed in, with a way to try again. */
export function SessionUnreachable({ problem, onRetry }: { problem: string; onRetry: () => void }) {
  return (
    <View style={styles.screen}>
      <Text style={styles.problem}>{problem}</Text>
      <Button title="Try again" onPress={onRetry} />
    </View>
  );
}

/** Asks the person to sign in, and says why the last attempt didn't work, if it didn't. */
export function SignIn({ problem, onSignIn }: { problem?: string; onSignIn: () => void }) {
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Foyer</Text>
      {problem ? <Text style={styles.problem}>{problem}</Text> : null}
      <Button title="Sign in with Google" onPress={onSignIn} />
    </View>
  );
}

/** Says who is signed in, with a way to sign out. */
export function SignedInAs({ member, onSignOut }: { member: Member; onSignOut: () => void }) {
  return (
    <View style={styles.signedInAs}>
      <Text style={styles.line}>Signed in as {member.name}</Text>
      <Button title="Sign out" onPress={onSignOut} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 24 },
  title: { fontSize: 32 },
  problem: { color: "#9a3b2e", textAlign: "center" },
  signedInAs: { flexDirection: "row", alignItems: "center", gap: 8 },
  line: { fontSize: 12, color: "#6b6459" },
});
